using System;
internal static class SurfacePolicyTests
{
    private static void Check(bool value, string why) { if (!value) throw new Exception(why); }
    private static SurfaceReading Safe() { return new SurfaceReading { Foreground = ForegroundKind.Surface, HitSurface = true, FullPrimaryClient = true, CursorRead = true, CursorNull = true }; }
    private static void Main()
    {
        Check(!NativeBrowserReadiness.MatchesTitle("Still \u00b7 Display - [InPrivate] - Microsoft Edge"), "legacy loading title never grants content readiness");
        Check(!NativeBrowserReadiness.MatchesTitle("Still \u00b7 Starting display - Microsoft Edge"), "starting title never grants content readiness");
        Check(NativeBrowserReadiness.MatchesTitle(NativeBrowserReadiness.ContentTitle + " - [InPrivate] - Microsoft Edge") &&
            NativeBrowserReadiness.MatchesTitle(NativeBrowserReadiness.ContentTitle + " - Microsoft Edge"), "exact native content marker admits the two owned Edge title formats");
        Check(!NativeBrowserReadiness.MatchesTitle(NativeBrowserReadiness.ContentTitle + " - Another browser"), "foreign title suffix is rejected");
        Check(NativeBrowserReadiness.PaintArguments == " --disable-backgrounding-occluded-windows", "only native rendering is kept painting behind its opaque startup cover");
        var policy = new SurfacePolicy(); var read = Safe();
        Check(policy.Decide(read) == SurfaceAction.StartBrowser, "NULL own-client ownership precedes browser");
        Check(policy.Decide(read) == SurfaceAction.Keep, "one browser launch");
        read.Foreground = ForegroundKind.OwnedEdge; read.RendererReady = true;
        Check(policy.Decide(read) == SurfaceAction.Reveal && policy.Decide(read) == SurfaceAction.Keep, "owned Edge activation can reveal exactly once");
        read.RendererReady = false;
        Check(policy.Decide(read) == SurfaceAction.Close && !policy.Revealed, "renderer loss clears ready/reveal and closes");
        foreach (var actual in new[] { ForegroundKind.Unknown, ForegroundKind.Foreign })
        {
            policy = new SurfacePolicy(); policy.Decide(Safe());
            Check(!policy.ObserveDeactivation(actual) && policy.Closed, "unknown/foreign actual foreground closes immediately");
            Check(!policy.ObserveDeactivation(ForegroundKind.Surface) && policy.Decide(Safe()) == SurfaceAction.Keep && !policy.Revealed, "closed activation cannot reopen");
        }
        foreach (var own in new[] { ForegroundKind.Surface, ForegroundKind.OwnedEdge })
        {
            policy = new SurfacePolicy(); policy.Decide(Safe());
            Check(policy.ObserveDeactivation(own) && !policy.Revealed, "actual session foreground alone grants no readiness");
            read = Safe(); read.Foreground = own; read.CursorNull = false;
            Check(policy.Decide(read) == SurfaceAction.Close, "next full poll rejects visible glyph; no focus/cursor repair");
        }
        foreach (var foreground in new[] { ForegroundKind.Unknown, ForegroundKind.Foreign, ForegroundKind.OwnedEdge })
        {
            policy = new SurfacePolicy(); read = Safe(); read.Foreground = foreground;
            Check(policy.Decide(read) == SurfaceAction.Close && !policy.Started, "initial browser requires own foreground");
        }
        foreach (int missing in new[] { 0, 1, 2, 3 })
        {
            policy = new SurfacePolicy(); read = Safe();
            if (missing == 0) read.HitSurface = false; if (missing == 1) read.FullPrimaryClient = false;
            if (missing == 2) read.CursorRead = false; if (missing == 3) read.CursorNull = false;
            Check(policy.Decide(read) == SurfaceAction.Close && !policy.Started, "style/alpha cannot substitute for real client/hit/cursor ownership");
        }
        policy = new SurfacePolicy(); read = Safe(); policy.Decide(read); read.Cancelled = true;
        Check(policy.Decide(read) == SurfaceAction.Close, "input/session cancellation closes immediately without grace");
        policy = new SurfacePolicy(); read = Safe(); read.LaunchFailed = true;
        Check(policy.Decide(read) == SurfaceAction.Close, "launch failure never reveals");
        policy = new SurfacePolicy(); read = Safe(); policy.Decide(read); read.Elapsed = 15000;
        Check(policy.Decide(read) == SurfaceAction.Close, "failed loading is bounded");
        policy = new SurfacePolicy(true); read = Safe(); policy.Decide(read); read.Elapsed = 8000;
        Check(policy.Decide(read) == SurfaceAction.Close, "test display remains bounded");
        policy = new SurfacePolicy(); read = Safe(); policy.Decide(read); read.RendererReady = true; policy.Decide(read); read.Elapsed = 8000;
        Check(policy.Decide(read) == SurfaceAction.Keep, "normal saver is not the eight-second test");
        policy.Stop(); Check(policy.Decide(Safe()) == SurfaceAction.Keep && !policy.Revealed, "terminal UI failure cannot reveal/restart");
        Console.WriteLine("Surface policy PASS: first ownership, exact session activation, NULL/hit/physical requirements, renderer loss, terminal cancellation and bounded failures; no native/UI calls.");
    }
}
