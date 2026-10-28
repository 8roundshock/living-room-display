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
        internal int Locks, Releases, Launches, Saves, Stops, Deletes, Waits, HealthReads, OwnerThread;
        internal ServerProcess Stopped;
        internal ServerRecord Saved;
        internal Action<CancellationToken> LockAction = delegate { };
        internal Action<CancellationToken> WaitAction = delegate { };
        internal Action SaveAction = delegate { };
        internal Action StopAction = delegate { };
        internal Action HealthAction = delegate { };
        internal Action AssertAction = delegate { };
        internal Action RecordAction = delegate { };
        internal Action InspectAction = delegate { };
        internal Action ListenerAction = delegate { };
        internal Action PortAction = delegate { };
        public void AssertInstalled() { AssertAction(); }
        public IDisposable AcquireLock(CancellationToken token) {
            Locks++; OwnerThread = Thread.CurrentThread.ManagedThreadId; LockAction(token); token.ThrowIfCancellationRequested();
            return new Lease(delegate { Check(Thread.CurrentThread.ManagedThreadId == OwnerThread, "mutex released from observation worker"); Releases++; });
        }
        public ServerRecord ReadRecord() { RecordAction(); return Copy(Record); }
        public ServerProcess Inspect(int pid) { InspectAction(); return Current != null && Current.ProcessId == pid ? Copy(Current) : null; }
        public bool Healthy() { HealthReads++; HealthAction(); return Health; }
        public bool PortInUse() { PortAction(); return ForeignPort; }
        public bool HasOwnedListener(ServerProcess process) { ListenerAction(); return Listening; }
        public ServerProcess Launch() {
            Check(Thread.CurrentThread.ManagedThreadId == OwnerThread, "launch moved to observation worker");
            Launches++;
            Current = new ServerProcess { ProcessId = 123, StartedUtcTicks = 638966016001234567,
                ExecutablePath = NodePath, CommandLine = "\"" + NodePath + "\" \"" + EntryPath + "\"" };
            return Copy(Current);
        }
        public void SaveRecord(ServerRecord record) { Check(Thread.CurrentThread.ManagedThreadId == OwnerThread, "record save moved to observation worker"); Saves++; SaveAction(); Saved = Copy(record); Record = Copy(record); }
        public void DeleteRecordIfMatches(ServerRecord record) {
            Check(Thread.CurrentThread.ManagedThreadId == OwnerThread, "record delete moved to observation worker");
            if (Record != null && Record.ProcessId == record.ProcessId && Record.StartedUtcTicks == record.StartedUtcTicks) {
                Deletes++; Record = null;
            }
        }
        public void Stop(ServerProcess process) { Check(Thread.CurrentThread.ManagedThreadId == OwnerThread, "process stop moved to observation worker"); Stops++; Stopped = Copy(process); StopAction(); }
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
    private sealed class CountedLease : IDisposable {
        internal int Disposals;
        internal readonly ManualResetEvent Disposed = new ManualResetEvent(false);
        public void Dispose() { Interlocked.Increment(ref Disposals); Disposed.Set(); }
    }
    private static void BlockedObservation(string phase, bool cancel) {
        var env = new Environment(); env.Existing();
        if (phase == "port") { env.Record = null; env.Current = null; }
        using (var entered = new ManualResetEvent(false))
        using (var release = new ManualResetEvent(false))
        using (var returned = new ManualResetEvent(false))
        using (var cancellation = new CancellationTokenSource()) {
            Action blocked = delegate { entered.Set(); Check(release.WaitOne(5000), "blocked observation was not released by fixture"); returned.Set(); };
            if (phase == "installation") env.AssertAction = blocked;
            else if (phase == "record") env.RecordAction = blocked;
            else if (phase == "inspect") env.InspectAction = blocked;
            else if (phase == "listener") env.ListenerAction = blocked;
            else if (phase == "health") env.HealthAction = blocked;
            else env.PortAction = blocked;
            Exception failure = null;
            var caller = new Thread(delegate() {
                try { new ServerRuntime(env, cancel ? 10000 : 500).Start(cancellation.Token); }
                catch (Exception error) { failure = error; }
            });
            caller.IsBackground = true; caller.Start();
            try {
                Check(entered.WaitOne(3000), "observation did not enter");
                if (cancel) cancellation.Cancel();
                Check(caller.Join(3000), "caller still waited for abandoned read");
                Check(cancel ? failure is OperationCanceledException : failure is TimeoutException, "unknown observation lost cancellation/timeout identity");
                Check(env.Launches == 0 && env.Saves == 0 && env.Stops == 0 && env.Deletes == 0 && env.Releases == 1,
                    "unknown observation authorized startup mutation or retained mutex");
            } finally { release.Set(); Check(caller.Join(3000), "blocked caller did not finish"); }
            Check(returned.WaitOne(3000), "late read did not leave its fixture");
            Check(env.Launches == 0 && env.Saves == 0 && env.Stops == 0 && env.Deletes == 0, "late observation mutated startup");
        }
    }
    private static void LateResultsAndCancellation() {
        using (var entered = new ManualResetEvent(false))
        using (var release = new ManualResetEvent(false)) {
            var lease = new CountedLease();
            try {
                var budget = new RuntimeObservationBudget(500);
                Throws<TimeoutException>(delegate {
                    budget.Read(delegate { entered.Set(); Check(release.WaitOne(5000), "late lease fixture stalled"); return lease; }, CancellationToken.None);
                }, "late disposable observation did not time out");
                Check(entered.WaitOne(0) && lease.Disposals == 0, "late lease disposed before it existed");
                release.Set(); Check(lease.Disposed.WaitOne(3000) && lease.Disposals == 1, "late returned handle was not closed exactly once");
            } finally { release.Set(); lease.Disposed.Dispose(); }
        }
        using (var cancellation = new CancellationTokenSource()) {
            var lease = new CountedLease();
            try {
                Throws<OperationCanceledException>(delegate {
                    new RuntimeObservationBudget().Read(delegate { cancellation.Cancel(); return lease; }, cancellation.Token);
                }, "just-returned observation beat cancellation");
                Check(lease.Disposals == 1, "cancelled returned result was leaked or double-closed");
            } finally { lease.Disposed.Dispose(); }
        }
        using (var entered = new ManualResetEvent(false))
        using (var release = new ManualResetEvent(false))
        using (var ended = new ManualResetEvent(false)) {
            try {
                Throws<TimeoutException>(delegate {
                    new RuntimeObservationBudget(500).Read<int>(delegate {
                        entered.Set(); Check(release.WaitOne(5000), "late exception fixture stalled");
                        try { throw new InvalidOperationException("synthetic late read error"); } finally { ended.Set(); }
                    }, CancellationToken.None);
                }, "late exception read did not time out");
                Check(entered.WaitOne(0), "late exception fixture did not start");
            } finally { release.Set(); }
            Check(ended.WaitOne(3000), "late exception reader did not finish");
        }
    }
    private static void BoundedCleanup(bool timeout) {
        using (var entered = new ManualResetEvent(false))
        using (var release = new ManualResetEvent(false)) {
            int parentKills = 0, childCalls = 0, caller = Thread.CurrentThread.ManagedThreadId;
            var children = new CountedLease();
            try {
                Action terminate = delegate { Check(Thread.CurrentThread.ManagedThreadId == caller, "parent kill moved to discovery worker"); parentKills++; };
                Func<CountedLease> discover = delegate {
                    if (!timeout) throw new InvalidOperationException("synthetic unknown discovery");
                    entered.Set(); Check(release.WaitOne(5000), "late discovery fixture stalled"); return children;
                };
                Throws<InvalidOperationException>(delegate {
                    OwnedServerCleanup.Run(new RuntimeObservationBudget(timeout ? 500 : 10000), discover, terminate,
                        remaining => { Check(remaining >= 0 && remaining <= (timeout ? 500 : 10000), "parent wait exceeded single cleanup budget"); return true; },
                        delegate { childCalls++; });
                }, "unknown discovery was acknowledged as complete");
                Check(parentKills == 1 && childCalls == 0, "unknown discovery skipped pinned parent or authorized child kills");
                if (timeout) {
                    Check(entered.WaitOne(0), "blocked discovery never began");
                    release.Set(); Check(children.Disposed.WaitOne(3000) && children.Disposals == 1, "late discovery handles leaked");
                    Check(parentKills == 1 && childCalls == 0, "late discovery mutated cleanup");
                }
            } finally { release.Set(); children.Disposed.Dispose(); }
        }
    }
    private static void NewObservationContracts() {
        foreach (string phase in new[] { "installation", "record", "inspect", "listener", "health", "port" }) {
            string selected = phase;
            Scenario("cancel blocked read-only " + selected, delegate { BlockedObservation(selected, true); });
            Scenario("timeout blocked read-only " + selected, delegate { BlockedObservation(selected, false); });
        }
        Scenario("late disposable results and cancellation precedence", LateResultsAndCancellation);
        Scenario("unknown discovery keeps parent-only cleanup", delegate { BoundedCleanup(false); });
        Scenario("blocked discovery keeps parent-only cleanup", delegate { BoundedCleanup(true); });
        Scenario("unreadable recorded identity is unknown, not absent", delegate {
            var env = new Environment(); env.Existing(); env.Listening = false;
            env.InspectAction = delegate { throw new System.ComponentModel.Win32Exception(5, "synthetic unreadable identity"); };
            Throws<System.ComponentModel.Win32Exception>(delegate { new ServerRuntime(env).Start(CancellationToken.None); }, "unreadable identity authorized fallback launch");
            Check(env.Launches == 0 && env.Saves == 0 && env.Stops == 0 && env.Deletes == 0 && env.Releases == 1,
                "unknown identity advanced startup or lost mutex");
        });
        Scenario("live missing identity fields cannot authorize fallback startup", delegate {
            foreach (bool command in new[] { false, true }) {
                var env = new Environment(); env.Existing(); env.Listening = false;
                if (command) env.Current.CommandLine = null; else env.Current.ExecutablePath = " ";
                Throws<InvalidOperationException>(delegate { new ServerRuntime(env).Start(CancellationToken.None); }, "unreadable live field became missing server");
                Check(env.Launches == 0 && env.Saves == 0 && env.Stops == 0 && env.Deletes == 0 && env.Releases == 1, "unknown live fields mutated startup");
            }
        });
        Scenario("required child identity is complete before foreign match decision", delegate {
            string expected = @"C:\Synthetic install\app\windows\LivingRoomDisplay.Preview.exe";
            Check(ObservedProcessIdentity.ChildMatches(1, (uint)77, expected.ToUpperInvariant(), 77, expected), "well-formed child identity did not match");
            Check(!ObservedProcessIdentity.ChildMatches(1, (uint)78, expected, 77, expected), "known foreign parent was adopted");
            Check(!ObservedProcessIdentity.ChildMatches(1, (uint)77, @"C:\Other\other.exe", 77, expected), "known foreign executable was adopted");
            foreach (int rows in new[] { 0, 2 })
                Throws<InvalidOperationException>(delegate { ObservedProcessIdentity.ChildMatches(rows, (uint)77, expected, 77, expected); }, "missing/ambiguous child row became complete discovery");
            foreach (object value in new object[] { null, 0, -1, "77", true, uint.MaxValue, ulong.MaxValue }) {
                object candidate = value;
                Throws<InvalidOperationException>(delegate { ObservedProcessIdentity.ChildMatches(1, candidate, expected, 77, expected); }, "invalid parent field became complete discovery");
            }
            foreach (object value in new object[] { null, "", " ", 77 }) {
                object candidate = value;
                Throws<InvalidOperationException>(delegate { ObservedProcessIdentity.ChildMatches(1, (uint)77, candidate, 77, expected); }, "invalid executable field became complete discovery");
                Throws<InvalidOperationException>(delegate { ObservedProcessIdentity.RequiredText(candidate); }, "unreadable module identity accepted");
            }
        });
        Scenario("unreadable child discovery retains record after exact parent request", delegate {
            var env = new Environment(); int parentKills = 0, childKills = 0;
            var primary = new IOException("synthetic cold startup failure");
            env.WaitAction = delegate { throw primary; };
            env.StopAction = delegate {
                OwnedServerCleanup.Run<CountedLease>(new RuntimeObservationBudget(),
                    delegate { throw new System.ComponentModel.Win32Exception(5, "synthetic unreadable preparer identity"); },
                    delegate { Check(env.Stopped.ProcessId == 123 && env.Stopped.StartedUtcTicks == env.Saved.StartedUtcTicks, "unknown discovery changed parent target"); parentKills++; },
                    delegate { return true; }, delegate { childKills++; });
            };
            try { new ServerRuntime(env).Start(CancellationToken.None); throw new Exception("unknown discovery was accepted as complete"); }
            catch (AggregateException failure) {
                Check(object.ReferenceEquals(failure.InnerExceptions[0], primary) && failure.InnerExceptions[1].InnerException is System.ComponentModel.Win32Exception,
                    "unreadable discovery erased primary or unknown cause");
            }
            Check(parentKills == 1 && childKills == 0 && env.Deletes == 0 && env.Record != null && env.Releases == 1,
                "unknown candidate authorized child kill or recovery deletion");
        });
        Scenario("one observation budget spans phases and mutex wait", delegate {
            long elapsed = 0; var env = new Environment();
            env.AssertAction = delegate { Interlocked.Add(ref elapsed, 6); };
            env.RecordAction = delegate { Interlocked.Add(ref elapsed, 5); };
            Throws<TimeoutException>(delegate { new ServerRuntime(env, 10, delegate { return Interlocked.Read(ref elapsed); }).Start(CancellationToken.None); },
                "each phase received a fresh timeout");
            Check(env.Launches == 0 && env.Saves == 0 && env.Releases == 1, "exhausted observation budget advanced startup");
            elapsed = 0; env = new Environment(); env.LockAction = delegate { Interlocked.Add(ref elapsed, 11); };
            Throws<TimeoutException>(delegate { new ServerRuntime(env, 10, delegate { return Interlocked.Read(ref elapsed); }).Start(CancellationToken.None); },
                "mutex wait did not consume startup observation budget");
            Check(env.Launches == 0 && env.Releases == 1, "expired mutex phase retained lease or launched");
        });
        Scenario("parent and child waits share discovery budget", delegate {
            long elapsed = 0; int parentKills = 0, childrenCalls = 0;
            var children = new CountedLease();
            try {
                OwnedServerCleanup.Run(new RuntimeObservationBudget(10, delegate { return Interlocked.Read(ref elapsed); }),
                    delegate { Interlocked.Add(ref elapsed, 6); return children; }, delegate { parentKills++; },
                    remaining => { Check(remaining == 4, "parent wait reset discovery budget"); Interlocked.Add(ref elapsed, 3); return true; },
                    delegate(CountedLease lease, RuntimeObservationBudget budget) { Check(object.ReferenceEquals(children, lease) && budget.Remaining == 1, "child waits reset cleanup budget"); childrenCalls++; });
                Check(parentKills == 1 && childrenCalls == 1 && children.Disposals == 1, "successful cleanup lost its exact lease");
            } finally { children.Disposed.Dispose(); }
        });
        Scenario("post-launch cancelled read cleans exact child on caller", delegate {
            var env = new Environment { Health = true, Listening = true };
            using (var cancellation = new CancellationTokenSource()) {
                env.InspectAction = delegate { cancellation.Cancel(); };
                Throws<OperationCanceledException>(delegate { new ServerRuntime(env).Start(cancellation.Token); }, "postlaunch observation cancelled late");
                Check(env.Launches == 1 && env.Stops == 1 && env.Stopped.ProcessId == 123 && env.Releases == 1, "postlaunch cancellation lost exact child cleanup");
            }
        });
        Scenario("startup and incomplete cleanup errors both survive", delegate {
            var env = new Environment();
            var startup = new IOException("synthetic primary wait failure"); var cleanup = new InvalidOperationException("synthetic incomplete discovery");
            env.WaitAction = delegate { throw startup; }; env.StopAction = delegate { throw cleanup; };
            try { new ServerRuntime(env).Start(CancellationToken.None); throw new Exception("incomplete cleanup succeeded"); }
            catch (AggregateException failure) {
                Check(failure.InnerExceptions.Count == 2 && object.ReferenceEquals(failure.InnerExceptions[0], startup) &&
                    object.ReferenceEquals(failure.InnerExceptions[1], cleanup), "cleanup failure hid original startup error");
            }
            Check(env.Stops == 1 && env.Deletes == 0 && env.Record != null && env.Releases == 1, "incomplete cleanup deleted recovery record");
        });
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
        try { Run(); RecordFiles(); NewObservationContracts(); Console.WriteLine(cases + " server runtime contract scenarios passed; fake processes/listeners/waits and isolated record files only."); return 0; }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
