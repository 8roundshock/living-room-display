using System;
using System.Threading;

internal static class ActiveInputTests
{
    private sealed class Session : ISessionSignals
    {
        public event Action Ended;
        public bool HasEnded { get; private set; }
        internal bool Disposed;
        public void Dispose() { Disposed = true; }
        internal void End() { HasEnded = true; if (Ended != null) Ended(); }
    }
    private sealed class Preview : IPreviewSession
    {
        public bool PreviewEnabled { get { return true; } }
        internal Action<CancellationToken> Upload;
        internal Action ClearAction = delegate { };
        internal int Clears;
        public void UploadDesktop(CancellationToken token) { Upload(token); }
        public void Clear() { Interlocked.Increment(ref Clears); ClearAction(); }
    }
    private sealed class Browser : IAmbientBrowser { public bool IsEmpty { get { return false; } } public void Dispose() { } }
    private static InputStamp Stamp(uint tick) { return new InputStamp { Success = true, Tick = tick }; }
    private static void Check(bool ok, string why) { if (!ok) throw new Exception(why); }
    private static void Main()
    {
        var baseline = new ActiveInputBaseline(Stamp(100));
        Check(!baseline.Observe(Stamp(100)), "unchanged input cannot cancel");
        Check(baseline.Observe(Stamp(101)), "single early change must cancel immediately");
        Check(baseline.Observe(Stamp(101)), "single early change cannot be adopted/forgotten later");
        Check(baseline.Observe(Stamp(100)), "a terminal change cannot reopen after tick wrap/reversion");
        Check(!new ActiveInputBaseline(Stamp(0)).Changed, "valid zero tick is not an input-read failure");
        Check(new ActiveInputBaseline(new InputStamp()).Changed, "failed initial read cancels startup");
        Check(new ActiveInputBaseline(Stamp(100)).Observe(new InputStamp()), "failed later read cancels session");

        uint tick = 100; int ended = 0, reads = 0;
        var session = new Session();
        using (var signals = new ActiveSessionSignals(session, delegate { reads++; return Stamp(tick); }, delegate { return false; }, false))
        {
            signals.Ended += delegate { ended++; };
            tick = 101; signals.Poll(); signals.Poll();
            Check(signals.HasEnded && ended == 1, "actual caller must latch and signal one early input");
        }
        Check(session.Disposed, "input monitor must dispose session subscription");

        session = new Session(); tick = 100; int handshakes = 0;
        using (var signals = new ActiveSessionSignals(session, delegate { return Stamp(tick); }, delegate { return false; }, false))
        using (var startup = new SessionStartup(signals, delegate { tick = 101; signals.Poll(); },
            delegate { handshakes++; return null; }, delegate { return new Browser(); }))
            Check(!startup.Start() && handshakes == 0, "early cold-start input must skip handshake/capture/browser");

        session = new Session(); tick = 100; int launches = 0; bool? started = null;
        var preview = new Preview(); Exception failure = null;
        using (var entered = new ManualResetEvent(false))
        using (var aborted = new ManualResetEvent(false))
        using (var signals = new ActiveSessionSignals(session, delegate { return Stamp(tick); }, delegate { return false; }, false))
        {
            preview.Upload = delegate(CancellationToken token) {
                using (token.Register(delegate { aborted.Set(); })) { entered.Set(); Check(aborted.WaitOne(3000), "early input did not abort delayed upload"); token.ThrowIfCancellationRequested(); }
            };
            using (var startup = new SessionStartup(signals, delegate { }, delegate { return preview; }, delegate { launches++; return new Browser(); }))
            {
                var worker = new Thread(delegate() { try { started = startup.Start(); } catch (Exception error) { failure = error; } });
                worker.Start(); Check(entered.WaitOne(3000), "upload fixture not reached");
                tick = 101; signals.Poll();
                Check(worker.Join(3000) && failure == null && started == false && launches == 0 && preview.Clears > 0,
                    "single startup input must abort transport, clear RAM and prevent browser");
            }
        }
        session = new Session(); session.End();
        using (var signals = new ActiveSessionSignals(session, delegate { return Stamp(100); }, delegate { return false; }, false))
            Check(signals.HasEnded, "session end before monitor subscription must remain terminal");
        using (var enteredRead = new ManualResetEvent(false))
        using (var releaseRead = new ManualResetEvent(false))
        {
            int calls = 0; ended = 0;
            var signals = new ActiveSessionSignals(new Session(), delegate {
                if (Interlocked.Increment(ref calls) > 1) { enteredRead.Set(); Check(releaseRead.WaitOne(3000), "read fixture release missing"); return Stamp(101); }
                return Stamp(100);
            }, delegate { return false; }, false);
            signals.Ended += delegate { ended++; };
            var reader = new Thread(signals.Poll); reader.Start();
            Check(enteredRead.WaitOne(3000), "in-flight read fixture not entered");
            signals.Dispose(); releaseRead.Set(); Check(reader.Join(3000) && ended == 0, "disposed monitor fired a late callback");
            int readsAfterDispose = calls; signals.Poll(); Check(calls == readsAfterDispose, "disposed/idle monitor performed new input work");
        }
        using (var enteredClear = new ManualResetEvent(false))
        using (var releaseClear = new ManualResetEvent(false))
        using (var disposed = new ManualResetEvent(false))
        {
            session = new Session(); preview = new Preview { Upload = delegate { } };
            preview.ClearAction = delegate { enteredClear.Set(); Check(releaseClear.WaitOne(3000), "clear fixture release missing"); };
            var startup = new SessionStartup(session, delegate { }, delegate { return preview; }, delegate { return new Browser(); });
            Check(startup.Start(), "clear-lifetime startup failed");
            var cancellation = new Thread(session.End); cancellation.Start(); Check(enteredClear.WaitOne(3000), "cancellation clear not entered");
            var disposer = new Thread(delegate() { startup.Dispose(); disposed.Set(); }); disposer.Start();
            Check(!disposed.WaitOne(100), "session disposed before its in-flight RAM clear finished");
            releaseClear.Set(); Check(cancellation.Join(3000) && disposer.Join(3000), "cleanup serialization failed");
            int clears = preview.Clears; session.End(); Check(preview.Clears == clears, "disposed old session could clear a replacement's RAM frame");
        }
        Console.WriteLine("Active input PASS: fixed caller baseline, early input latch, read failure, startup cancellation/clear and terminal session cleanup; no native/UI/input injection.");
    }
}
