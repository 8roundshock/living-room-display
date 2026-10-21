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
    private readonly CancellationTokenSource cancellation = new CancellationTokenSource();
    private readonly object gate = new object();
    private readonly object cleanupGate = new object();
    private IPreviewSession preview;
    private IAmbientBrowser browser;
    private bool disposed;
    internal SessionStartup(ISessionSignals signals, Action<CancellationToken> ensureServer,
        Func<CancellationToken, IPreviewSession> connect, Func<CancellationToken, IAmbientBrowser> launch)
    {
        this.signals = signals;
        this.ensureServer = ensureServer;
        this.connect = connect;
        this.launch = launch;
        // Subscribe before cold start, handshake, capture, upload or browser creation.
        signals.Ended += Cancel;
        if (signals.HasEnded) Cancel();
    }
    internal bool IsCancelled { get { return cancellation.IsCancellationRequested; } }
    internal CancellationToken Token { get { return cancellation.Token; } }
    internal bool BrowserIsEmpty { get { return browser != null && browser.IsEmpty; } }
    internal IAmbientBrowser Browser { get { return browser; } }
    internal bool Start()
    {
        CancellationToken token = cancellation.Token;
        try
        {
            token.ThrowIfCancellationRequested();
            ensureServer(token);
            token.ThrowIfCancellationRequested();
            preview = connect(token);
            token.ThrowIfCancellationRequested();
            if (preview.PreviewEnabled) preview.UploadDesktop(token);
            token.ThrowIfCancellationRequested();
            browser = launch(token);
            token.ThrowIfCancellationRequested();
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
            if (disposed) return;
            // Abort registered in-flight HTTP before deleting. The backend generation
            // guard prevents a delayed request from resurrecting the cleared image.
            cancellation.Cancel();
            captured = preview;
        }
        if (captured != null)
        {
            lock (cleanupGate)
            {
                lock (gate) { if (disposed) return; }
                captured.Clear();
            }
        }
    }
    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
            signals.Ended -= Cancel;
            cancellation.Cancel();
        }
        signals.Dispose();
        lock (cleanupGate)
        {
            if (browser != null) browser.Dispose();
            if (preview != null) preview.Clear();
        }
        // Keep the source valid for callbacks already dispatched by SystemEvents.
        // It owns no OS handle because its WaitHandle is never requested.
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
