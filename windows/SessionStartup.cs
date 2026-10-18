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
    internal bool BrowserIsEmpty { get { return browser != null && browser.IsEmpty; } }
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
        if (captured != null) captured.Clear();
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
        if (browser != null) browser.Dispose();
        if (preview != null) preview.Clear();
        // Keep the source valid for callbacks already dispatched by SystemEvents.
        // It owns no OS handle because its WaitHandle is never requested.
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
