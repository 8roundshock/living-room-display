using System;

// Pure one-shot policy. No Windows calls, pixels, timers or transport live here.
internal struct PreparationReading
{
    internal bool Readable, Enabled, Safe;
    internal uint InputTick;
    internal long IdleMilliseconds;
    internal int TimeoutSeconds, LeadSeconds;
    internal string Configuration;
}

internal struct PreparationDecision
{
    internal bool Invalidate, Capture, InvalidateActive;
}

internal sealed class PreviewPreparationPolicy
{
    private bool initialized, attempted;
    private uint input;
    private string configuration;

    internal PreparationDecision Observe(PreparationReading reading)
    {
        var decision = new PreparationDecision();
        if (!reading.Readable)
        {
            decision.Invalidate = true;
            decision.InvalidateActive = true;
            // Unknown input cannot create a new eligible epoch.
            attempted = true;
            return decision;
        }
        bool changed = initialized && input != reading.InputTick;
        if (!initialized || changed)
        {
            bool first = !initialized;
            initialized = true;
            input = reading.InputTick;
            // A replacement/cold worker cannot know whether this epoch already
            // captured. Establish a baseline and arm only after observed input.
            attempted = first;
        }
        bool configurationChanged = configuration != reading.Configuration;
        configuration = reading.Configuration;
        decision.Invalidate = changed || configurationChanged || !reading.Enabled || !reading.Safe;
        decision.InvalidateActive = changed || !reading.Safe;
        if (!reading.Enabled || !reading.Safe || attempted) return decision;
        long deadline = (long)reading.TimeoutSeconds * 1000;
        long lead = (long)reading.LeadSeconds * 1000;
        if (deadline <= 0 || lead <= 0 || lead >= deadline || reading.IdleMilliseconds < 0)
        {
            attempted = true;
            return decision;
        }
        if (reading.IdleMilliseconds >= deadline)
        {
            attempted = true; // A late/cold start never samples an already-starting saver.
            return decision;
        }
        if (reading.IdleMilliseconds >= deadline - lead)
        {
            attempted = true; // Consume before IO; failures/timeouts never retry this epoch.
            decision.Capture = true;
        }
        return decision;
    }
}

internal static class PreparedSnapshotOrder
{
    // Independent native verifier and backend use the same conservative rule.
    internal const long ClockUncertaintyMilliseconds = 2000;
    internal static bool Eligible(long completedMonotonic, long enteredMonotonic,
        DateTime completedUtc, DateTime actualCreatedUtc, long elapsedMonotonic, DateTime nowUtc)
    {
        if (completedMonotonic < 0 || enteredMonotonic <= completedMonotonic || elapsedMonotonic < 0) return false;
        double utcElapsed = (nowUtc - completedUtc).TotalMilliseconds;
        if (Math.Abs(utcElapsed - elapsedMonotonic) > ClockUncertaintyMilliseconds) return false;
        // Ambiguous close ordering is unavailable, even within the permitted clock drift.
        return (actualCreatedUtc - completedUtc).TotalMilliseconds > ClockUncertaintyMilliseconds;
    }
}
