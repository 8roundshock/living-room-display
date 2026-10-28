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

// One absolute monotonic budget. Only read-only operations may run on its worker:
// an abandoned observation can finish late, but cannot launch, save or kill.
internal sealed class RuntimeObservationBudget {
    private readonly Stopwatch age = Stopwatch.StartNew();
    private readonly int milliseconds;
    private readonly Func<long> elapsed;
    internal RuntimeObservationBudget(int milliseconds = 10000, Func<long> elapsed = null) {
        if (milliseconds <= 0) throw new ArgumentOutOfRangeException("milliseconds");
        this.milliseconds = milliseconds; this.elapsed = elapsed ?? delegate { return age.ElapsedMilliseconds; };
    }
    internal int Remaining { get { return (int)Math.Max(0, milliseconds - elapsed()); } }
    internal void Check(CancellationToken cancellation) {
        cancellation.ThrowIfCancellationRequested();
        if (Remaining == 0) throw new TimeoutException("Native startup observation timed out; server state is unknown.");
    }
    private static void DisposeLate<T>(T value) {
        var disposable = (object)value as IDisposable;
        if (disposable != null) try { disposable.Dispose(); } catch { }
    }
    internal T Read<T>(Func<T> observation, CancellationToken cancellation) {
        Check(cancellation);
        var gate = new object();
        bool finished = false, abandoned = false, adopted = false;
        T result = default(T); Exception failure = null;
        var worker = new Thread(delegate() {
            T value = default(T); Exception error = null;
            try { value = observation(); } catch (Exception caught) { error = caught; }
            bool discard;
            lock (gate) {
                discard = abandoned;
                if (!discard) { result = value; failure = error; finished = true; Monitor.PulseAll(gate); }
            }
            if (discard) DisposeLate(value);
        });
        worker.IsBackground = true;
        worker.Start();
        try {
            lock (gate) {
                while (!finished) {
                    Check(cancellation);
                    Monitor.Wait(gate, Math.Min(50, Math.Max(1, Remaining)));
                }
                // Cancellation/budget expiry beats even a just-returned result.
                Check(cancellation);
                if (failure != null) throw failure;
                adopted = true;
                return result;
            }
        } finally {
            bool discard;
            lock (gate) { abandoned = true; discard = finished && !adopted; }
            if (discard) DisposeLate(result);
        }
    }
}

// Discovery is read-only and owns its returned handles. Exact process mutations
// always stay on this caller; unknown discovery cannot authorize child kills.
internal static class OwnedServerCleanup {
    internal static void Run<T>(RuntimeObservationBudget budget, Func<T> discover,
        Action terminateParent, Func<int, bool> waitParent, Action<T, RuntimeObservationBudget> finishChildren) where T : class, IDisposable {
        T children = null; Exception unknown = null;
        try {
            try { children = budget.Read(discover, CancellationToken.None); }
            catch (Exception error) { unknown = error; }
            terminateParent(); // The delegate must revalidate its exact retained handle.
            bool parentExited = waitParent(budget.Remaining);
            if (unknown != null)
                throw new InvalidOperationException("Owned server termination requested, but preparer discovery was incomplete; recovery record retained.", unknown);
            if (!parentExited) throw new TimeoutException("The owned server did not finish exiting within the cleanup budget.");
            finishChildren(children, budget);
        } finally { if (children != null) children.Dispose(); }
    }
}

internal sealed class ServerRuntime {
    private readonly IServerRuntimeEnvironment environment;
    private readonly int observationMilliseconds;
    private readonly Func<long> observationElapsed;
    internal ServerRuntime(IServerRuntimeEnvironment environment, int observationMilliseconds = 10000, Func<long> observationElapsed = null) {
        this.environment = environment; this.observationMilliseconds = observationMilliseconds; this.observationElapsed = observationElapsed;
    }
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
    private enum Readiness { Missing, Unhealthy, Healthy }
    private Readiness ObserveReadiness(ServerRecord record, RuntimeObservationBudget budget, CancellationToken cancellation) {
        if (record == null) return Readiness.Missing;
        // The worker owns this independent handle throughout listener/health reads.
        // Never capture a caller-owned ServerProcess whose Handle may be disposed.
        using (var process = environment.Inspect(record.ProcessId)) {
            budget.Check(cancellation);
            if (!Matches(record, process, environment.NodePath, environment.EntryPath)) return Readiness.Missing;
            bool listener = environment.HasOwnedListener(process);
            budget.Check(cancellation);
            if (!listener) return Readiness.Unhealthy;
            bool healthy = environment.Healthy();
            budget.Check(cancellation);
            return healthy ? Readiness.Healthy : Readiness.Unhealthy;
        }
    }
    internal void Start(CancellationToken cancellation) {
        var budget = new RuntimeObservationBudget(observationMilliseconds, observationElapsed);
        budget.Check(cancellation);
        using (environment.AcquireLock(cancellation)) {
            budget.Read(delegate { environment.AssertInstalled(); return true; }, cancellation);
            var previous = budget.Read(environment.ReadRecord, cancellation);
            var observed = budget.Read(delegate { return ObserveReadiness(previous, budget, cancellation); }, cancellation);
            if (observed != Readiness.Missing) {
                if (observed != Readiness.Healthy)
                    throw new InvalidOperationException("Owned server is running but not responding. Run Stop, then Start.");
                budget.Check(cancellation);
                return;
            }
            if (budget.Read(environment.PortInUse, cancellation)) throw new InvalidOperationException("Port 4318 is occupied by a different instance. Stop that instance first.");
            budget.Check(cancellation);
            using (var started = environment.Launch()) {
                var record = new ServerRecord { ProcessId = started.ProcessId, StartedUtcTicks = started.StartedUtcTicks };
                try {
                    budget.Check(cancellation);
                    environment.SaveRecord(record);
                    for (int attempt = 0; attempt < 40; attempt++) {
                        budget.Check(cancellation);
                        environment.Wait(250, cancellation);
                        observed = budget.Read(delegate { return ObserveReadiness(record, budget, cancellation); }, cancellation);
                        if (observed == Readiness.Missing)
                            throw new InvalidOperationException("Server exited during startup. Check prerequisites and port 4318.");
                        if (observed == Readiness.Healthy) {
                            budget.Check(cancellation);
                            return;
                        }
                    }
                    throw new TimeoutException("Local server startup timed out.");
                } catch (Exception startupFailure) {
                    // Only this invocation's pinned child may be stopped. A reused PID or changed record
                    // must never turn failed/cancelled startup into stopping somebody else's process.
                    try {
                        environment.Stop(started);
                        environment.DeleteRecordIfMatches(record);
                    } catch (Exception cleanupFailure) {
                        throw new AggregateException("Native startup and its owned-child cleanup did not complete; recovery record retained.", startupFailure, cleanupFailure);
                    }
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
            try { process = Process.GetProcessById(processId); }
            catch (ArgumentException) { return null; } // This PID is definitely absent.
            // Open and retain this process handle before consulting WMI: subsequent PID reuse cannot
            // turn Stop into killing a different process, and exited reads fail closed.
            var handle = process.Handle;
            long ticks = process.StartTime.ToUniversalTime().Ticks;
            string executable = null, command = null;
            using (var query = new ManagementObjectSearcher("SELECT ExecutablePath, CommandLine FROM Win32_Process WHERE ProcessId=" + processId.ToString(CultureInfo.InvariantCulture)))
            using (var found = query.Get()) foreach (ManagementObject item in found) using (item) {
                executable = item["ExecutablePath"] as string; command = item["CommandLine"] as string;
            }
            if (process.HasExited || process.StartTime.ToUniversalTime().Ticks != ticks) return null;
            if (executable == null || command == null) throw new InvalidOperationException("Recorded process identity was unreadable.");
            var observed = new ServerProcess { ProcessId = processId, StartedUtcTicks = ticks, ExecutablePath = executable, CommandLine = command, Handle = process };
            process = null; // Transfer only a fully read identity and its handle.
            return observed;
        } catch (InvalidOperationException) { if (DefinitelyExited(process)) return null; throw; }
        // Unreadable access/WMI identity is unknown. Never turn it into absence.
        finally { if (process != null) process.Dispose(); }
    }
    private static bool DefinitelyExited(Process process) {
        if (process == null) return false;
        try { return process.HasExited; } catch { return false; }
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
    private sealed class PreparerLease : IDisposable {
        internal readonly List<Process> Processes = new List<Process>();
        public void Dispose() { foreach (var process in Processes) process.Dispose(); Processes.Clear(); }
    }
    private PreparerLease PinOwnedPreparers(int serverId, long serverStartedUtcTicks, RuntimeObservationBudget budget) {
        var pinned = new PreparerLease();
        string expected = Path.Combine(app, "windows", "LivingRoomDisplay.Preview.exe");
        try {
            budget.Check(CancellationToken.None);
            // This read-only worker owns a separate parent handle. Its caller
            // may already have disposed/killed its own handle after a timeout.
            using (var parent = Process.GetProcessById(serverId)) {
            if (parent.Handle == IntPtr.Zero) throw new InvalidOperationException("Parent ownership handle was unavailable.");
            if (parent.HasExited || parent.StartTime.ToUniversalTime().Ticks != serverStartedUtcTicks) return pinned;
            budget.Check(CancellationToken.None);
            using (var query = new ManagementObjectSearcher("SELECT ProcessId FROM Win32_Process WHERE Name='LivingRoomDisplay.Preview.exe' AND ParentProcessId=" + serverId.ToString(CultureInfo.InvariantCulture)))
            using (var found = query.Get()) foreach (ManagementObject item in found) using (item) {
                budget.Check(CancellationToken.None);
                Process child = null;
                try {
                    int childId = Convert.ToInt32(item["ProcessId"], CultureInfo.InvariantCulture);
                    try { child = Process.GetProcessById(childId); }
                    catch (ArgumentException) { continue; } // A vanished PID has no surviving child to stop.
                    var pin = child.Handle;
                    // Query after pinning so PID recycling cannot inherit a stale parent's identity.
                    bool matches = false;
                    using (var identityQuery = new ManagementObjectSearcher("SELECT ExecutablePath, ParentProcessId FROM Win32_Process WHERE ProcessId=" + child.Id.ToString(CultureInfo.InvariantCulture)))
                    using (var identities = identityQuery.Get()) foreach (ManagementObject identity in identities) using (identity) {
                        budget.Check(CancellationToken.None);
                        matches = !parent.HasExited && !child.HasExited &&
                            Convert.ToInt32(identity["ParentProcessId"], CultureInfo.InvariantCulture) == serverId &&
                            string.Equals(identity["ExecutablePath"] as string, expected, StringComparison.OrdinalIgnoreCase) &&
                            string.Equals(child.MainModule.FileName, expected, StringComparison.OrdinalIgnoreCase) &&
                            child.StartTime.ToUniversalTime().Ticks >= serverStartedUtcTicks;
                    }
                    budget.Check(CancellationToken.None);
                    if (matches) { pinned.Processes.Add(child); child = null; }
                } catch (InvalidOperationException) { if (!DefinitelyExited(child)) throw; }
                finally { if (child != null) child.Dispose(); }
            }
            }
            return pinned;
        } catch { pinned.Dispose(); throw; }
    }
    public void Stop(ServerProcess process) {
        if (process.Handle == null) throw new InvalidOperationException("Cannot stop a process without its ownership handle.");
        Process retained = process.Handle;
        if (retained.HasExited) return;
        int serverId = process.ProcessId; long serverStarted = process.StartedUtcTicks;
        Action validate = delegate {
            if (retained.Id != serverId || retained.StartTime.ToUniversalTime().Ticks != serverStarted)
                throw new InvalidOperationException("Process ownership changed; nothing was stopped.");
        };
        validate();
        var cleanupBudget = new RuntimeObservationBudget();
        OwnedServerCleanup.Run(cleanupBudget, delegate { return PinOwnedPreparers(serverId, serverStarted, cleanupBudget); },
            delegate { validate(); if (!retained.HasExited) retained.Kill(); },
            milliseconds => retained.WaitForExit(milliseconds), delegate(PreparerLease preparers, RuntimeObservationBudget budget) {
            foreach (var preparer in preparers.Processes) {
                // EOF and the pinned parent guard normally end the child without intervention.
                if (preparer.WaitForExit(budget.Remaining)) continue;
                preparer.Kill();
                if (!preparer.WaitForExit(budget.Remaining)) throw new TimeoutException("The Living Room Display preview preparer did not exit within the cleanup budget.");
            }
        });
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
