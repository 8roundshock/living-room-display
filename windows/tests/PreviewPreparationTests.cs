using System;

internal static class PreviewPreparationTests
{
    private static void Check(bool value, string why) { if (!value) throw new Exception(why); }
    private static PreparationReading Reading(uint input, long idle)
    {
        return new PreparationReading { Readable=true, Enabled=true, Safe=true, InputTick=input,
            IdleMilliseconds=idle, TimeoutSeconds=600, LeadSeconds=30, Configuration="a" };
    }
    private static void Main()
    {
        var policy = new PreviewPreparationPolicy();
        Check(!policy.Observe(Reading(99, 580000)).Capture, "fresh worker cannot reuse an unknown idle epoch");
        Check(!policy.Observe(Reading(100, 569999)).Capture, "before window");
        Check(policy.Observe(Reading(100, 570000)).Capture, "one attempt at window edge");
        Check(!policy.Observe(Reading(100, 570001)).Capture, "failure cannot retry");
        var changed = Reading(100, 575000); changed.Configuration="b";
        Check(!policy.Observe(changed).Capture, "settings cannot authorize a second capture in an epoch");
        Check(policy.Observe(Reading(101, 100)).InvalidateActive, "input clears pending and active");
        Check(policy.Observe(Reading(101, 580000)).Capture, "new input epoch can capture");
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
        policy = new PreviewPreparationPolicy();
        var unreadable = Reading(100,580000); unreadable.Readable=false;
        policy.Observe(unreadable);
        Check(!policy.Observe(Reading(100,580000)).Capture,"unreadable startup cannot reopen an unestablished epoch");
        Console.WriteLine("Preview preparation policy: 21 assertions passed; no Windows calls or pixels.");
    }
}
