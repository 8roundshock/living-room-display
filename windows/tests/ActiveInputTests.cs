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
    private sealed class Browser : IAmbientBrowser {
        public bool IsEmpty { get { return false; } }
        internal Action Disposing = delegate { };
        internal int Disposals;
        public void Dispose() { Interlocked.Increment(ref Disposals); Disposing(); }
    }
    private static InputStamp Stamp(uint tick) { return new InputStamp { Success = true, Tick = tick }; }
    private static void Check(bool ok, string why) { if (!ok) throw new Exception(why); }
    private static void CancelWithoutUiProgress(bool blockCallback)
    {
        using (var entered = new ManualResetEvent(false))
        using (var release = new ManualResetEvent(false))
        using (var browserReleased = new ManualResetEvent(false))
        {
            var session = new Session();
            var preview = new Preview { Upload = delegate { } };
            var browser = new Browser { Disposing = delegate { browserReleased.Set(); } };
            Action blocked = delegate { entered.Set(); Check(release.WaitOne(3000), "cancel barrier timed out"); };
            if (!blockCallback) preview.ClearAction = blocked;
            var startup = new SessionStartup(session, delegate { }, delegate { return preview; }, delegate { return browser; });
            Check(startup.Start(), "cancellation-only startup failed");
            CancellationTokenRegistration registration = blockCallback ? startup.Token.Register(blocked) : default(CancellationTokenRegistration);
            Exception failure = null;
            var cancellation = new Thread(delegate() { try { session.End(); } catch (Exception error) { failure = error; } });
            bool enteredBlock = false, releasedFirst = false;
            try {
                cancellation.Start();
                enteredBlock = entered.WaitOne(3000);
                // No UI tick and no second Dispose thread may be needed for release.
                releasedFirst = browserReleased.WaitOne(0);
            } finally {
                release.Set();
                Check(cancellation.Join(3000), "cancellation-only worker did not end");
                registration.Dispose(); startup.Dispose();
            }
            Check(enteredBlock && failure == null, "cancellation-only fixture failed");
            Check(releasedFirst, blockCallback ? "browser waited for a synchronous cancellation callback" : "browser waited for UI/disposer progress behind preview clear");
            Check(browser.Disposals == 1, "cancellation plus Dispose released the browser more than once");
        }
    }
    private static void LateBrowserAfterDispose()
    {
        using (var entered = new ManualResetEvent(false))
        using (var release = new ManualResetEvent(false))
        {
            var session = new Session(); var preview = new Preview { Upload = delegate { } }; var browser = new Browser();
            var startup = new SessionStartup(session, delegate { }, delegate { return preview; }, delegate {
                entered.Set(); Check(release.WaitOne(3000), "late browser barrier timed out"); return browser;
            });
            bool? started = null; Exception failure = null;
            var worker = new Thread(delegate() { try { started = startup.Start(); } catch (Exception error) { failure = error; } });
            worker.Start();
            try { Check(entered.WaitOne(3000), "late browser factory was not entered"); session.End(); startup.Dispose(); }
            finally { release.Set(); Check(worker.Join(3000), "late browser factory did not finish"); startup.Dispose(); }
            Check(failure == null && started == false && browser.Disposals == 1, "browser published after Dispose leaked or was released twice");
        }
    }
    private static void ObservationCutoff()
    {
        var session = new Session(); var preview = new Preview { Upload = delegate { } }; var browser = new Browser();
        using (var startup = new SessionStartup(session, delegate { }, delegate { return preview; }, delegate { return browser; }))
        {
            Check(startup.Start(), "observation-cutoff startup failed");
            session.End(); int reads = 0;
            Check(!startup.ObserveWhileActive(delegate { reads++; }) && reads == 0, "cancelled UI poll performed new native observations");
        }
        using (var entered = new ManualResetEvent(false))
        using (var browserReleased = new ManualResetEvent(false))
        {
            session = new Session(); browser = new Browser { Disposing = delegate { browserReleased.Set(); } };
            using (var startup = new SessionStartup(session, delegate { }, delegate { return preview; }, delegate { return browser; }))
            {
                Check(startup.Start(), "blocked-observation startup failed");
                bool? active = null; Exception failure = null;
                var ui = new Thread(delegate() { try { active = startup.ObserveWhileActive(delegate {
                    entered.Set(); Check(browserReleased.WaitOne(3000), "blocked UI did not observe renderer release");
                }); } catch (Exception error) { failure = error; } });
                ui.Start();
                try { Check(entered.WaitOne(3000), "blocked UI observer was not entered"); session.End(); }
                finally { browserReleased.Set(); Check(ui.Join(3000), "blocked UI fixture did not finish"); }
                Check(failure == null && active == false && browser.Disposals == 1, "input did not release renderer independently of blocked UI observation");
            }
        }
    }
    private sealed class DeadlineTicket : IDisposable { public void Dispose() { } }
    private static void BlockedRendererCompletion(bool disposeFirst)
    {
        using (var entered = new ManualResetEvent(false))
        using (var release = new ManualResetEvent(false))
        using (var cleanupEntered = new ManualResetEvent(false))
        using (var cleanupReturned = new ManualResetEvent(false))
        {
            var session = new Session(); var preview = new Preview { Upload = delegate { } };
            var browser = new Browser { Disposing = delegate { entered.Set(); Check(release.WaitOne(3000), "browser release barrier timed out"); } };
            Action expire = null; int schedules = 0, requests = 0, endings = 0;
            var deadline = new SessionExitDeadline(delegate(Action callback, int milliseconds) {
                Check(milliseconds == 6000, "session exit margin changed"); schedules++; expire = callback; return new DeadlineTicket();
            }, delegate { requests++; });
            Action endingAction = delegate { deadline.Arm(); if (Interlocked.Increment(ref endings) == 2) cleanupEntered.Set(); };
            var startup = new SessionStartup(session, delegate { }, delegate { return preview; }, delegate { return browser; }, endingAction, deadline.Enable);
            Check(startup.Start(), "deadline integration startup failed");
            Exception firstFailure = null, cleanupFailure = null;
            var first = new Thread(delegate() { try { if (disposeFirst) startup.Dispose(); else session.End(); } catch (Exception error) { firstFailure = error; } });
            var cleanup = new Thread(delegate() { try { cleanupEntered.Set(); startup.Dispose(); deadline.Complete(); cleanupReturned.Set(); } catch (Exception error) { cleanupFailure = error; } });
            first.IsBackground = true; cleanup.IsBackground = true; first.Start();
            try {
                Check(entered.WaitOne(3000), "browser release barrier was not entered");
                int observations = 0;
                Check(startup.IsCancelled && !startup.ObserveWhileActive(delegate { observations++; }) && observations == 0,
                    "blocked renderer release hid terminal state from UI observations");
                Check(schedules == 1 && expire != null, "renderer release blocked before its deadline was armed");
                cleanup.Start(); Check(cleanupEntered.WaitOne(3000), "concurrent cleanup was not entered");
                Check(!cleanupReturned.WaitOne(100), "cleanup acknowledged completion while renderer release was in flight");
                expire(); expire();
                Check(requests == 1, "in-flight renderer release disarmed or duplicated the deadline");
            } finally {
                release.Set(); Check(first.Join(3000), "first renderer release did not finish");
                if (cleanup.ThreadState != ThreadState.Unstarted) Check(cleanup.Join(3000), "concurrent cleanup did not finish");
                startup.Dispose(); deadline.Complete();
            }
            Check(firstFailure == null && cleanupFailure == null && browser.Disposals == 1, "renderer completion race leaked or duplicated release");
        }
    }
    private static void HandshakeBeforeExitDeadline()
    {
        using (var connecting = new ManualResetEvent(false))
        using (var releaseConnect = new ManualResetEvent(false))
        using (var clearing = new ManualResetEvent(false))
        using (var releaseClear = new ManualResetEvent(false))
        {
            var session = new Session(); int schedules = 0, exits = 0, launches = 0; Action expire = null;
            var deadline = new SessionExitDeadline(delegate(Action callback, int milliseconds) { schedules++; expire = callback; return new DeadlineTicket(); }, delegate { exits++; });
            var preview = new Preview { Upload = delegate { }, ClearAction = delegate { clearing.Set(); Check(releaseClear.WaitOne(3000), "late handshake clear barrier timed out"); } };
            var startup = new SessionStartup(session, delegate { }, delegate {
                connecting.Set(); Check(releaseConnect.WaitOne(3000), "handshake barrier timed out"); return preview;
            }, delegate { launches++; return new Browser(); }, deadline.Arm, deadline.Enable);
            bool? started = null; Exception failure = null;
            var worker = new Thread(delegate() { try { started = startup.Start(); } catch (Exception error) { failure = error; } });
            worker.IsBackground = true; worker.Start();
            try {
                Check(connecting.WaitOne(3000), "handshake fixture was not entered"); session.End();
                Check(schedules == 0 && exits == 0, "cancellation force-terminated an unresolved handshake");
                releaseConnect.Set(); Check(clearing.WaitOne(3000), "rejected completed handshake did not clear");
                Check(schedules == 1 && launches == 0, "late handshake did not enable deadline before rejected Clear");
                expire(); Check(exits == 1, "rejected handshake Clear could block without deadline");
            } finally { releaseConnect.Set(); releaseClear.Set(); Check(worker.Join(3000), "handshake worker did not end"); startup.Dispose(); deadline.Complete(); }
            Check(failure == null && started == false && launches == 0, "cancelled handshake reached a display stage");
        }
        var ended = new Session(); int connects = 0, timers = 0;
        var unavailable = new SessionExitDeadline(delegate { timers++; return new DeadlineTicket(); }, delegate { throw new Exception("unexpected termination"); });
        using (var startup = new SessionStartup(ended, delegate { ended.End(); }, delegate { connects++; return null; }, delegate { return new Browser(); }, unavailable.Arm, unavailable.Enable))
            Check(!startup.Start() && connects == 0 && timers == 0, "pre-handshake cancellation created a deadline or display stage");
        unavailable.Complete(); unavailable.Enable(); Check(timers == 0, "late enable reopened completed startup");

        bool enabled = false; var ready = new Preview { Upload = delegate { Check(enabled, "capture stage preceded handshake deadline eligibility"); } };
        using (var startup = new SessionStartup(new Session(), delegate { }, delegate { return ready; }, delegate {
            Check(enabled, "browser stage preceded handshake deadline eligibility"); return new Browser();
        }, null, delegate { enabled = true; })) Check(startup.Start(), "normal handshake eligibility failed");
    }
    private static void ReentrantDisposal()
    {
        var session = new Session(); var preview = new Preview { Upload = delegate { } };
        SessionStartup startup = null;
        var browser = new Browser { Disposing = delegate { startup.Dispose(); } };
        startup = new SessionStartup(session, delegate { }, delegate { return preview; }, delegate { return browser; });
        Check(startup.Start(), "reentrant release startup failed");
        Exception failure = null;
        var ending = new Thread(delegate() { try { session.End(); startup.Dispose(); } catch (Exception error) { failure = error; } });
        ending.IsBackground = true; ending.Start();
        Check(ending.Join(3000) && failure == null && browser.Disposals == 1, "same-thread renderer disposal reentry deadlocked or duplicated release");

        startup = new SessionStartup(new Session(), delegate { }, delegate { return preview; }, delegate { return new Browser(); });
        Check(startup.Start(), "reentrant cancellation startup failed");
        using (startup.Token.Register(delegate { startup.Dispose(); })) {
            failure = null; ending = new Thread(delegate() { try { startup.Dispose(); } catch (Exception error) { failure = error; } });
            ending.IsBackground = true; ending.Start(); Check(ending.Join(3000) && failure == null, "same-thread cancellation callback disposal reentry deadlocked");
        }
    }
    private static void Run()
    {
        CancelWithoutUiProgress(false);
        CancelWithoutUiProgress(true);
        LateBrowserAfterDispose();
        ObservationCutoff();
        BlockedRendererCompletion(false);
        BlockedRendererCompletion(true);
        HandshakeBeforeExitDeadline();
        ReentrantDisposal();
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
        using (var browserDisposed = new ManualResetEvent(false))
        {
            session = new Session(); preview = new Preview { Upload = delegate { } };
            preview.ClearAction = delegate { enteredClear.Set(); Check(releaseClear.WaitOne(3000), "clear fixture release missing"); };
            var browser = new Browser { Disposing = delegate { browserDisposed.Set(); } };
            var startup = new SessionStartup(session, delegate { }, delegate { return preview; }, delegate { return browser; });
            Check(startup.Start(), "clear-lifetime startup failed");
            Exception cancelFailure = null, disposeFailure = null;
            var cancellation = new Thread(delegate() { try { session.End(); } catch (Exception error) { cancelFailure = error; } });
            var disposer = new Thread(delegate() { try { startup.Dispose(); disposed.Set(); } catch (Exception error) { disposeFailure = error; } });
            cancellation.Start();
            bool clearEntered = enteredClear.WaitOne(3000), browserEnded = false, returnedEarly = false;
            try {
                if (clearEntered) {
                    disposer.Start();
                    browserEnded = browserDisposed.WaitOne(1000);
                    returnedEarly = disposed.WaitOne(0);
                }
            } finally {
                releaseClear.Set();
                Check(cancellation.Join(3000), "cancellation cleanup did not finish");
                if (clearEntered) Check(disposer.Join(3000), "disposal cleanup did not finish");
                else startup.Dispose();
            }
            Check(clearEntered && cancelFailure == null && disposeFailure == null, "cleanup fixture failed");
            Check(browserEnded, "owned browser disposal waited behind an in-flight RAM clear (#505)");
            Check(!returnedEarly, "session disposed before its in-flight RAM clear finished");
            startup.Dispose();
            Check(browser.Disposals == 1, "repeated disposal ended the owned browser more than once");
            int clears = preview.Clears; session.End(); Check(preview.Clears == clears, "disposed old session could clear a replacement's RAM frame");
        }
        Console.WriteLine("Active input PASS: fixed caller baseline, early input latch, read failure, startup cancellation/clear, prompt browser disposal behind a blocked clear, and terminal session cleanup; no native/UI/input injection.");
    }
    private static int Main() {
        try { Run(); return 0; }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
