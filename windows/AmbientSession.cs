using System;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

// The input window owns its own queue, never an external Edge parent/owner.
// Active callbacks perform only bounded native reads; HTTP clear follows hiding.
internal sealed class AmbientSession : ApplicationContext
{
    private readonly SurfacePolicy policy;
    private readonly EventWaitHandle stop = new EventWaitHandle(false, EventResetMode.ManualReset, Native.StopEventName());
    private readonly Stopwatch age = new Stopwatch();
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 50 };
    private readonly SessionStartup startup;
    private readonly OwnedBrowser browser;
    private readonly string edgePath;
    private readonly AmbientInputSurface surface;
    private bool closed, disposed, ready;
    private int polling;
    internal bool Ready { get { return ready && !closed; } }

    internal AmbientSession(bool testDisplay)
    {
        policy = new SurfacePolicy(testDisplay);
        stop.Reset();
        try
        {
            var signals = new ActiveSessionSignals(new WindowsSessionSignals(), Native.ReadInput, delegate { return stop.WaitOne(0); });
            startup = new SessionStartup(signals, Program.EnsureServer,
                token => new NativeApi(token), token => new OwnedBrowser());
            if (!startup.Start()) return; // Cancellation already disposed startup.
            browser = (OwnedBrowser)startup.Browser;
            edgePath = Program.FindEdge();
            surface = new AmbientInputSurface(Foreground, RequestStop, Deactivated);
            surface.Shown += delegate { age.Restart(); timer.Start(); };
            timer.Tick += delegate { Poll(); };
            startup.Token.ThrowIfCancellationRequested();
            surface.Show(); // One ordinary activation, no focus repair/retry.
            ready = true;
        }
        catch (OperationCanceledException) { Cleanup(); }
        catch { Cleanup(); throw; }
    }
    private ForegroundKind Foreground(IntPtr window)
    {
        if (window == IntPtr.Zero) return ForegroundKind.Unknown;
        if (surface != null && surface.IsHandleCreated && window == surface.Handle) return ForegroundKind.Surface;
        return browser != null && browser.OwnsWindow(window) ? ForegroundKind.OwnedEdge : ForegroundKind.Foreign;
    }
    private void Deactivated(IntPtr unusedHint)
    {
        // Exactly one actual foreground sample; the async lParam may be NULL.
        ForegroundKind actual = Foreground(DisplayNative.GetForegroundWindow());
        if (!policy.ObserveDeactivation(actual)) RequestStop();
    }
    private void Poll()
    {
        if (closed || Interlocked.Exchange(ref polling, 1) != 0) return;
        try
        {
            var cursor = DisplayNative.Cursor();
            IntPtr foreground = DisplayNative.GetForegroundWindow();
            Rectangle bounds = DisplayNative.Client(surface.Handle);
            bool full = bounds == Screen.PrimaryScreen.Bounds;
            bool hit = full && bounds.Contains(cursor.point.X, cursor.point.Y) && DisplayNative.HitSurface(surface.Handle, cursor.point);
            bool rendererReady = policy.Started && browser.ReadyWindow() != IntPtr.Zero;
            SurfaceAction action = policy.Decide(new SurfaceReading {
                Foreground = Foreground(foreground), HitSurface = hit, FullPrimaryClient = full,
                CursorRead = cursor.success, CursorNull = cursor.cursor == IntPtr.Zero,
                RendererReady = rendererReady, Cancelled = startup.IsCancelled,
                LaunchFailed = browser.Failed, Elapsed = age.ElapsedMilliseconds
            });
            if (action == SurfaceAction.Close) { RequestStop(); return; }
            if (action == SurfaceAction.StartBrowser) browser.Launch(edgePath, Program.BaseUrl + "/display?native=1", startup.Token);
            if (action == SurfaceAction.Reveal)
            {
                // Alpha is never proof of ownership. Recheck before revealing.
                var fresh = DisplayNative.Cursor();
                var actual = Foreground(DisplayNative.GetForegroundWindow());
                if (startup.IsCancelled || !fresh.success || fresh.cursor != IntPtr.Zero ||
                    DisplayNative.Client(surface.Handle) != Screen.PrimaryScreen.Bounds || !DisplayNative.HitSurface(surface.Handle, fresh.point) ||
                    actual != ForegroundKind.Surface && actual != ForegroundKind.OwnedEdge || browser.ReadyWindow() == IntPtr.Zero)
                { RequestStop(); return; }
                if (!DisplayNative.SetLayeredWindowAttributes(surface.Handle, 0, 1, 2)) { RequestStop(); return; }
                surface.Text = AmbientInputSurface.ReadyTitle;
            }
        }
        catch { RequestStop(); } // Never a modal UI-thread exception dialog.
        finally { polling = 0; }
    }
    private void RequestStop(string ignoredReason) { RequestStop(); } // Native surface emits no production diagnostics.
    private void RequestStop()
    {
        if (closed) return;
        closed = true; policy.Stop(); timer.Stop();
        if (surface != null && surface.IsHandleCreated)
        {
            DisplayNative.ShowWindow(surface.Handle, 0); // Hide own HWND before any cleanup/network operation.
            try { surface.Hide(); surface.Text = AmbientInputSurface.LoadingTitle; } catch { }
            try { surface.BeginInvoke(new Action(delegate { surface.Close(); ExitThread(); })); return; } catch { }
        }
        ExitThread();
    }
    protected override void ExitThreadCore() { Cleanup(); base.ExitThreadCore(); }
    protected override void Dispose(bool disposing) { if (disposing) Cleanup(); base.Dispose(disposing); }
    private void Cleanup()
    {
        if (disposed) return;
        disposed = true; closed = true; policy.Stop(); timer.Stop(); timer.Dispose();
        if (surface != null)
        {
            if (surface.IsHandleCreated) DisplayNative.ShowWindow(surface.Handle, 0);
            surface.Dispose();
        }
        if (startup != null) startup.Dispose(); // Exact job and RAM clear, after the surface is gone.
        stop.Dispose();
    }
}
