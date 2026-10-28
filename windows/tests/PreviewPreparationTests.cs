using System;
using System.Threading;

internal static class PreviewPreparationTests
{
    private static int assertions;
    private static void Check(bool value, string why) { assertions++; if (!value) throw new Exception(why); }
    private static PreparationReading Reading(uint input, long at, long idle = 100)
    {
        return new PreparationReading { Readable=true, Enabled=true, Safe=true, CaptureAllowed=true, InputTick=input,
            MonotonicMilliseconds=at, SessionId=3, IdleMilliseconds=idle, TimeoutSeconds=600, LeadSeconds=30, Configuration="a" };
    }
    private static void IdentityObservations()
    {
        int calls=0,observerThread=0;
        int callerThread=Thread.CurrentThread.ManagedThreadId;
        Check(PreparationIdentityObservation.Confirm(delegate {
            Interlocked.Increment(ref calls); observerThread=Thread.CurrentThread.ManagedThreadId; return true;
        },CancellationToken.None),"one confirmed identity permits startup");
        Check(calls==1 && observerThread!=callerThread,"identity uses one independent read-only observer");
        Check(!PreparationIdentityObservation.Confirm(delegate { return false; },CancellationToken.None),
            "unconfirmed identity cannot permit startup");
        Check(!PreparationIdentityObservation.Confirm(delegate { throw new InvalidOperationException("synthetic unreadable identity"); },CancellationToken.None),
            "unreadable identity fails closed");
        using(var cancellation=new CancellationTokenSource())
        {
            cancellation.Cancel(); calls=0;
            Check(!PreparationIdentityObservation.Confirm(delegate { Interlocked.Increment(ref calls); return true; },cancellation.Token) && calls==0,
                "already-cancelled startup does not start an identity read");
        }
        using(var cancellation=new CancellationTokenSource())
        {
            Check(!PreparationIdentityObservation.Confirm(delegate { cancellation.Cancel(); return true; },cancellation.Token),
                "cancellation beats a just-returned true identity");
        }
        foreach(bool cancel in new[] { false,true })
        {
            using(var entered=new ManualResetEvent(false))
            using(var release=new ManualResetEvent(false))
            using(var returned=new ManualResetEvent(false))
            using(var cancellation=new CancellationTokenSource())
            {
                int observations=0,continuations=0;
                bool accepted=false;
                Exception failure=null;
                var caller=new Thread(delegate() {
                    try
                    {
                        accepted=PreparationIdentityObservation.Confirm(delegate {
                            Interlocked.Increment(ref observations); entered.Set();
                            try
                            {
                                if(!release.WaitOne(5000))throw new TimeoutException("synthetic reader was not released");
                                return true;
                            }
                            finally { returned.Set(); }
                        },cancellation.Token,cancel ? 3000 : 500);
                        if(accepted)Interlocked.Increment(ref continuations);
                    }
                    catch(Exception error) { failure=error; }
                });
                caller.IsBackground=true; caller.Start();
                try
                {
                    Check(entered.WaitOne(3000),"blocked identity fixture entered");
                    if(cancel)cancellation.Cancel();
                    Check(caller.Join(3000),"blocked identity cannot retain its caller after timeout/cancellation");
                    Check(failure==null && !accepted && continuations==0,
                        "unknown identity cannot continue to capture or preparation heartbeat");
                    Check(observations==1 && !returned.WaitOne(0),
                        "abandoning one blocked reader starts no retry or replacement observer");
                }
                finally
                {
                    release.Set();
                    Check(caller.Join(3000),"identity caller completed before fixture cleanup");
                    Check(returned.WaitOne(3000),"late identity reader released its fixture");
                }
                Check(!accepted && continuations==0 && observations==1,
                    "late true identity cannot resume an abandoned startup");
            }
        }
    }
    private static void Main()
    {
        IdentityObservations();
        var policy = new PreviewPreparationPolicy();
        Check(policy.Observe(Reading(99,0)).Capture, "first safe desktop captures without hidden extra input");
        Check(!policy.Observe(Reading(100,299999)).Capture, "normal input does not move or reopen cadence");
        var next=policy.Observe(Reading(101,300000));
        Check(next.Capture && !next.Invalidate && next.InvalidateActive, "five-minute refresh preserves pending across ordinary input");
        Check(!policy.Observe(Reading(102,300001)).Capture, "failed refresh cannot spin-retry before next cadence");
        Check(policy.Observe(Reading(103,600000)).Capture, "ten-minute refresh works while desktop stays active");
        Check(!policy.Observe(Reading(104,899999)).Capture, "cadence is monotonic rather than idle age");
        Check(policy.Observe(Reading(105,900000)).Capture, "fifteen-minute refresh");
        var recovered=Reading(105,915001); recovered.Generation=1;
        Check(policy.Observe(recovered).Capture,"backend producer-lease loss generation refresh captures immediately before five-minute due time");
        policy.Acknowledge(2); recovered=Reading(105,915002); recovered.Generation=2;
        Check(!policy.Observe(recovered).Capture,"acknowledged own invalidation cannot create a generation feedback capture loop");
        policy.ObservationLost();
        Check(policy.Observe(recovered).Capture,"one configuration read failure resets eligibility for first safe recovery");
        policy = new PreviewPreparationPolicy();
        Check(policy.Observe(Reading(99,0,0)).Capture, "capture first quiet desktop");
        Check(policy.Observe(Reading(99,300000,300000)).Capture, "capture at five minutes of idle");
        var approaching=policy.Observe(Reading(99,570000,570000));
        Check(!approaching.Capture && !approaching.Invalidate, "approaching saver retains last snapshot without a late capture");
        Check(!policy.Observe(Reading(99,600000,600000)).Capture, "actual deadline never captures startup surface");
        Check(!policy.Observe(Reading(99,630000,630000)).Capture, "transition band includes its upper boundary");
        Check(policy.Observe(Reading(99,630001,630001)).Capture, "ordinary eligible desktop resumes if a video inhibited the nominal saver deadline");
        var ambient=Reading(99,630002,630002); ambient.CaptureAllowed=false;
        var frozen=policy.Observe(ambient);
        Check(!frozen.Capture && !frozen.Invalidate, "running saver freezes the last success for claim");
        Check(policy.Observe(Reading(100,630500,10)).Capture, "desktop return starts a new eligible cadence immediately");
        var desired = new PreparationConfiguration { Generation=7, Enabled=true, Revision="a", TimeoutSeconds=1200, LeadSeconds=30 };
        policy = new PreviewPreparationPolicy();
        Check(policy.Observe(desired.Reading(Reading(99,0,100))).Capture, "saved timer does not replace actual validated timeout");
        Check(!policy.Observe(desired.Reading(Reading(99,570000,570000))).Capture, "actual ten-minute cutoff wins over saved twenty-minute timer");
        var shared = new PreparationConfiguration { Generation=7, Enabled=true, Revision="a", CaptureRevision=11, LeadSeconds=30 };
        policy=new PreviewPreparationPolicy();
        Check(policy.Observe(shared.Reading(Reading(99,0))).Capture,"shared-file producer begins normally");
        shared.CapturePaused=true;
        var paused=shared.Reading(Reading(99,1000));
        var pauseDecision=policy.Observe(paused);
        Check(paused.Enabled && paused.Safe && paused.Readable && !paused.CaptureAllowed && paused.Generation==7,
            "browser capture pause changes only capture eligibility");
        Check(!pauseDecision.Capture && !pauseDecision.Invalidate && !pauseDecision.InvalidateActive,
            "visible browser pause retains the latest file and producer privacy observation");
        shared.CapturePaused=false;
        Check(policy.Observe(shared.Reading(Reading(99,1500))).Capture,"confirmed browser close resumes capture without a native claim or new generation");
        Check(shared.ConfirmsCapture(new PreparationConfiguration { Generation=7, Enabled=true, Revision="a", CaptureRevision=11 }),
            "unchanged unpaused config confirms the capture fence");
        Check(!shared.ConfirmsCapture(new PreparationConfiguration { Generation=7, Enabled=true, Revision="a", CaptureRevision=12 }),
            "a browser transition fences an older capture");
        Check(!shared.ConfirmsCapture(new PreparationConfiguration { Generation=7, Enabled=true, Revision="a", CaptureRevision=11, CapturePaused=true }),
            "a newly visible browser prevents GDI capture");
        Check(!shared.ConfirmsCapture(new PreparationConfiguration { Generation=8, Enabled=true, Revision="a", CaptureRevision=11 }) &&
            !shared.ConfirmsCapture(new PreparationConfiguration { Generation=7, Enabled=true, Revision="b", CaptureRevision=11 }) &&
            !shared.ConfirmsCapture(new PreparationConfiguration { Generation=7, Enabled=false, Revision="a", CaptureRevision=11 }) &&
            !shared.ConfirmsCapture(null),"stale, disabled and unknown confirmation fail closed");
        Check(PreparationConfiguration.ReadCaptureRevision(0)==0 && PreparationConfiguration.ReadCaptureRevision(9007199254740991L)==9007199254740991L,
            "capture revision accepts only the bounded shared integer contract");
        foreach(object invalidRevision in new object[] { null, "1", true, 1.0, -1, 9007199254740992L })
        {
            bool invalidRefused=false;
            try { PreparationConfiguration.ReadCaptureRevision(invalidRevision); } catch(InvalidOperationException) { invalidRefused=true; }
            Check(invalidRefused,"invalid capture revision is refused");
        }
        SharedSnapshotMode.Validate(true);
        foreach(object invalidMode in new object[] { null, false, "true", 1 })
        {
            bool invalidRefused=false;
            try { SharedSnapshotMode.Validate(invalidMode); } catch(InvalidOperationException) { invalidRefused=true; }
            Check(invalidRefused,"only explicit boolean shared snapshot mode starts this producer");
        }
        var diagnostics=new PreparationDiagnostics();
        Check(diagnostics.Snapshot().Sequence==0,"no capture success is invented at producer startup");
        diagnostics.CaptureStarted(); diagnostics.CaptureSkipped();
        var observation=diagnostics.Snapshot();
        Check(observation.Event=="capture-skipped" && observation.Sequence==2 && observation.CaptureAttempts==1 && observation.CaptureFailures==0,
            "expected pause/fence skips do not become capture failures");
        diagnostics.CaptureStarted(); diagnostics.CaptureFailed();
        observation=diagnostics.Snapshot();
        Check(observation.Event=="capture-failed" && observation.Sequence==4 && observation.CaptureAttempts==2 && observation.CaptureFailures==1,
            "actual failed attempts remain distinguishable from skips");
        diagnostics.CaptureStarted(); diagnostics.CaptureUploaded();
        observation=diagnostics.Snapshot();
        Check(observation.Event=="capture-uploaded" && observation.Sequence==6 && observation.CaptureAttempts==3 && observation.CaptureFailures==1,
            "only acknowledged upload records uploaded");
        observation.CaptureAttempts=0;
        Check(diagnostics.Snapshot().CaptureAttempts==3,"reading diagnostics returns an independent scalar snapshot");
        foreach(string gate in new string[] { "disabled","unsafe","unreadable","saver","ambient" })
        {
            policy=new PreviewPreparationPolicy();
            var blocked=Reading(100,0);
            if(gate=="disabled")blocked.Enabled=false;
            if(gate=="unsafe")blocked.Safe=false;
            if(gate=="unreadable")blocked.Readable=false;
            if(gate=="saver" || gate=="ambient")blocked.CaptureAllowed=false;
            Check(!policy.Observe(blocked).Capture,"first observation cannot bypass "+gate);
            Check(policy.Observe(Reading(100,500)).Capture,"eligible desktop after "+gate+" needs no extra-input ritual");
        }
        foreach(int invalid in new int[] { -1,0,30 })
        {
            policy=new PreviewPreparationPolicy(); var reading=Reading(99,0); reading.TimeoutSeconds=invalid;
            Check(!policy.Observe(reading).Capture,"invalid or lead-sized deadline cannot capture");
        }
        foreach(string change in new string[] { "configuration","timeout","session","unsafe","disabled","unknown","clock reversal","clock gap" })
        {
            policy=new PreviewPreparationPolicy(); policy.Observe(Reading(99,1000));
            var reading=Reading(99,2000);
            if(change=="configuration")reading.Configuration="b";
            if(change=="timeout")reading.TimeoutSeconds=900;
            if(change=="session")reading.SessionId=4;
            if(change=="unsafe")reading.Safe=false;
            if(change=="disabled")reading.Enabled=false;
            if(change=="unknown")reading.Readable=false;
            if(change=="clock reversal")reading.MonotonicMilliseconds=999;
            if(change=="clock gap")reading.MonotonicMilliseconds=631001;
            var decision=policy.Observe(reading);
            Check(decision.Invalidate && decision.InvalidateActive,change+" invalidates private and active pixels");
            if(change=="unsafe" || change=="disabled" || change=="unknown" || change.StartsWith("clock"))
                Check(!decision.Capture,change+" cannot capture on the invalidating observation");
        }
        var at = new DateTime(2026,1,1,0,0,0,DateTimeKind.Utc);
        Check(PreparedSnapshotOrder.Eligible(1000,31000,at,at.AddSeconds(30),30000,at.AddSeconds(30)), "clearly earlier frame");
        Check(!PreparedSnapshotOrder.Eligible(1000,999,at,at.AddSeconds(30),30000,at.AddSeconds(30)), "already-entered process");
        Check(!PreparedSnapshotOrder.Eligible(1000,31000,at,at.AddMilliseconds(1500),30000,at.AddSeconds(30)), "small backward-clock ambiguity");
        Check(!PreparedSnapshotOrder.Eligible(1000,31000,at,at.AddSeconds(-1),30000,at.AddSeconds(30)), "delayed Main cannot change actual process creation");
        Check(!PreparedSnapshotOrder.Eligible(1000,31000,at,at.AddSeconds(30),30000,at.AddSeconds(40)), "clock discontinuity");
        Check(!PreparedSnapshotOrder.Eligible(1000,51000,at,at.AddSeconds(30),30000,at.AddSeconds(30)), "future process entry");
        const string host="C:\\Synthetic\\app\\windows\\LivingRoomDisplay.scr";
        Check(NativePreparationIdentity.ExactCommand("\""+host+"\" /s",host,null,true),"exact automatic command");
        Check(!NativePreparationIdentity.ExactCommand("\""+host+"\" --test-display",host,null,true),"manual test cannot claim prepared content");
        Check(!NativePreparationIdentity.ExactCommand("\""+host+"\" /s --extra",host,null,true),"extra arguments cannot claim");
        Check(!NativePreparationIdentity.ExactCommand("\"C:\\Other.scr\" /s",host,null,true),"wrong executable cannot claim");
        Check(!NativePreparationIdentity.ExactCommand(null,host,null,true),"missing process command fails closed");
        Check(NativePreparationIdentity.ExactCommand("\"C:\\Synthetic\\runtime\\node.exe\" \"C:\\Synthetic\\app\\dist\\server\\index.js\"", "C:\\Synthetic\\runtime\\node.exe", "C:\\Synthetic\\app\\dist\\server\\index.js",false),"exact parent command");
        Console.WriteLine("Preview preparation policy: "+assertions+" assertions passed; no Windows calls or pixels.");
    }
}
