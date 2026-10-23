// Runtime-only server control (#117): no shell, script policy override or PATH lookup.
// Install/update/uninstall and Windows screensaver configuration remain in the control script.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal sealed class ServerRecord {
    internal int ProcessId;
    internal long StartedUtcTicks;
}
internal sealed class ServerProcess : IDisposable {
    internal int ProcessId;
    internal long StartedUtcTicks;
    internal string ExecutablePath, CommandLine;
    internal bool Exited = false;
    internal Process Handle;
    public void Dispose() { if (Handle != null) { Handle.Dispose(); Handle = null; } }
}
internal interface IServerRuntimeEnvironment {
    string NodePath { get; }
    string EntryPath { get; }
    void AssertInstalled();
    IDisposable AcquireLock(CancellationToken cancellation);
    ServerRecord ReadRecord();
    ServerProcess Inspect(int processId);
    bool Healthy();
    bool PortInUse();
    bool HasOwnedListener(ServerProcess process);
    ServerProcess Launch();
    void SaveRecord(ServerRecord record);
    void DeleteRecordIfMatches(ServerRecord record);
    void Stop(ServerProcess process);
    void Wait(int milliseconds, CancellationToken cancellation);
}
internal sealed class ServerRuntimeStatus {
    public bool ServerRunning { get; set; }
    public bool Healthy { get; set; }
}
internal sealed class ServerRuntime {
    private readonly IServerRuntimeEnvironment environment;
    internal ServerRuntime(IServerRuntimeEnvironment environment) { this.environment = environment; }
    internal static bool Matches(ServerRecord record, ServerProcess process, string node, string entry) {
        return record != null && process != null && !process.Exited && record.ProcessId == process.ProcessId &&
            record.StartedUtcTicks == process.StartedUtcTicks &&
            string.Equals(process.ExecutablePath, node, StringComparison.OrdinalIgnoreCase) &&
            process.CommandLine != null && process.CommandLine.IndexOf("\"" + entry + "\"", StringComparison.OrdinalIgnoreCase) >= 0;
    }
    private ServerProcess Owned(ServerRecord record) {
        if (record == null) return null;
        var process = environment.Inspect(record.ProcessId);
        if (Matches(record, process, environment.NodePath, environment.EntryPath)) return process;
        if (process != null) process.Dispose();
        return null;
    }
    internal void Start(CancellationToken cancellation) {
        cancellation.ThrowIfCancellationRequested();
        using (environment.AcquireLock(cancellation)) {
            cancellation.ThrowIfCancellationRequested();
            environment.AssertInstalled();
            using (var owned = Owned(environment.ReadRecord())) {
                if (owned != null) {
                    if (!environment.HasOwnedListener(owned) || !environment.Healthy())
                        throw new InvalidOperationException("Owned server is running but not responding. Run Stop, then Start.");
                    cancellation.ThrowIfCancellationRequested();
                    return;
                }
            }
            if (environment.PortInUse()) throw new InvalidOperationException("Port 4318 is occupied by a different instance. Stop that instance first.");
            cancellation.ThrowIfCancellationRequested();
            using (var started = environment.Launch()) {
                var record = new ServerRecord { ProcessId = started.ProcessId, StartedUtcTicks = started.StartedUtcTicks };
                try {
                    environment.SaveRecord(record);
                    for (int attempt = 0; attempt < 40; attempt++) {
                        environment.Wait(250, cancellation);
                        using (var current = environment.Inspect(started.ProcessId)) {
                            if (!Matches(record, current, environment.NodePath, environment.EntryPath))
                                throw new InvalidOperationException("Server exited during startup. Check prerequisites and port 4318.");
                        }
                        if (environment.HasOwnedListener(started) && environment.Healthy()) {
                            cancellation.ThrowIfCancellationRequested();
                            return;
                        }
                    }
                    throw new TimeoutException("Local server startup timed out.");
                } catch {
                    // Only this invocation's pinned child may be stopped. A reused PID or changed record
                    // must never turn failed/cancelled startup into stopping somebody else's process.
                    environment.Stop(started);
                    environment.DeleteRecordIfMatches(record);
                    throw;
                }
            }
        }
    }
    internal void Stop(CancellationToken cancellation) {
        using (environment.AcquireLock(cancellation)) {
            cancellation.ThrowIfCancellationRequested(); environment.AssertInstalled();
            var record = environment.ReadRecord();
            using (var owned = Owned(record)) {
                if (owned == null) return;
                environment.Stop(owned); environment.DeleteRecordIfMatches(record);
            }
        }
    }
    internal ServerRuntimeStatus Status(CancellationToken cancellation) {
        using (environment.AcquireLock(cancellation)) {
            cancellation.ThrowIfCancellationRequested(); environment.AssertInstalled();
            using (var owned = Owned(environment.ReadRecord())) {
                return new ServerRuntimeStatus { ServerRunning = owned != null,
                    Healthy = owned != null && environment.HasOwnedListener(owned) && environment.Healthy() };
            }
        }
    }
}

internal sealed class WindowsServerEnvironment : IServerRuntimeEnvironment {
    private readonly string root, app, data, run, recordPath, marker;
    private readonly int port;
    public string NodePath { get; private set; }
    public string EntryPath { get; private set; }
    internal WindowsServerEnvironment(string applicationDirectory) : this(applicationDirectory, 4318) { }
    // The internal port seam lets real ownership/listener tests use a synthetic server without
    // competing with the installation. Program always uses the fixed-port constructor above.
    internal WindowsServerEnvironment(string applicationDirectory, int port) {
        if (port < 1 || port > 65535) throw new ArgumentOutOfRangeException("port");
        this.port = port;
        app = Path.GetFullPath(applicationDirectory).TrimEnd(Path.DirectorySeparatorChar);
        root = Directory.GetParent(app).FullName;
        data = Path.Combine(root, "data"); run = Path.Combine(root, "run");
        recordPath = Path.Combine(run, "server.json"); marker = Path.Combine(root, "installation.json");
        NodePath = Path.Combine(root, "runtime", "node.exe"); EntryPath = Path.Combine(app, "dist", "server", "index.js");
    }
    private static void PlainPath(string path) {
        for (string item = Path.GetFullPath(path); !string.IsNullOrEmpty(item); item = Path.GetDirectoryName(item))
            if ((File.Exists(item) || Directory.Exists(item)) && (File.GetAttributes(item) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("App paths must not pass through a reparse point.");
    }
    public void AssertInstalled() {
        foreach (string path in new[] { app, data, run, marker, recordPath, NodePath, EntryPath }) PlainPath(path);
        if (!File.Exists(marker)) throw new InvalidOperationException("Not installed. Run Install from the source clone or Setup.");
        var value = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(marker)) as Dictionary<string, object>;
        if (value == null || !value.ContainsKey("product") || !string.Equals(value["product"] as string, "living-room-display", StringComparison.Ordinal))
            throw new InvalidOperationException("Installation marker does not match this application.");
        if (!File.Exists(NodePath) || !File.Exists(EntryPath)) throw new FileNotFoundException("Installed app or Node runtime is missing; run Update.");
    }
    internal static string LockName(string installRoot) {
        using (var hasher = SHA256.Create()) {
            var hash = hasher.ComputeHash(Encoding.UTF8.GetBytes(installRoot.ToUpperInvariant()));
            return "Local\\LivingRoomDisplay.Control." + BitConverter.ToString(hash).Replace("-", "").Substring(0, 12);
        }
    }
    private sealed class LockLease : IDisposable {
        private Mutex mutex;
        internal LockLease(Mutex mutex) { this.mutex = mutex; }
        public void Dispose() { if (mutex != null) { mutex.ReleaseMutex(); mutex.Dispose(); mutex = null; } }
    }
    public IDisposable AcquireLock(CancellationToken cancellation) {
        var mutex = new Mutex(false, LockName(root));
        try {
            var watch = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < 10000) {
                cancellation.ThrowIfCancellationRequested();
                bool held; try { held = mutex.WaitOne(50); } catch (AbandonedMutexException) { held = true; }
                if (held) return new LockLease(mutex);
            }
            throw new TimeoutException("Another application operation is in progress. Wait for it to finish.");
        } catch { mutex.Dispose(); throw; }
    }
    public ServerRecord ReadRecord() {
        PlainPath(recordPath);
        if (!File.Exists(recordPath)) return null;
        try {
            var value = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(recordPath)) as Dictionary<string, object>;
            object idValue, timeValue; int id; DateTimeOffset time;
            if (value == null || !value.TryGetValue("processId", out idValue) || !value.TryGetValue("startedAt", out timeValue) ||
                !int.TryParse(Convert.ToString(idValue, CultureInfo.InvariantCulture), NumberStyles.None, CultureInfo.InvariantCulture, out id) || id <= 0 ||
                !DateTimeOffset.TryParse(timeValue as string, CultureInfo.InvariantCulture, DateTimeStyles.None, out time)) return null;
            return new ServerRecord { ProcessId = id, StartedUtcTicks = time.UtcDateTime.Ticks };
        } catch (ArgumentException) { return null; }
        catch (InvalidOperationException) { return null; }
    }
    public ServerProcess Inspect(int processId) {
        Process process = null;
        try {
            process = Process.GetProcessById(processId);
            // Open and retain this process handle before consulting WMI: subsequent PID reuse cannot
            // turn Stop into killing a different process, and exited reads fail closed.
            var handle = process.Handle;
            long ticks = process.StartTime.ToUniversalTime().Ticks;
            string executable = null, command = null;
            using (var query = new ManagementObjectSearcher("SELECT ExecutablePath, CommandLine FROM Win32_Process WHERE ProcessId=" + processId.ToString(CultureInfo.InvariantCulture)))
            using (var found = query.Get()) foreach (ManagementObject item in found) using (item) {
                executable = item["ExecutablePath"] as string; command = item["CommandLine"] as string;
            }
            if (process.HasExited || process.StartTime.ToUniversalTime().Ticks != ticks || executable == null || command == null) { process.Dispose(); return null; }
            return new ServerProcess { ProcessId = processId, StartedUtcTicks = ticks, ExecutablePath = executable, CommandLine = command, Handle = process };
        } catch (ArgumentException) { if (process != null) process.Dispose(); return null; }
        catch (InvalidOperationException) { if (process != null) process.Dispose(); return null; }
        catch (System.ComponentModel.Win32Exception) { if (process != null) process.Dispose(); return null; }
        catch (ManagementException) { if (process != null) process.Dispose(); return null; }
    }
    public bool Healthy() {
        try {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/api/health");
            request.Proxy = null; request.Timeout = 1000; request.ReadWriteTimeout = 1000;
            using (var response = request.GetResponse()) using (var reader = new StreamReader(response.GetResponseStream())) {
                var buffer = new char[2048]; int count = reader.ReadBlock(buffer, 0, buffer.Length);
                if (count == buffer.Length) return false;
                var body = new JavaScriptSerializer().DeserializeObject(new string(buffer, 0, count)) as Dictionary<string, object>;
                return body != null && body.ContainsKey("status") && string.Equals(body["status"] as string, "ok", StringComparison.Ordinal);
            }
        } catch (WebException) { return false; }
        catch (IOException) { return false; }
        catch (ArgumentException) { return false; }
        catch (InvalidOperationException) { return false; }
    }
    public bool PortInUse() {
        foreach (var endpoint in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners()) if (endpoint.Port == port) return true;
        return false;
    }
    [DllImport("iphlpapi.dll", SetLastError = true)] private static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int family, int tableClass, uint reserved);
    public bool HasOwnedListener(ServerProcess process) {
        if (process.Handle == null || process.Handle.HasExited) return false;
        int bytes = 0;
        uint result = GetExtendedTcpTable(IntPtr.Zero, ref bytes, false, 2, 3, 0); // IPv4, TCP_TABLE_OWNER_PID_LISTENER
        if (result != 122 || bytes < 4) return false;
        IntPtr table = Marshal.AllocHGlobal(bytes);
        try {
            if (GetExtendedTcpTable(table, ref bytes, false, 2, 3, 0) != 0) return false;
            int rows = Marshal.ReadInt32(table);
            if (rows < 0 || rows > (bytes - 4) / 24) return false;
            for (int row = 0; row < rows; row++) {
                int offset = 4 + row * 24;
                int listeningPort = Marshal.ReadByte(table, offset + 8) * 256 + Marshal.ReadByte(table, offset + 9);
                uint address = unchecked((uint)Marshal.ReadInt32(table, offset + 4));
                if (listeningPort == port && new IPAddress(address).Equals(IPAddress.Loopback) && Marshal.ReadInt32(table, offset + 20) == process.ProcessId)
                    return !process.Handle.HasExited;
            }
            return false;
        } finally { Marshal.FreeHGlobal(table); }
    }
    internal ProcessStartInfo CreateStartInfo() {
        var start = new ProcessStartInfo(NodePath, "\"" + EntryPath + "\"") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = app };
        start.EnvironmentVariables["LRD_DATA_DIR"] = data;
        start.EnvironmentVariables["LRD_PORT"] = port.ToString(CultureInfo.InvariantCulture);
        // Only installed lifecycle launches opt in. Source/test entry points stay inert.
        start.EnvironmentVariables["LRD_PREVIEW_PREPARER"] = Environment.GetEnvironmentVariable("LRD_PREVIEW_PREPARER_DISABLED") == "1" ? "0" : "1";
        return start;
    }
    public ServerProcess Launch() {
        PlainPath(run); Directory.CreateDirectory(run);
        var process = Process.Start(CreateStartInfo());
        try {
            var handle = process.Handle;
            return new ServerProcess { ProcessId = process.Id, StartedUtcTicks = process.StartTime.ToUniversalTime().Ticks,
                ExecutablePath = NodePath, CommandLine = "\"" + NodePath + "\" \"" + EntryPath + "\"", Handle = process };
        } catch { if (!process.HasExited) { process.Kill(); process.WaitForExit(10000); } process.Dispose(); throw; }
    }
    public void SaveRecord(ServerRecord record) {
        PlainPath(recordPath);
        string temporary = Path.Combine(run, "server-" + Guid.NewGuid().ToString("N") + ".tmp");
        var value = new Dictionary<string, object> { { "processId", record.ProcessId }, { "startedAt", new DateTime(record.StartedUtcTicks, DateTimeKind.Utc).ToString("o", CultureInfo.InvariantCulture) } };
        try {
            File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(value), new UTF8Encoding(false));
            if (File.Exists(recordPath)) File.Replace(temporary, recordPath, null); else File.Move(temporary, recordPath);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public void DeleteRecordIfMatches(ServerRecord expected) {
        var actual = ReadRecord();
        if (actual != null && expected != null && actual.ProcessId == expected.ProcessId && actual.StartedUtcTicks == expected.StartedUtcTicks) File.Delete(recordPath);
    }
    private List<Process> PinOwnedPreparers(ServerProcess server) {
        var pinned = new List<Process>();
        string expected = Path.Combine(app, "windows", "LivingRoomDisplay.Preview.exe");
        try {
            using (var query = new ManagementObjectSearcher("SELECT ProcessId FROM Win32_Process WHERE Name='LivingRoomDisplay.Preview.exe' AND ParentProcessId=" + server.ProcessId.ToString(CultureInfo.InvariantCulture)))
            using (var found = query.Get()) foreach (ManagementObject item in found) using (item) {
                Process child = null;
                try {
                    child = Process.GetProcessById(Convert.ToInt32(item["ProcessId"], CultureInfo.InvariantCulture));
                    var pin = child.Handle;
                    // Query after pinning so PID recycling cannot inherit a stale parent's identity.
                    bool matches = false;
                    using (var identityQuery = new ManagementObjectSearcher("SELECT ExecutablePath, ParentProcessId FROM Win32_Process WHERE ProcessId=" + child.Id.ToString(CultureInfo.InvariantCulture)))
                    using (var identities = identityQuery.Get()) foreach (ManagementObject identity in identities) using (identity)
                        matches = !server.Handle.HasExited && !child.HasExited &&
                            Convert.ToInt32(identity["ParentProcessId"], CultureInfo.InvariantCulture) == server.ProcessId &&
                            string.Equals(identity["ExecutablePath"] as string, expected, StringComparison.OrdinalIgnoreCase) &&
                            string.Equals(child.MainModule.FileName, expected, StringComparison.OrdinalIgnoreCase) &&
                            child.StartTime.ToUniversalTime().Ticks >= server.StartedUtcTicks;
                    if (matches) { pinned.Add(child); child = null; }
                } catch (ArgumentException) { }
                catch (InvalidOperationException) { }
                catch (System.ComponentModel.Win32Exception) { }
                finally { if (child != null) child.Dispose(); }
            }
            return pinned;
        } catch { foreach (var child in pinned) child.Dispose(); throw; }
    }
    public void Stop(ServerProcess process) {
        if (process.Handle == null) throw new InvalidOperationException("Cannot stop a process without its ownership handle.");
        if (process.Handle.HasExited) return;
        if (process.Handle.Id != process.ProcessId || process.Handle.StartTime.ToUniversalTime().Ticks != process.StartedUtcTicks) throw new InvalidOperationException("Process ownership changed; nothing was stopped.");
        var preparers = PinOwnedPreparers(process);
        try {
            process.Handle.Kill();
            if (!process.Handle.WaitForExit(10000)) throw new TimeoutException("The Living Room Display server did not exit after Stop.");
            foreach (var preparer in preparers) {
                // EOF and the pinned parent guard normally end the child without intervention.
                if (preparer.WaitForExit(10000)) continue;
                preparer.Kill();
                if (!preparer.WaitForExit(10000)) throw new TimeoutException("The Living Room Display preview preparer did not exit after Stop.");
            }
        } finally { foreach (var preparer in preparers) preparer.Dispose(); }
    }
    public void Wait(int milliseconds, CancellationToken cancellation) {
        // SessionStartup keeps its cancellation source alive for already-dispatched callbacks.
        // Never request its WaitHandle, which would allocate a handle that outlives the session.
        var watch = Stopwatch.StartNew();
        while (true) {
            cancellation.ThrowIfCancellationRequested();
            long remaining = milliseconds - watch.ElapsedMilliseconds;
            if (remaining <= 0) return;
            Thread.Sleep((int)Math.Min(25, remaining));
        }
    }
}
