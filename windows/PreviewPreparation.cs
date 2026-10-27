using System;
using System.Threading;

// Pure periodic policy. No Windows calls, pixels, timers or transport live here.
internal struct PreparationReading
{
    internal bool Readable { get; set; }
    internal bool Enabled { get; set; }
    internal bool Safe { get; set; }
    internal bool CaptureAllowed { get; set; }
    internal uint InputTick { get; set; }
    internal long IdleMilliseconds { get; set; }
    internal long MonotonicMilliseconds { get; set; }
    internal int SessionId { get; set; }
    internal int TimeoutSeconds { get; set; }
    internal int LeadSeconds { get; set; }
    internal string Configuration { get; set; }
    internal long Generation { get; set; }
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
    internal bool CapturePaused { get; set; }
    internal long CaptureRevision { get; set; }
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
        observed.CaptureAllowed = observed.CaptureAllowed && !CapturePaused;
        observed.LeadSeconds = LeadSeconds;
        observed.Configuration = Revision;
        observed.Generation = Generation;
        return observed;
    }

    internal bool ConfirmsCapture(PreparationConfiguration current)
    {
        return Enabled && !CapturePaused && current != null && current.Enabled && !current.CapturePaused &&
            Generation == current.Generation && Revision == current.Revision && CaptureRevision == current.CaptureRevision;
    }

    internal static long ReadCaptureRevision(object value)
    {
        if (!(value is int) && !(value is long)) throw new InvalidOperationException("Invalid capture revision.");
        long revision=Convert.ToInt64(value);
        if(revision<0 || revision>9007199254740991L)throw new InvalidOperationException("Invalid capture revision.");
        return revision;
    }
}

internal static class SharedSnapshotMode
{
    internal static void Validate(object value)
    {
        if(!(value is bool) || !(bool)value)throw new InvalidOperationException("Shared snapshot mode is required.");
    }
}

// Fixed scalars retained only in producer RAM, with no exception text or pixels.
internal struct PreparationDiagnosticSnapshot
{
    internal string Event;
    internal long Sequence, CaptureAttempts, CaptureFailures;
}

internal sealed class PreparationDiagnostics
{
    private const long MaximumCounter=9007199254740991L;
    private readonly object gate=new object();
    private PreparationDiagnosticSnapshot current;
    private static long Increment(long value) { return value<MaximumCounter ? value+1 : value; }
    private void Record(string value) { current.Event=value; current.Sequence=Increment(current.Sequence); }
    internal void CaptureStarted() { lock(gate) { current.CaptureAttempts=Increment(current.CaptureAttempts); Record("capture-started"); } }
    internal void CaptureSkipped() { lock(gate) Record("capture-skipped"); }
    internal void CaptureFailed() { lock(gate) { current.CaptureFailures=Increment(current.CaptureFailures); Record("capture-failed"); } }
    internal void CaptureUploaded() { lock(gate) Record("capture-uploaded"); }
    internal PreparationDiagnosticSnapshot Snapshot() { lock(gate) return current; }
}

internal sealed class PreviewPreparationPolicy
{
    internal const long CaptureIntervalMilliseconds = 300000;
    internal const long MaximumObservationGapMilliseconds = 630000;
    private bool initialized, eligible;
    private uint input;
    private string configuration;
    private int timeoutSeconds, session;
    private long observedAt, nextCaptureAt;
    private long generation;
    internal void ObservationLost() { eligible=false; }
    internal void Acknowledge(long value) { generation=value; }

    internal PreparationDecision Observe(PreparationReading reading)
    {
        var decision = new PreparationDecision();
        if (!reading.Readable || reading.MonotonicMilliseconds < 0)
        {
            decision.Invalidate = true;
            decision.InvalidateActive = true;
            eligible = false;
            return decision;
        }
        bool changed = initialized && input != reading.InputTick;
        bool timeoutChanged = initialized && timeoutSeconds != reading.TimeoutSeconds;
        bool sessionChanged = initialized && session != reading.SessionId;
        bool clockChanged = initialized && (reading.MonotonicMilliseconds < observedAt ||
            reading.MonotonicMilliseconds - observedAt > MaximumObservationGapMilliseconds);
        bool configurationChanged = configuration != reading.Configuration;
        bool generationChanged = initialized && generation != reading.Generation;
        initialized = true;
        input = reading.InputTick;
        session = reading.SessionId;
        configuration = reading.Configuration;
        timeoutSeconds = reading.TimeoutSeconds;
        generation = reading.Generation;
        observedAt = reading.MonotonicMilliseconds;
        decision.Invalidate = timeoutChanged || sessionChanged || clockChanged || configurationChanged || !reading.Enabled || !reading.Safe;
        // Normal interaction dismisses an active preview, but must not erase the
        // latest desktop snapshot or postpone the next five-minute refresh.
        decision.InvalidateActive = decision.Invalidate || changed;
        bool allowed = reading.Enabled && reading.Safe && reading.CaptureAllowed && !clockChanged &&
            OutsideTransition(reading.IdleMilliseconds,reading.TimeoutSeconds,reading.LeadSeconds);
        if (!allowed)
        {
            eligible = false;
            return decision;
        }
        // Explicit periodic capture consent permits the first safe observation;
        // no hidden extra input is required after launching the app or signing in.
        if (!eligible || decision.Invalidate || generationChanged) nextCaptureAt = reading.MonotonicMilliseconds;
        eligible = true;
        if (reading.MonotonicMilliseconds >= nextCaptureAt)
        {
            nextCaptureAt = reading.MonotonicMilliseconds > long.MaxValue - CaptureIntervalMilliseconds
                ? long.MaxValue : reading.MonotonicMilliseconds + CaptureIntervalMilliseconds;
            decision.Capture = true;
        }
        return decision;
    }
    internal static bool OutsideTransition(long idle,int timeout,int leadSeconds)
    {
        long deadline=(long)timeout*1000, lead=(long)leadSeconds*1000;
        // The Windows deadline is a transition band, not proof that a saver is
        // running forever afterwards (video can inhibit it). Actual saver and
        // owned ambient checks remain mandatory on either side of this band.
        return deadline>0 && lead>0 && lead<deadline && idle>=0 && (idle<deadline-lead || idle>deadline+lead);
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
    internal static void Run(bool automatic,Action capture,CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        // Both displays read the backend's same canonical snapshot. Automatic
        // startup must not claim, clear or replace it with its startup surface.
        if(!automatic)capture();
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
