using System;

internal enum ForegroundKind { Unknown, Surface, OwnedEdge, Foreign }
internal sealed class SurfaceReading
{
    internal ForegroundKind Foreground;
    internal bool HitSurface, FullPrimaryClient, CursorRead, CursorNull, RendererReady, Cancelled, LaunchFailed;
    internal long Elapsed;
}
internal enum SurfaceAction { Keep, StartBrowser, Reveal, Close }

// Pure decisions shared by the actual host and lifecycle tests. No native writes.
internal sealed class SurfacePolicy
{
    private readonly bool boundedTest;
    internal bool Started, Revealed, Closed;
    internal SurfacePolicy(bool boundedTest = false) { this.boundedTest = boundedTest; }
    internal bool ObserveDeactivation(ForegroundKind actual)
    {
        if (Closed) return false;
        // Cross-queue WM_ACTIVATE's next-window hint may be NULL/stale. Only a
        // fresh actual foreground matters; ownership still needs the next poll.
        if (actual == ForegroundKind.Unknown || actual == ForegroundKind.Foreign) { Stop(); return false; }
        return true;
    }
    internal SurfaceAction Decide(SurfaceReading value)
    {
        if (Closed) return SurfaceAction.Keep;
        if (value.Cancelled || value.LaunchFailed || value.Foreground == ForegroundKind.Unknown || value.Foreground == ForegroundKind.Foreign ||
            !value.FullPrimaryClient || !value.HitSurface || !value.CursorRead || !value.CursorNull ||
            Revealed && !value.RendererReady || boundedTest && value.Elapsed >= 8000 || !Revealed && value.Elapsed >= 15000)
        { Stop(); return SurfaceAction.Close; }
        if (!Started)
        {
            if (value.Foreground != ForegroundKind.Surface) { Stop(); return SurfaceAction.Close; }
            Started = true; return SurfaceAction.StartBrowser;
        }
        if (!Revealed && value.RendererReady) { Revealed = true; return SurfaceAction.Reveal; }
        return SurfaceAction.Keep;
    }
    internal void Stop() { Closed = true; Revealed = false; }
}
