using System;

internal static class PreviewPreparationTests
{
    private static int assertions;
    private static void Check(bool value, string why) { assertions++; if (!value) throw new Exception(why); }
    private static PreparationReading Reading(uint input, long idle)
    {
        return new PreparationReading { Readable=true, Enabled=true, Safe=true, CaptureAllowed=true, InputTick=input,
            IdleMilliseconds=idle, TimeoutSeconds=600, LeadSeconds=30, Configuration="a" };
    }
    private static void Main()
    {
        var desired = new PreparationConfiguration { Generation=7, Enabled=true, Revision="a", TimeoutSeconds=1200, LeadSeconds=30 };
        var actualPolicy = new PreviewPreparationPolicy();
        actualPolicy.Observe(desired.Reading(Reading(99, 100)));
        Check(!actualPolicy.Observe(desired.Reading(Reading(100, 569999))).Capture, "actual timer window has not opened");
        Check(actualPolicy.Observe(desired.Reading(Reading(100, 570000))).Capture,
            "validated ten-minute Windows timer prepares even when saved desired timer is twenty minutes");
        var actualChanged=Reading(100,575000); actualChanged.TimeoutSeconds=900;
        var changedDecision=actualPolicy.Observe(desired.Reading(actualChanged));
        Check(changedDecision.Invalidate && changedDecision.InvalidateActive && !changedDecision.Capture,
            "actual timeout change invalidates pending and active without a new attempt");
        changedDecision=actualPolicy.Observe(desired.Reading(Reading(100,575001)));
        Check(changedDecision.Invalidate && changedDecision.InvalidateActive && !changedDecision.Capture,
            "restoring the actual timeout cannot revive the old frame or reopen the epoch");
        Check(!actualPolicy.Observe(desired.Reading(Reading(100,580000))).Capture,
            "consumed mismatched epoch stays consumed after timeout restoration");
        Check(actualPolicy.Observe(desired.Reading(Reading(101,100))).InvalidateActive,
            "physical input clears the prior actual-timeout epoch");
        Check(actualPolicy.Observe(desired.Reading(Reading(101,570000))).Capture,
            "new physical input permits one preparation against the current actual timer");
        actualPolicy=new PreviewPreparationPolicy();
        actualPolicy.Observe(desired.Reading(Reading(99,100)));
        Check(!actualPolicy.Observe(desired.Reading(Reading(100,600000))).Capture,
            "saved later preference never permits a capture at the actual activation deadline");
        Check(!actualPolicy.Observe(desired.Reading(Reading(100,599999))).Capture,
            "late actual deadline consumes the attempt without retry");
        foreach(int invalid in new int[] { -1,0,30 })
        {
            actualPolicy=new PreviewPreparationPolicy();
            var invalidReading=Reading(99,100); invalidReading.TimeoutSeconds=invalid;
            actualPolicy.Observe(desired.Reading(invalidReading));
            invalidReading.InputTick=100; invalidReading.IdleMilliseconds=570000;
            Check(!actualPolicy.Observe(desired.Reading(invalidReading)).Capture,
                "invalid or lead-sized actual deadline cannot capture");
        }
        foreach(string gate in new string[] { "disabled","unsafe","unreadable","saver","ambient" })
        {
            actualPolicy=new PreviewPreparationPolicy();
            actualPolicy.Observe(desired.Reading(Reading(99,100)));
            var blocked=Reading(100,570000);
            if(gate=="disabled")desired.Enabled=false;
            if(gate=="unsafe")blocked.Safe=false;
            if(gate=="unreadable")blocked.Readable=false;
            if(gate=="saver" || gate=="ambient")blocked.CaptureAllowed=false;
            Check(!actualPolicy.Observe(desired.Reading(blocked)).Capture,
                "saved/actual mismatch cannot bypass "+gate+" admission");
            desired.Enabled=true;
        }
        desired.TimeoutSeconds=600;
        actualPolicy=new PreviewPreparationPolicy(); actualPolicy.Observe(desired.Reading(Reading(99,100)));
        Check(actualPolicy.Observe(desired.Reading(Reading(100,570000))).Capture,
            "equal saved and actual timeout retains the same preparation window");
        var policy = new PreviewPreparationPolicy();
        Check(!policy.Observe(Reading(99, 580000)).Capture, "fresh worker cannot reuse an unknown idle epoch");
        Check(!policy.Observe(Reading(100, 569999)).Capture, "before window");
        Check(policy.Observe(Reading(100, 570000)).Capture, "one attempt at window edge");
        Check(!policy.Observe(Reading(100, 570001)).Capture, "failure cannot retry");
        var changed = Reading(100, 575000); changed.Configuration="b";
        Check(!policy.Observe(changed).Capture, "settings cannot authorize a second capture in an epoch");
        Check(policy.Observe(Reading(101, 100)).InvalidateActive, "input clears pending and active");
        Check(policy.Observe(Reading(101, 580000)).Capture, "new input epoch can capture");
        changed=Reading(101,580001); changed.CaptureAllowed=false;
        var saver=policy.Observe(changed);
        Check(!saver.Capture && !saver.Invalidate && !saver.InvalidateActive,"legitimate saver start preserves the pending/active frame for claim");
        Check(!new PreviewPreparationPolicy().Observe(Reading(100, 600000)).Capture, "late startup unavailable");
        policy = new PreviewPreparationPolicy();
        policy.Observe(Reading(99, 100));
        changed=Reading(100, 580000); changed.Safe=false;
        Check(!policy.Observe(changed).Capture, "unsafe context never captures");
        Check(policy.Observe(Reading(100, 581000)).Capture, "safe unused epoch may attempt");
        changed=Reading(100, 582000); changed.Readable=false;
        Check(policy.Observe(changed).InvalidateActive, "unknown context invalidates");
        Check(!policy.Observe(Reading(100, 583000)).Capture, "failed input read cannot reopen consumed epoch");
        Check(policy.Observe(Reading(99, 584000)).Capture, "changed nonmonotonic tick is a distinct observed epoch");
        policy = new PreviewPreparationPolicy();
        policy.Observe(Reading(uint.MaxValue-1,100));
        Check(policy.Observe(Reading(uint.MaxValue,580000)).Capture, "tick near wrap");
        Check(policy.Observe(Reading(0,580000)).Capture, "tick wrap is new epoch");
        var at = new DateTime(2026,1,1,0,0,0,DateTimeKind.Utc);
        Check(PreparedSnapshotOrder.Eligible(1000,31000,at,at.AddSeconds(30),30000,at.AddSeconds(30)), "clearly earlier frame");
        Check(!PreparedSnapshotOrder.Eligible(1000,999,at,at.AddSeconds(30),30000,at.AddSeconds(30)), "already-entered process");
        Check(!PreparedSnapshotOrder.Eligible(1000,31000,at,at.AddMilliseconds(1500),30000,at.AddSeconds(30)), "small backward-clock ambiguity");
        Check(!PreparedSnapshotOrder.Eligible(1000,31000,at,at.AddSeconds(-1),30000,at.AddSeconds(30)), "delayed Main/handshake cannot change actual creation");
        Check(!PreparedSnapshotOrder.Eligible(1000,31000,at,at.AddSeconds(30),30000,at.AddSeconds(40)), "clock discontinuity");
        Check(!PreparedSnapshotOrder.Eligible(1000,51000,at,at.AddSeconds(30),30000,at.AddSeconds(30)), "future process entry is rejected");
        policy = new PreviewPreparationPolicy();
        var unreadable = Reading(100,580000); unreadable.Readable=false;
        policy.Observe(unreadable);
        Check(!policy.Observe(Reading(100,580000)).Capture,"unreadable startup cannot reopen an unestablished epoch");
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
