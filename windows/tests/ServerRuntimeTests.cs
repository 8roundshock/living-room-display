using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;

// Independent runtime contract regressions. All processes, listeners and waits are fake;
// this executable starts no server, PowerShell, browser, capture or Windows setting change.
internal static class ServerRuntimeTests {
    private sealed class Lease : IDisposable {
        private Action release;
        internal Lease(Action release) { this.release = release; }
        public void Dispose() { if (release != null) { release(); release = null; } }
    }
    private sealed class Environment : IServerRuntimeEnvironment {
        public string NodePath { get { return @"C:\Synthetic install\runtime\node.exe"; } }
        public string EntryPath { get { return @"C:\Synthetic install\app\dist\server\index.js"; } }
        internal ServerRecord Record;
        internal ServerProcess Current;
        internal bool Health, Listening, ForeignPort;
        internal int Locks, Releases, Launches, Saves, Stops, Deletes, Waits, HealthReads;
        internal ServerProcess Stopped;
        internal ServerRecord Saved;
        internal Action<CancellationToken> LockAction = delegate { };
        internal Action<CancellationToken> WaitAction = delegate { };
        internal Action SaveAction = delegate { };
        internal Action StopAction = delegate { };
        internal Action HealthAction = delegate { };
        internal Action AssertAction = delegate { };
        public void AssertInstalled() { AssertAction(); }
        public IDisposable AcquireLock(CancellationToken token) {
            Locks++; LockAction(token); token.ThrowIfCancellationRequested();
            return new Lease(delegate { Releases++; });
        }
        public ServerRecord ReadRecord() { return Copy(Record); }
        public ServerProcess Inspect(int pid) { return Current != null && Current.ProcessId == pid ? Copy(Current) : null; }
        public bool Healthy() { HealthReads++; HealthAction(); return Health; }
        public bool PortInUse() { return ForeignPort; }
        public bool HasOwnedListener(ServerProcess process) { return Listening; }
        public ServerProcess Launch() {
            Launches++;
            Current = new ServerProcess { ProcessId = 123, StartedUtcTicks = 638966016001234567,
                ExecutablePath = NodePath, CommandLine = "\"" + NodePath + "\" \"" + EntryPath + "\"" };
            return Copy(Current);
        }
        public void SaveRecord(ServerRecord record) { Saves++; SaveAction(); Saved = Copy(record); Record = Copy(record); }
        public void DeleteRecordIfMatches(ServerRecord record) {
            if (Record != null && Record.ProcessId == record.ProcessId && Record.StartedUtcTicks == record.StartedUtcTicks) {
                Deletes++; Record = null;
            }
        }
        public void Stop(ServerProcess process) { Stops++; Stopped = Copy(process); StopAction(); }
        public void Wait(int milliseconds, CancellationToken token) {
            Check(milliseconds == 250, "startup wait must remain bounded in 250ms steps");
            Waits++; WaitAction(token); token.ThrowIfCancellationRequested();
        }
        internal void Existing() {
            Current = new ServerProcess { ProcessId = 77, StartedUtcTicks = 638966016001234567,
                ExecutablePath = NodePath, CommandLine = "\"" + NodePath + "\" \"" + EntryPath + "\"" };
            Record = new ServerRecord { ProcessId = Current.ProcessId, StartedUtcTicks = Current.StartedUtcTicks };
            Health = Listening = true;
        }
    }
    private static ServerRecord Copy(ServerRecord value) {
        return value == null ? null : new ServerRecord { ProcessId = value.ProcessId, StartedUtcTicks = value.StartedUtcTicks };
    }
    private static ServerProcess Copy(ServerProcess value) {
        return value == null ? null : new ServerProcess { ProcessId = value.ProcessId, StartedUtcTicks = value.StartedUtcTicks,
            ExecutablePath = value.ExecutablePath, CommandLine = value.CommandLine, Exited = value.Exited };
    }
    private static void Check(bool condition, string reason) { if (!condition) throw new Exception(reason); }
    private static void Throws<T>(Action action, string reason) where T : Exception {
        try { action(); } catch (T) { return; }
        throw new Exception(reason);
    }
    private static int cases;
    private static void Scenario(string name, Action action) {
        try { action(); cases++; } catch (Exception error) { throw new Exception(name + ": " + error.Message, error); }
    }
    private static void RecordFiles() {
        string root = Path.Combine(Path.GetTempPath(), "lrd-server-record-test-" + Guid.NewGuid().ToString("N"));
        string app = Path.Combine(root, "app"), run = Path.Combine(root, "run"), file = Path.Combine(run, "server.json");
        Directory.CreateDirectory(app); Directory.CreateDirectory(run);
        try {
            var env = new WindowsServerEnvironment(app);
            Scenario("read prior PowerShell record schema", delegate {
                File.WriteAllText(file, "{\"processId\":77,\"startedAt\":\"2026-10-21T12:34:56.1234567-04:00\"}");
                var record = env.ReadRecord();
                long expected = DateTimeOffset.Parse("2026-10-21T16:34:56.1234567Z", CultureInfo.InvariantCulture).UtcDateTime.Ticks;
                Check(record.ProcessId == 77 && record.StartedUtcTicks == expected, "offset or submillisecond birth identity lost");
            });
            Scenario("native record remains PowerShell compatible", delegate {
                var expected = new ServerRecord { ProcessId = 123, StartedUtcTicks = 638966016001234567 };
                env.SaveRecord(expected);
                var value = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(file)) as Dictionary<string, object>;
                Check(value != null && value.Count == 2 && value.ContainsKey("processId") && value.ContainsKey("startedAt"), "shared record schema changed");
                Check(Convert.ToInt32(value["processId"], CultureInfo.InvariantCulture) == expected.ProcessId, "processId changed");
                Check(DateTimeOffset.Parse((string)value["startedAt"], CultureInfo.InvariantCulture).UtcDateTime.Ticks == expected.StartedUtcTicks, "PowerShell date conversion would lose birth time");
                Check(File.ReadAllBytes(file)[0] == (byte)'{', "record has an unexpected BOM");
                Check(Directory.GetFiles(run).Length == 1, "atomic write left a temporary file");
                var read = env.ReadRecord(); Check(read.ProcessId == expected.ProcessId && read.StartedUtcTicks == expected.StartedUtcTicks, "native round trip differs");
            });
            Scenario("record cleanup preserves changed process birth", delegate {
                var record = env.ReadRecord();
                env.DeleteRecordIfMatches(new ServerRecord { ProcessId = record.ProcessId, StartedUtcTicks = record.StartedUtcTicks + 1 });
                Check(File.Exists(file), "changed birth record deleted");
                env.DeleteRecordIfMatches(new ServerRecord { ProcessId = record.ProcessId + 1, StartedUtcTicks = record.StartedUtcTicks });
                Check(File.Exists(file), "changed pid record deleted");
                env.DeleteRecordIfMatches(record);
                Check(!File.Exists(file) && env.ReadRecord() == null, "exact record not removed");
            });
            Scenario("invalid persisted ownership fails closed", delegate {
                foreach (string json in new[] { "{}", "null", "not json", "{\"processId\":0,\"startedAt\":\"2026-10-21T00:00:00Z\"}",
                    "{\"processId\":-1,\"startedAt\":\"2026-10-21T00:00:00Z\"}", "{\"processId\":1.5,\"startedAt\":\"2026-10-21T00:00:00Z\"}",
                    "{\"processId\":123,\"startedAt\":\"invalid\"}" }) {
                    File.WriteAllText(file, json); Check(env.ReadRecord() == null, "invalid record became ownership: " + json);
                }
            });
            Scenario("runtime paths and mutex are installation scoped", delegate {
                Check(env.NodePath == Path.Combine(root, "runtime", "node.exe") && env.EntryPath == Path.Combine(app, "dist", "server", "index.js"), "runtime looks outside its own installation");
                Check(WindowsServerEnvironment.LockName(root) == WindowsServerEnvironment.LockName(root.ToUpperInvariant()), "Windows path casing splits startup mutex");
                Check(WindowsServerEnvironment.LockName(root) != WindowsServerEnvironment.LockName(root + "-other"), "separate installs share startup mutex");
            });
            Scenario("production launch targets owned Node without a shell", delegate {
                string priorData = System.Environment.GetEnvironmentVariable("LRD_DATA_DIR"), priorPort = System.Environment.GetEnvironmentVariable("LRD_PORT"), priorPreparer = System.Environment.GetEnvironmentVariable("LRD_PREVIEW_PREPARER"), priorDisabled = System.Environment.GetEnvironmentVariable("LRD_PREVIEW_PREPARER_DISABLED");
                try {
                    System.Environment.SetEnvironmentVariable("LRD_DATA_DIR", "synthetic-unrelated-data");
                    System.Environment.SetEnvironmentVariable("LRD_PORT", "12345");
                    System.Environment.SetEnvironmentVariable("LRD_PREVIEW_PREPARER", "synthetic-parent-value");
                    System.Environment.SetEnvironmentVariable("LRD_PREVIEW_PREPARER_DISABLED", null);
                    var start = env.CreateStartInfo();
                    Check(start.FileName == env.NodePath && start.Arguments == "\"" + env.EntryPath + "\"", "launch must use exact installed Node and quoted entry");
                    Check(!start.UseShellExecute && start.CreateNoWindow && start.WindowStyle == System.Diagnostics.ProcessWindowStyle.Hidden, "server launch must be hidden and shell-free");
                    Check(start.WorkingDirectory == app, "server working directory changed");
                    Check(start.EnvironmentVariables["LRD_DATA_DIR"] == Path.Combine(root, "data") && start.EnvironmentVariables["LRD_PORT"] == "4318", "inherited data/port escaped installation scope");
                    Check(System.Environment.GetEnvironmentVariable("LRD_PORT") == "12345", "launch preparation mutated parent environment");
                    Check(start.EnvironmentVariables["LRD_PREVIEW_PREPARER"] == "1" && System.Environment.GetEnvironmentVariable("LRD_PREVIEW_PREPARER") == "synthetic-parent-value", "preparer opt-in escaped child environment");
                    System.Environment.SetEnvironmentVariable("LRD_PREVIEW_PREPARER_DISABLED", "1");
                    Check(env.CreateStartInfo().EnvironmentVariables["LRD_PREVIEW_PREPARER"] == "0", "synthetic CI opt-out failed to suppress preparer");
                } finally {
                    System.Environment.SetEnvironmentVariable("LRD_DATA_DIR", priorData); System.Environment.SetEnvironmentVariable("LRD_PORT", priorPort);
                    System.Environment.SetEnvironmentVariable("LRD_PREVIEW_PREPARER", priorPreparer);
                    System.Environment.SetEnvironmentVariable("LRD_PREVIEW_PREPARER_DISABLED", priorDisabled);
                }
            });
        } finally {
            // Exact files in a uniquely-created synthetic directory; no recursive deletion.
            if (File.Exists(file)) File.Delete(file);
            Directory.Delete(run); Directory.Delete(app); Directory.Delete(root);
        }
    }
    private static void Run() {
        Scenario("existing healthy owned server", delegate {
            var env = new Environment(); env.Existing();
            new ServerRuntime(env).Start(CancellationToken.None);
            Check(env.Launches == 0 && env.Stops == 0 && env.Saves == 0 && env.Deletes == 0, "reuse must leave process and record alone");
            Check(env.Locks == 1 && env.Releases == 1, "reuse releases startup lock");
        });
        foreach (bool unhealthy in new[] { true, false }) {
            bool mode = unhealthy;
            Scenario(mode ? "owned unhealthy server" : "owned record but foreign healthy listener", delegate {
                var env = new Environment(); env.Existing(); env.Health = !mode; env.Listening = mode;
                Throws<InvalidOperationException>(delegate { new ServerRuntime(env).Start(CancellationToken.None); }, "unsafe reuse accepted");
                Check(env.Stops == 0 && env.Launches == 0 && env.Record != null && env.Releases == 1, "existing process must not be killed or replaced");
            });
        }
        foreach (bool healthy in new[] { true, false }) {
            bool health = healthy;
            Scenario("foreign listener health=" + health, delegate {
                var env = new Environment { ForeignPort = true, Health = health };
                Throws<InvalidOperationException>(delegate { new ServerRuntime(env).Start(CancellationToken.None); }, "foreign port accepted");
                Check(env.Launches == 0 && env.Stops == 0 && env.Saves == 0, "foreign listener must never be replaced");
            });
        }
        var mismatches = new Dictionary<string, Action<Environment>> {
            { "absent process", e => e.Current = null },
            { "reused PID", e => e.Current.StartedUtcTicks++ },
            { "other PID", e => e.Record.ProcessId++ },
            { "other executable", e => e.Current.ExecutablePath += ".other" },
            { "other entry", e => e.Current.CommandLine = "node.exe \"C:\\another\\index.js\"" },
            { "unquoted entry", e => e.Current.CommandLine = e.EntryPath },
            { "missing command", e => e.Current.CommandLine = null },
            { "exited", e => e.Current.Exited = true }
        };
        foreach (var item in mismatches) {
            var mismatch = item;
            Scenario("ownership rejects " + mismatch.Key, delegate {
                var env = new Environment(); env.Existing(); mismatch.Value(env);
                Check(!ServerRuntime.Matches(env.Record, env.Current, env.NodePath, env.EntryPath), "bad identity matched");
                var runtime = new ServerRuntime(env);
                var status = runtime.Status(CancellationToken.None);
                Check(!status.ServerRunning && !status.Healthy && env.HealthReads == 0, "foreign health must not count as owned status");
                runtime.Stop(CancellationToken.None);
                Check(env.Stops == 0 && env.Deletes == 0, "stale record must not authorize stop/delete");
            });
        }
        Scenario("case insensitive path and full timestamp precision", delegate {
            var env = new Environment(); env.Existing();
            env.Current.ExecutablePath = env.NodePath.ToUpperInvariant(); env.Current.CommandLine = env.Current.CommandLine.ToUpperInvariant();
            Check(ServerRuntime.Matches(env.Record, env.Current, env.NodePath, env.EntryPath), "Windows path casing changed ownership");
            env.Record.StartedUtcTicks--;
            Check(!ServerRuntime.Matches(env.Record, env.Current, env.NodePath, env.EntryPath), "one tick mismatch accepted");
        });
        Scenario("cold start record and healthy ownership", delegate {
            var env = new Environment { Health = true, Listening = true };
            new ServerRuntime(env).Start(CancellationToken.None);
            Check(env.Launches == 1 && env.Saves == 1 && env.Waits == 1 && env.Stops == 0, "cold start lifecycle differs");
            Check(env.Saved.ProcessId == env.Current.ProcessId && env.Saved.StartedUtcTicks == env.Current.StartedUtcTicks, "record loses process birth identity");
            Check(env.Releases == 1, "successful startup retained lock");
        });
        Scenario("foreign health cannot complete a new startup", delegate {
            var env = new Environment { Health = true, Listening = false };
            Throws<TimeoutException>(delegate { new ServerRuntime(env).Start(CancellationToken.None); }, "foreign health accepted");
            Check(env.Waits == 40 && env.HealthReads == 0 && env.Stops == 1 && env.Deletes == 1, "timeout must be bounded and clean only child");
        });
        Scenario("pre-cancelled startup", delegate {
            var env = new Environment();
            using (var cancel = new CancellationTokenSource()) {
                cancel.Cancel(); Throws<OperationCanceledException>(delegate { new ServerRuntime(env).Start(cancel.Token); }, "pre-cancel ignored");
            }
            Check(env.Locks == 0 && env.Launches == 0 && env.Stops == 0, "pre-cancel performed work");
        });
        Scenario("cancellation while waiting for lock", delegate {
            var env = new Environment();
            using (var cancel = new CancellationTokenSource()) {
                env.LockAction = delegate { cancel.Cancel(); };
                Throws<OperationCanceledException>(delegate { new ServerRuntime(env).Start(cancel.Token); }, "lock cancellation ignored");
            }
            Check(env.Launches == 0 && env.Saves == 0 && env.Stops == 0, "cancelled lock acquired process ownership");
        });
        Scenario("cancel new startup preserves a replacement record", delegate {
            var env = new Environment();
            using (var cancel = new CancellationTokenSource()) {
                env.WaitAction = delegate { env.Record = new ServerRecord { ProcessId = 999, StartedUtcTicks = 42 }; cancel.Cancel(); };
                Throws<OperationCanceledException>(delegate { new ServerRuntime(env).Start(cancel.Token); }, "startup cancellation ignored");
            }
            Check(env.Stops == 1 && env.Stopped.ProcessId == 123 && env.Stopped.StartedUtcTicks == env.Saved.StartedUtcTicks, "cleanup targeted something other than newly launched child");
            Check(env.Record.ProcessId == 999 && env.Deletes == 0 && env.Releases == 1, "cleanup deleted replacement record or kept lock");
        });
        Scenario("cancel existing server after health", delegate {
            var env = new Environment(); env.Existing();
            using (var cancel = new CancellationTokenSource()) {
                env.HealthAction = delegate { cancel.Cancel(); };
                Throws<OperationCanceledException>(delegate { new ServerRuntime(env).Start(cancel.Token); }, "health cancellation ignored");
            }
            Check(env.Stops == 0 && env.Record != null && env.Launches == 0, "cancellation killed previously running server");
        });
        Scenario("new process exits during startup", delegate {
            var env = new Environment(); env.WaitAction = delegate { env.Current.Exited = true; };
            Throws<InvalidOperationException>(delegate { new ServerRuntime(env).Start(CancellationToken.None); }, "exited process accepted");
            Check(env.Stops == 1 && env.Deletes == 1 && env.Waits == 1, "early exit cleanup not bounded");
        });
        Scenario("record write failure cleans new child", delegate {
            var env = new Environment(); env.SaveAction = delegate { throw new System.IO.IOException("synthetic record write failure"); };
            Throws<System.IO.IOException>(delegate { new ServerRuntime(env).Start(CancellationToken.None); }, "write failure swallowed");
            Check(env.Stops == 1 && env.Waits == 0 && env.Releases == 1, "record failure leaked child or lock");
        });
        Scenario("stop matching process and record", delegate {
            var env = new Environment(); env.Existing();
            new ServerRuntime(env).Stop(CancellationToken.None);
            Check(env.Stops == 1 && env.Stopped.ProcessId == 77 && env.Deletes == 1 && env.Record == null, "stop missed exact owned process/record");
        });
        Scenario("record replacement during stop", delegate {
            var env = new Environment(); env.Existing();
            env.StopAction = delegate { env.Record = new ServerRecord { ProcessId = 77, StartedUtcTicks = 42 }; };
            new ServerRuntime(env).Stop(CancellationToken.None);
            Check(env.Stops == 1 && env.Deletes == 0 && env.Record.StartedUtcTicks == 42, "stop removed changed birth record");
        });
        Scenario("owned status is read only", delegate {
            var env = new Environment(); env.Existing(); var runtime = new ServerRuntime(env);
            var status = runtime.Status(CancellationToken.None);
            Check(status.ServerRunning && status.Healthy, "healthy owned status missed");
            env.Health = false; status = runtime.Status(CancellationToken.None);
            Check(status.ServerRunning && !status.Healthy, "unhealthy owned status lost ownership");
            Check(env.Launches == 0 && env.Stops == 0 && env.Saves == 0 && env.Deletes == 0, "status changed state");
        });
        Scenario("installation refusal has no side effects", delegate {
            var env = new Environment(); env.AssertAction = delegate { throw new InvalidOperationException("synthetic invalid installation"); };
            Throws<InvalidOperationException>(delegate { new ServerRuntime(env).Start(CancellationToken.None); }, "installation guard skipped");
            Check(env.Launches == 0 && env.Stops == 0 && env.Saves == 0 && env.Releases == 1, "invalid install changed state");
        });
    }
    private static int Main() {
        try { Run(); RecordFiles(); Console.WriteLine(cases + " server runtime contract scenarios passed; fake processes/listeners/waits and isolated record files only."); return 0; }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
