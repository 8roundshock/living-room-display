using System;
using System.Threading;
using Microsoft.Win32;

// This coordinator is shared by the real host and deterministic fake-transport tests.
internal interface ISessionSignals : IDisposable
{
    event Action Ended;
    bool HasEnded { get; }
}
internal interface IPreviewSession
{
    bool PreviewEnabled { get; }
    void UploadDesktop(CancellationToken cancellation);
    void Clear();
}
internal interface IAmbientBrowser : IDisposable { bool IsEmpty { get; } }

internal sealed class SessionStartup : IDisposable
{
    private readonly ISessionSignals signals;
    private readonly Action<CancellationToken> ensureServer;
    private readonly Func<CancellationToken, IPreviewSession> connect;
    private readonly Func<CancellationToken, IAmbientBrowser> launch;
    private readonly Action ending, handshakeCompleted;
    private readonly CancellationTokenSource cancellation = new CancellationTokenSource();
    private readonly object gate = new object();
    private readonly object cleanupGate = new object();
    private IPreviewSession preview;
    private IAmbientBrowser browser;
    private bool disposed, browserReleased, browserReleaseCompleted, browserReleaseSucceeded, disposalCompleted, disposalSucceeded;
    private int browserReleaseThread, disposalThread;
    private volatile bool cancelled;
    internal SessionStartup(ISessionSignals signals, Action<CancellationToken> ensureServer,
        Func<CancellationToken, IPreviewSession> connect, Func<CancellationToken, IAmbientBrowser> launch, Action ending = null, Action handshakeCompleted = null)
    {
        this.signals = signals;
        this.ensureServer = ensureServer;
        this.connect = connect;
        this.launch = launch;
        this.ending = ending;
        this.handshakeCompleted = handshakeCompleted;
        // Subscribe before cold start, handshake, capture, upload or browser creation.
        signals.Ended += Cancel;
        if (signals.HasEnded) Cancel();
    }
    internal bool IsCancelled { get { return cancelled || cancellation.IsCancellationRequested; } }
    internal CancellationToken Token { get { return cancellation.Token; } }
    internal IAmbientBrowser Browser { get { return browser; } }
    internal bool ObserveWhileActive(Action observation)
    {
        if (IsCancelled) return false;
        observation();
        return !IsCancelled;
    }
    private void ThrowIfEnded()
    {
        if (IsCancelled) throw new OperationCanceledException(cancellation.Token);
    }
    internal bool Start()
    {
        CancellationToken token = cancellation.Token;
        try
        {
            ThrowIfEnded();
            ensureServer(token);
            ThrowIfEnded();
            IPreviewSession connected = connect(token);
            // A forced exit is eligible only after this one host handshake has
            // returned, before even a rejected session's Clear can block.
            if (handshakeCompleted != null) handshakeCompleted();
            bool accept;
            lock (gate) { accept = !disposed && !cancelled; if (accept) preview = connected; }
            if (!accept) { lock (cleanupGate) connected.Clear(); ThrowIfEnded(); }
            ThrowIfEnded();
            if (preview.PreviewEnabled) preview.UploadDesktop(token);
            ThrowIfEnded();
            IAmbientBrowser created = launch(token);
            lock (gate) { accept = !disposed && !cancelled; if (accept) browser = created; }
            if (!accept) { created.Dispose(); ThrowIfEnded(); }
            ThrowIfEnded();
            return true;
        }
        catch (OperationCanceledException) { Dispose(); return false; }
        catch { Dispose(); throw; }
    }
    private void Cancel()
    {
        IPreviewSession captured;
        lock (gate)
        {
            if (disposed || cancelled) return;
            cancelled = true;
            captured = preview;
        }
        // Input arrives off the UI queue. Arm the requested helper's exit deadline
        // and release its exact renderer before Abort callbacks or HTTP can wait.
        if (ending != null) ending();
        StopBrowser();
        WaitForBrowserRelease();
        try { cancellation.Cancel(); }
        finally
        {
            if (captured != null) lock (cleanupGate)
            {
                bool clear; lock (gate) { clear = !disposed; }
                if (clear) captured.Clear();
            }
        }
    }
    internal void StopBrowser()
    {
        IAmbientBrowser captured;
        lock (gate)
        {
            if (browserReleased || browser == null) return;
            browserReleased = true; browserReleaseThread = Thread.CurrentThread.ManagedThreadId; captured = browser;
        }
        bool succeeded = false;
        try { captured.Dispose(); succeeded = true; }
        finally { lock (gate) { browserReleaseSucceeded = succeeded; browserReleaseCompleted = true; Monitor.PulseAll(gate); } }
    }
    private void WaitForBrowserRelease()
    {
        lock (gate)
        {
            while (browserReleased && !browserReleaseCompleted) Monitor.Wait(gate);
            if (browserReleased && !browserReleaseSucceeded) throw new InvalidOperationException("Owned renderer teardown did not complete.");
        }
    }
    public void Dispose()
    {
        lock (gate)
        {
            int current = Thread.CurrentThread.ManagedThreadId;
            // A same-stack callback must not wait for its own release/disposal.
            // Its outer owner still performs and acknowledges the real teardown.
            if (browserReleased && !browserReleaseCompleted && browserReleaseThread == current) return;
            if (disposed)
            {
                if (disposalThread == current) return;
                while (!disposalCompleted) Monitor.Wait(gate);
                if (!disposalSucceeded) throw new InvalidOperationException("Session teardown did not complete.");
                return;
            }
            disposed = true; cancelled = true;
            disposalThread = current;
            signals.Ended -= Cancel;
        }
        bool succeeded = false;
        try
        {
            if (ending != null) ending();
            StopBrowser();
            WaitForBrowserRelease();
            // No callback runs under gate. Concurrent cleanup cannot acknowledge
            // completion while another thread is still releasing the renderer.
            try { cancellation.Cancel(); }
            finally
            {
                try { signals.Dispose(); }
                finally { lock (cleanupGate) { if (preview != null) preview.Clear(); } }
            }
            succeeded = true;
        }
        finally
        {
            lock (gate) { disposalSucceeded = succeeded; disposalCompleted = true; Monitor.PulseAll(gate); }
        }
        // Keep the source valid for callbacks already dispatched by SystemEvents.
        // It owns no OS handle because its WaitHandle is never requested.
    }
}

// One already-requested native session only. The deadline requests exact-self
// termination if genuine teardown never completes; it cannot repair a hung OS.
internal sealed class SessionExitDeadline
{
    internal const int Milliseconds = 6000;
    private readonly object gate = new object();
    private readonly Func<Action, int, IDisposable> schedule;
    private readonly Action terminate;
    private IDisposable timer;
    private bool armed, enabled, scheduled, completed, requested;
    internal SessionExitDeadline(Func<Action, int, IDisposable> schedule, Action terminate)
    { this.schedule = schedule; this.terminate = terminate; }
    internal void Arm()
    {
        lock (gate) { if (completed || requested) return; armed = true; }
        ScheduleIfReady();
    }
    internal void Enable()
    {
        lock (gate) { if (completed || requested) return; enabled = true; }
        ScheduleIfReady();
    }
    private void ScheduleIfReady()
    {
        lock (gate) { if (!armed || !enabled || scheduled || completed) return; scheduled = true; }
        IDisposable created;
        try
        {
            created = schedule(Expire, Milliseconds);
            if (created == null) throw new InvalidOperationException("The native exit deadline could not be scheduled.");
        }
        catch { Expire(); throw; } // Never silently continue without the requested deadline.
        bool discard;
        lock (gate) { discard = completed || requested; if (!discard) timer = created; }
        if (discard) created.Dispose();
    }
    internal void Complete()
    {
        IDisposable captured;
        lock (gate)
        {
            // If expiry committed first, later completion cannot retract its one
            // request. Completion that wins first makes all stale callbacks inert.
            if (completed || requested) return;
            completed = true; captured = timer; timer = null;
        }
        if (captured != null) captured.Dispose();
    }
    private void Expire()
    {
        IDisposable captured;
        lock (gate)
        {
            if (!scheduled || completed || requested) return;
            requested = true; captured = timer; timer = null;
        }
        try { if (captured != null) captured.Dispose(); }
        finally { terminate(); }
    }
}

internal struct InputStamp
{
    internal bool Success { get; set; }
    internal uint Tick { get; set; }
}

// Shared by the real active-session monitor and deterministic caller regressions.
// Never adopt a later tick: one early input must remain terminal without more input.
internal sealed class ActiveInputBaseline
{
    private readonly uint original;
    internal bool Changed { get; private set; }
    internal ActiveInputBaseline(InputStamp initial) { original = initial.Tick; Changed = !initial.Success; }
    internal bool Observe(InputStamp current)
    {
        Changed = Changed || !current.Success || current.Tick != original;
        return Changed;
    }
}

// Exists only for one requested ambient session, including its blocking startup.
// No global hook, service, key contents or device inventory is used.
internal sealed class ActiveSessionSignals : ISessionSignals
{
    private readonly ISessionSignals session;
    private readonly Func<InputStamp> read;
    private readonly Func<bool> stop;
    private readonly ActiveInputBaseline input;
    private readonly object gate = new object();
    private readonly Timer timer;
    private bool disposed;
    private volatile bool ended;
    private int polling;
    public event Action Ended;
    public bool HasEnded { get { return ended; } }
    internal ActiveSessionSignals(ISessionSignals session, Func<InputStamp> read, Func<bool> stop, bool startTimer = true)
    {
        this.session = session; this.read = read; this.stop = stop;
        try
        {
            input = new ActiveInputBaseline(read());
            session.Ended += End;
            if (session.HasEnded || input.Changed || stop()) End();
            if (startTimer && !ended) timer = new Timer(delegate { Poll(); }, null, 0, 50);
        }
        catch { Dispose(); throw; }
    }
    internal void Poll()
    {
        if (Interlocked.Exchange(ref polling, 1) != 0) return;
        try
        {
            lock (gate) { if (disposed || ended) return; }
            if (stop() || input.Observe(read())) End();
        }
        catch { End(); } // Unreadable input/control state cancels, never starts/reopens.
        finally { polling = 0; }
    }
    private void End()
    {
        Action handler;
        lock (gate) { if (disposed || ended) return; ended = true; handler = Ended; }
        if (handler != null) handler();
    }
    public void Dispose()
    {
        lock (gate) { if (disposed) return; disposed = true; session.Ended -= End; }
        if (timer != null) timer.Dispose();
        session.Dispose();
    }
}

internal sealed class WindowsSessionSignals : ISessionSignals
{
    public event Action Ended;
    private volatile bool ended;
    public bool HasEnded { get { return ended; } }
    internal WindowsSessionSignals() { SystemEvents.SessionSwitch += OnSwitch; }
    private void OnSwitch(object sender, SessionSwitchEventArgs e)
    {
        if (e.Reason != SessionSwitchReason.SessionLock && e.Reason != SessionSwitchReason.SessionLogoff &&
            e.Reason != SessionSwitchReason.RemoteDisconnect && e.Reason != SessionSwitchReason.ConsoleDisconnect) return;
        ended = true;
        Action handler = Ended;
        if (handler != null) handler();
    }
    public void Dispose() { SystemEvents.SessionSwitch -= OnSwitch; }
}
