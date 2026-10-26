using System;

internal static class PreviewPreparationTests
{
    private static int assertions;
    private static void Check(bool value, string why) { assertions++; if (!value) throw new Exception(why); }
    private static PreparationReading Reading(uint input, long at, long idle = 100)
    {
        return new PreparationReading { Readable=true, Enabled=true, Safe=true, CaptureAllowed=true, InputTick=input,
            MonotonicMilliseconds=at, SessionId=3, IdleMilliseconds=idle, TimeoutSeconds=600, LeadSeconds=30, Configuration="a" };
    }
    private static void Main()
    {
        var policy = new PreviewPreparationPolicy();
        Check(policy.Observe(Reading(99,0)).Capture, "first safe desktop captures without hidden extra input");
        Check(!policy.Observe(Reading(100,299999)).Capture, "normal input does not move or reopen cadence");
        var next=policy.Observe(Reading(101,300000));
        Check(next.Capture && !next.Invalidate && next.InvalidateActive, "five-minute refresh preserves pending across ordinary input");
        Check(!policy.Observe(Reading(102,300001)).Capture, "failed refresh cannot spin-retry before next cadence");
        Check(policy.Observe(Reading(103,600000)).Capture, "ten-minute refresh works while desktop stays active");
        Check(!policy.Observe(Reading(104,899999)).Capture, "cadence is monotonic rather than idle age");
        Check(policy.Observe(Reading(105,900000)).Capture, "fifteen-minute refresh");
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
