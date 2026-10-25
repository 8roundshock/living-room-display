using System;
using System.Threading;

// Injected clock, scheduler and termination action only. Never exits a process.
internal static class SessionExitDeadlineTests
{
    private sealed class Ticket : IDisposable { internal int Disposals; public void Dispose() { Disposals++; } }
    private sealed class Clock
    {
        internal Action Callback;
        internal int Schedules, Due, Now;
        internal readonly Ticket Ticket = new Ticket();
        internal IDisposable Schedule(Action callback, int milliseconds) { Schedules++; Callback = callback; Due = Now + milliseconds; return Ticket; }
        internal void Advance(int milliseconds) { Now += milliseconds; if (Now >= Due && Callback != null && Ticket.Disposals == 0) Callback(); }
        internal void StaleCallback() { if (Callback != null) Callback(); }
    }
    private static int checks;
    private static void Check(bool ok, string why) { Interlocked.Increment(ref checks); if (!ok) throw new Exception(why); }
    private static void OrdinaryDeadlines()
    {
        var clock = new Clock(); int exits = 0;
        var deadline = new SessionExitDeadline(clock.Schedule, delegate { exits++; });
        deadline.Enable(); deadline.Arm(); deadline.Arm();
        Check(clock.Schedules == 1 && clock.Due == 6000, "one six-second deadline is required");
        clock.Advance(5999); Check(exits == 0, "deadline requested termination early");
        clock.Advance(1); Check(exits == 1 && clock.Ticket.Disposals == 1, "deadline did not request one exact-session action");
        clock.StaleCallback(); deadline.Arm(); deadline.Complete(); clock.StaleCallback();
        Check(exits == 1 && clock.Schedules == 1, "expired deadline rearmed or fired twice");

        clock = new Clock(); exits = 0; deadline = new SessionExitDeadline(clock.Schedule, delegate { exits++; });
        deadline.Enable(); deadline.Arm(); clock.Advance(5000); deadline.Complete(); deadline.Complete(); clock.StaleCallback(); deadline.Arm();
        Check(exits == 0 && clock.Ticket.Disposals == 1 && clock.Schedules == 1, "completed teardown did not disarm stale callbacks/late arm");

        clock = new Clock(); deadline = new SessionExitDeadline(clock.Schedule, delegate { exits++; });
        deadline.Complete(); deadline.Enable(); deadline.Arm();
        Check(clock.Schedules == 0 && exits == 0, "late cancellation armed an already-completed session");
    }
    private static void SchedulingRaces(bool expireFirst)
    {
        using (var entered = new ManualResetEvent(false))
        using (var release = new ManualResetEvent(false))
        {
            var ticket = new Ticket(); Action callback = null; int exits = 0; Exception failure = null;
            var deadline = new SessionExitDeadline(delegate(Action action, int milliseconds) {
                callback = action; entered.Set(); Check(release.WaitOne(3000), "scheduler barrier timed out"); return ticket;
            }, delegate { exits++; });
            deadline.Enable();
            var armer = new Thread(delegate() { try { deadline.Arm(); } catch (Exception error) { failure = error; } });
            armer.Start();
            try {
                Check(entered.WaitOne(3000), "scheduler barrier was not entered");
                if (expireFirst) callback(); else deadline.Complete();
            } finally { release.Set(); Check(armer.Join(3000), "arming worker did not finish"); }
            Check(failure == null && ticket.Disposals == 1, "late timer publication leaked its ticket");
            callback(); deadline.Arm(); deadline.Complete();
            Check(exits == (expireFirst ? 1 : 0), "schedule/completion/expiry winner was not terminal");
        }
    }
    private static void ExpiryCommittedBeforeCompletion()
    {
        using (var entered = new ManualResetEvent(false))
        using (var release = new ManualResetEvent(false))
        {
            var clock = new Clock(); int exits = 0; Exception failure = null;
            var deadline = new SessionExitDeadline(clock.Schedule, delegate {
                Interlocked.Increment(ref exits); entered.Set(); Check(release.WaitOne(3000), "termination-action barrier timed out");
            });
            deadline.Enable(); deadline.Arm();
            var expiry = new Thread(delegate() { try { clock.Advance(6000); } catch (Exception error) { failure = error; } });
            expiry.Start();
            try {
                Check(entered.WaitOne(3000), "expiry did not commit its action");
                deadline.Complete(); deadline.Arm(); clock.StaleCallback();
                Check(exits == 1, "completion duplicated a committed expiry");
            } finally { release.Set(); Check(expiry.Join(3000), "expiry worker did not finish"); }
            Check(failure == null && clock.Schedules == 1, "committed expiry fixture failed");
        }
    }
    private static void SchedulerFailureAndInlineCallback()
    {
        int exits = 0; bool failed = false;
        var deadline = new SessionExitDeadline(delegate { throw new InvalidOperationException("synthetic scheduler failure"); }, delegate { exits++; });
        deadline.Enable();
        try { deadline.Arm(); } catch (InvalidOperationException) { failed = true; }
        deadline.Enable(); deadline.Arm(); deadline.Complete();
        Check(failed && exits == 1, "failed scheduling silently dropped the termination action");

        var ticket = new Ticket(); exits = 0;
        deadline = new SessionExitDeadline(delegate(Action callback, int milliseconds) { callback(); return ticket; }, delegate { exits++; });
        deadline.Arm(); deadline.Complete();
        Check(exits == 1 && ticket.Disposals == 1, "inline expiry leaked a late-published timer");
    }
    private static int Main()
    {
        try {
            OrdinaryDeadlines(); SchedulingRaces(false); SchedulingRaces(true);
            ExpiryCommittedBeforeCompletion(); SchedulerFailureAndInlineCallback();
            Console.WriteLine(checks + " exit-deadline assertions passed with injected clock/timer/action; no process exit, native, UI or capture.");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
