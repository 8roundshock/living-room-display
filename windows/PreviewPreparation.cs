using System;
using System.Threading;

// Pure one-shot policy. No Windows calls, pixels, timers or transport live here.
internal struct PreparationReading
{
    internal bool Readable { get; set; }
    internal bool Enabled { get; set; }
    internal bool Safe { get; set; }
    internal bool CaptureAllowed { get; set; }
    internal uint InputTick { get; set; }
    internal long IdleMilliseconds { get; set; }
    internal int TimeoutSeconds { get; set; }
    internal int LeadSeconds { get; set; }
    internal string Configuration { get; set; }
}

internal struct PreparationDecision
{
    internal bool Invalidate, Capture, InvalidateActive;
}

// Private backend configuration combined with the already-validated native context.
internal sealed class PreparationConfiguration
{
    internal long Generation { get; set; }
    internal string Revision { get; set; }
    internal bool Enabled { get; set; }
    // The saved preference is not the active Windows deadline. Windows may have
    // been configured independently; never delay preparation until that preference.
    internal int TimeoutSeconds { get; set; }
    internal int LeadSeconds { get; set; }

    internal PreparationReading Reading(PreparationReading observed)
    {
        // NativePreviewContext supplies this timeout only after validating the
        // selected/enabled own saver and its session/input desktop. The policy
        // below rejects nonpositive/too-short deadlines and late observations.
        observed.Enabled = Enabled;
        observed.LeadSeconds = LeadSeconds;
        observed.Configuration = Revision;
        return observed;
    }
}

internal sealed class PreviewPreparationPolicy
{
    private bool initialized, attempted;
    private uint input;
    private string configuration;
    private int timeoutSeconds;

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
        bool timeoutChanged = initialized && timeoutSeconds != reading.TimeoutSeconds;
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
        timeoutSeconds = reading.TimeoutSeconds;
        decision.Invalidate = changed || timeoutChanged || configurationChanged || !reading.Enabled || !reading.Safe;
        decision.InvalidateActive = changed || timeoutChanged || !reading.Safe;
        if (!reading.Enabled || !reading.Safe || !reading.CaptureAllowed || attempted) return decision;
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
        if (completedMonotonic < 0 || enteredMonotonic <= completedMonotonic || elapsedMonotonic < 0 ||
            enteredMonotonic - completedMonotonic > elapsedMonotonic) return false;
        double utcElapsed = (nowUtc - completedUtc).TotalMilliseconds;
        if (Math.Abs(utcElapsed - elapsedMonotonic) > ClockUncertaintyMilliseconds) return false;
        // Ambiguous close ordering is unavailable, even within the permitted clock drift.
        return (actualCreatedUtc - completedUtc).TotalMilliseconds > ClockUncertaintyMilliseconds;
    }
}

internal static class NativePreparationIdentity
{
    internal static bool ExactCommand(string command, string executable, string entry, bool ambient)
    {
        if (command == null || executable == null) return false;
        string suffix = ambient ? " /s" : " \"" + entry + "\"";
        return String.Equals(command.Trim(), "\"" + executable + "\"" + suffix, StringComparison.OrdinalIgnoreCase) ||
            String.Equals(command.Trim(), executable + suffix, StringComparison.OrdinalIgnoreCase);
    }
}

internal interface IPreparedClaimProcess : IDisposable
{
    bool OwnedAutomatic { get; }
    bool Running { get; }
    int SessionId { get; }
    DateTime CreatedUtc { get; }
}

// The PID must come from the OS-created pipe handle, never from request JSON.
internal static class PreparedClaimAdmission
{
    internal static IPreparedClaimProcess Pin(uint operatingSystemPeer, int sessionId, Func<uint,IPreparedClaimProcess> open)
    {
        if (operatingSystemPeer == 0) return null;
        IPreparedClaimProcess process=null;
        try
        {
            process=open(operatingSystemPeer);
            if (process!=null && process.OwnedAutomatic && process.Running && process.SessionId==sessionId) return process;
        }
        catch { }
        if(process!=null)process.Dispose();
        return null;
    }
}

internal sealed class PreparationLifetime
{
    private readonly Action cancel, exit;
    private bool cancelled, exited;
    internal PreparationLifetime(Action cancel,Action exit) { this.cancel=cancel; this.exit=exit; }
    internal void InputClosed() { lock(this) { if(cancelled)return; cancelled=true; } cancel(); }
    internal void ParentObserved(bool alive)
    {
        if(alive)return;
        lock(this) { if(exited)return; exited=true; }
        try { InputClosed(); } finally { exit(); }
    }
}

internal static class NativePreviewSelection
{
    internal static void Run(bool automatic,Func<bool> claim,Action capture,Action clear)
    {
        if(!automatic) { capture(); return; }
        try { if(!claim())clear(); }
        catch(OperationCanceledException) { throw; }
        catch { clear(); }
    }
}

internal static class PreparedClaimFlow
{
    internal static bool Run(Func<bool> allowed,Func<bool> unchanged,Func<bool> publish,CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if(!allowed())return false;
        cancellation.ThrowIfCancellationRequested();
        if(!unchanged())return false;
        cancellation.ThrowIfCancellationRequested();
        return publish(); // No retry; the caller consumed its one frame before entering this flow.
    }
}

internal static class PreparationCancellation
{
    internal static void Cancel(CancellationTokenSource source)
    {
        // Timer.Dispose does not drain callbacks which were already dispatched.
        try { source.Cancel(); }
        catch(ObjectDisposedException) { }
        catch(AggregateException) { } // Cancellation remains terminal if a registered cleanup fails.
    }
}

internal static class PreparationDpi
{
    internal static void Run(Func<bool> processAware,Func<IntPtr> enter,Action<IntPtr> restore,Action run)
    {
        if(!processAware())throw new InvalidOperationException("DPI-aware preparation is required.");
        IntPtr previous=enter();
        if(previous==IntPtr.Zero)throw new InvalidOperationException("Per-monitor preparation coordinates are required.");
        try { run(); } finally { restore(previous); }
    }
}
