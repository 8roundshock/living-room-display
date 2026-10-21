using System;
using System.Threading;

internal static class HostLifecycleTests
{
    private sealed class Signals : ISessionSignals
    {
        public event Action Ended;
        public bool HasEnded { get; private set; }
        internal bool Disposed;
        internal int Subscribers { get { return Ended == null ? 0 : Ended.GetInvocationList().Length; } }
        internal void End() { HasEnded = true; if (Ended != null) Ended(); }
        public void Dispose() { Disposed = true; }
    }
    private sealed class Preview : IPreviewSession
    {
        public bool PreviewEnabled { get { return true; } }
        internal Action<CancellationToken> Upload = delegate { };
        internal int Uploads, Clears;
        public void UploadDesktop(CancellationToken token) { Uploads++; Upload(token); }
        public void Clear() { Interlocked.Increment(ref Clears); }
    }
    private sealed class Browser : IAmbientBrowser
    {
        internal bool Disposed;
        public bool IsEmpty { get { return false; } }
        public void Dispose() { Disposed = true; }
    }
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void BlockedStage(bool handshake)
    {
        Signals signals = new Signals();
        Preview preview = new Preview();
        int launches = 0;
        bool aborted = false;
        bool? started = null;
        Exception failure = null;
        using (ManualResetEvent entered = new ManualResetEvent(false))
        using (ManualResetEvent abort = new ManualResetEvent(false))
        {
            Action<CancellationToken> blockedTransport = delegate(CancellationToken token)
            {
                using (token.Register(delegate { aborted = true; abort.Set(); }))
                {
                    entered.Set();
                    Check(abort.WaitOne(3000), "Transport was not aborted by the session event.");
                    token.ThrowIfCancellationRequested();
                }
            };
            preview.Upload = blockedTransport;
            using (SessionStartup startup = new SessionStartup(signals, delegate { },
                delegate(CancellationToken token) { if (handshake) blockedTransport(token); return preview; },
                delegate { launches++; return new Browser(); }))
            {
                Thread worker = new Thread(delegate()
                {
                    try { started = startup.Start(); } catch (Exception ex) { failure = ex; }
                });
                worker.Start();
                Check(entered.WaitOne(3000), "Startup did not reach the delayed transport.");
                signals.End(); // Synthesized lock/disconnect, no real Windows session change.
                Check(worker.Join(3000), "Cancelled startup did not finish.");
                Check(failure == null, "Cancelled startup escaped as a failure.");
                Check(started == false && aborted && launches == 0, "Cancelled transport allowed kiosk launch.");
                if (!handshake) Check(preview.Clears > 0, "Cancelled upload was not cleared.");
                Check(signals.Disposed && signals.Subscribers == 0, "Cancelled startup leaked its session subscription.");
            }
        }
    }
    private static void BetweenStages()
    {
        Signals signals = new Signals();
        Preview preview = new Preview();
        int handshakes = 0, launches = 0;
        using (SessionStartup startup = new SessionStartup(signals, delegate { signals.End(); },
            delegate { handshakes++; return preview; }, delegate { launches++; return new Browser(); }))
            Check(!startup.Start(), "Session end during cold start was ignored.");
        Check(handshakes == 0 && preview.Uploads == 0 && launches == 0, "Cold-start cancellation continued into capture.");

        signals = new Signals(); preview = new Preview();
        preview.Upload = delegate { signals.End(); };
        using (SessionStartup startup = new SessionStartup(signals, delegate { }, delegate { return preview; },
            delegate { launches++; return new Browser(); }))
            Check(!startup.Start(), "Session end while capture/upload returned was ignored.");
        Check(launches == 0 && preview.Clears > 0, "Post-upload cancellation retained image or launched kiosk.");

        signals = new Signals(); preview = new Preview(); Browser browser = new Browser();
        using (SessionStartup startup = new SessionStartup(signals, delegate { }, delegate { return preview; },
            delegate { signals.End(); return browser; }))
            Check(!startup.Start(), "Session end inside browser creation was ignored.");
        Check(browser.Disposed && preview.Clears > 0, "Cancellation leaked a just-created browser/image.");
    }
    private static void BlockedBrowser()
    {
        Signals signals = new Signals(); Preview preview = new Preview();
        bool? started = null; Exception failure = null;
        using (var entered = new ManualResetEvent(false))
        using (var abort = new ManualResetEvent(false))
        using (SessionStartup startup = new SessionStartup(signals, delegate { }, delegate { return preview; },
            delegate(CancellationToken token) {
                using (token.Register(delegate { abort.Set(); })) {
                    entered.Set(); Check(abort.WaitOne(3000), "Delayed browser creation was not cancelled."); token.ThrowIfCancellationRequested();
                }
                return new Browser();
            }))
        {
            var worker = new Thread(delegate() { try { started = startup.Start(); } catch (Exception error) { failure = error; } });
            worker.Start(); Check(entered.WaitOne(3000), "Delayed browser fixture not entered."); signals.End();
            Check(worker.Join(3000) && failure == null && started == false && preview.Clears > 0 && signals.Disposed,
                "Cancelled delayed browser creation retained startup resources.");
        }
    }
    private static void FailureAndNormalCleanup()
    {
        Signals signals = new Signals(); Preview preview = new Preview();
        bool failed = false;
        try
        {
            using (SessionStartup startup = new SessionStartup(signals, delegate { }, delegate { return preview; },
                delegate { throw new InvalidOperationException("synthetic browser failure"); })) startup.Start();
        }
        catch (InvalidOperationException) { failed = true; }
        Check(failed && preview.Clears > 0 && signals.Disposed && signals.Subscribers == 0, "Constructor failure leaked image/subscription.");

        signals = new Signals(); preview = new Preview(); Browser browser = new Browser();
        using (SessionStartup startup = new SessionStartup(signals, delegate { }, delegate { return preview; }, delegate { return browser; }))
            Check(startup.Start(), "Ordinary startup did not succeed.");
        Check(browser.Disposed && preview.Clears > 0 && signals.Subscribers == 0, "Normal cleanup leaked browser/image/subscription.");
    }
    private static int Main()
    {
        try
        {
            BlockedStage(true);
            BlockedStage(false);
            BlockedBrowser();
            BetweenStages();
            FailureAndNormalCleanup();
            Console.WriteLine("8 native lifecycle scenarios passed with fake transport/session/browser; no capture, UI or registry.");
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
    }
}
