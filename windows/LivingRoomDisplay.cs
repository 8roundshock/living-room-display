// .NET Framework 4.x / C# 5: deliberately no external native-host dependencies.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    internal const string BaseUrl = "http://127.0.0.1:4318";
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            Native.SetProcessDPIAware();
            string mode = args.Length == 0 ? "/c" : args[0].ToLowerInvariant();
            if (mode == "--check")
            {
                Console.WriteLine("Windows helper ready; Edge: " + FindEdge());
                return 0;
            }
            if (mode == "/p" || mode.StartsWith("/p:")) return Preview(args);
            if (mode == "/c" || mode.StartsWith("/c:") || mode == "--editor")
            {
                EnsureServer();
                Process.Start(BaseUrl + "/editor");
                return 0;
            }
            if (mode != "/s" && mode != "--display" && mode != "--test-display")
                throw new ArgumentException("Use /s, /c, /p <window>, --display, or --check.");
            bool owned;
            using (Mutex single = new Mutex(true, "Local\\LivingRoomDisplay.Ambient", out owned))
            {
                if (!owned) return 0;
                try
                {
                    Application.EnableVisualStyles();
                    using (AmbientSession session = new AmbientSession(mode == "--test-display"))
                        if (session.Ready) Application.Run(session);
                }
                finally { single.ReleaseMutex(); }
            }
            return 0;
        }
        catch (Exception ex)
        {
            // No URLs with credentials, settings, reminder contents, tokens or pixels.
            Console.Error.WriteLine("Living Room Display: " + ex.GetType().Name + ": " + ex.Message);
            return 1;
        }
    }

    internal static string FindEdge()
    {
        string[] paths = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe")
        };
        foreach (string path in paths) if (File.Exists(path)) return path;
        throw new FileNotFoundException("Microsoft Edge is required. Install Edge from Microsoft, then retry.");
    }

    internal static void EnsureServer(CancellationToken cancellation = default(CancellationToken))
    {
        cancellation.ThrowIfCancellationRequested();
        string script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "LivingRoomDisplay.ps1");
        if (!File.Exists(script)) throw new FileNotFoundException("Install the app before running its screensaver.");
        string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
        using (Process starter = Process.Start(new ProcessStartInfo(shell,
            "-NoProfile -ExecutionPolicy Bypass -File " + Native.Quote(script) + " Start -NoBrowser") {
                UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
            }))
        {
            if (!starter.WaitForExit(20000)) { starter.Kill(); throw new TimeoutException("Local server startup timed out."); }
            if (starter.ExitCode != 0) throw new InvalidOperationException("Local server could not start; run the Status command.");
        }
        cancellation.ThrowIfCancellationRequested();
        if (!NativeApi.IsReady()) throw new InvalidOperationException("Local server did not become ready.");
    }

    private static int Preview(string[] args)
    {
        string value = args[0].Length > 3 ? args[0].Substring(3) : args.Length > 1 ? args[1] : "0";
        long parsed;
        if (!long.TryParse(value, out parsed) || parsed == 0 || !Native.IsWindow(new IntPtr(parsed))) return 0;
        Application.EnableVisualStyles();
        using (Form preview = new Form())
        {
            preview.FormBorderStyle = FormBorderStyle.None;
            preview.BackColor = Color.Black;
            preview.ForeColor = Color.FromArgb(74, 92, 104);
            preview.ShowInTaskbar = false;
            preview.Controls.Add(new Label { Text = "Living Room Display", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter });
            Native.SetParent(preview.Handle, new IntPtr(parsed));
            Native.SetWindowLong(preview.Handle, -16, (Native.GetWindowLong(preview.Handle, -16) | 0x40000000) & ~unchecked((int)0x80000000));
            Native.Rect rect;
            Native.GetClientRect(new IntPtr(parsed), out rect);
            preview.Bounds = new Rectangle(0, 0, rect.Right, rect.Bottom);
            using (System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 250 })
            {
                timer.Tick += delegate { if (!Native.IsWindow(new IntPtr(parsed))) preview.Close(); };
                timer.Start();
                Application.Run(preview);
            }
        }
        return 0;
    }
}

internal sealed class AmbientSession : ApplicationContext
{
    private readonly SessionStartup startup;
    private readonly System.Windows.Forms.Timer timer;
    private readonly Stopwatch age = Stopwatch.StartNew();
    private uint baseline;
    private bool closed;
    private readonly bool test;
    private readonly EventWaitHandle stop = new EventWaitHandle(false, EventResetMode.ManualReset, Native.StopEventName());
    internal bool Ready { get; private set; }

    internal AmbientSession(bool testDisplay)
    {
        test = testDisplay;
        stop.Reset();
        try
        {
            startup = new SessionStartup(new WindowsSessionSignals(),
                token => Program.EnsureServer(token), token => new NativeApi(token),
                token => new OwnedBrowser(Program.FindEdge(), Program.BaseUrl + "/display", token));
            Ready = startup.Start();
            if (!Ready) return;
            age.Restart();
            baseline = Native.LastInputTick();
            timer = new System.Windows.Forms.Timer { Interval = 100 };
            timer.Tick += OnTick;
            timer.Start();
        }
        catch { Cleanup(); throw; }
    }

    private void OnTick(object sender, EventArgs e)
    {
        uint input = Native.LastInputTick();
        if (age.ElapsedMilliseconds < 1200) baseline = input;
        if (startup.IsCancelled || stop.WaitOne(0) || age.ElapsedMilliseconds >= 1200 && input != baseline ||
            age.ElapsedMilliseconds > 3000 && startup.BrowserIsEmpty ||
            test && age.ElapsedMilliseconds > 8000)
            ExitThread();
    }

    protected override void ExitThreadCore()
    {
        Cleanup();
        base.ExitThreadCore();
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) Cleanup();
        base.Dispose(disposing);
    }
    private void Cleanup()
    {
        if (closed) return;
        closed = true;
        if (timer != null) timer.Dispose();
        if (startup != null) startup.Dispose();
        stop.Dispose();
    }
}

internal sealed class NativeApi : IPreviewSession
{
    private string token;
    public bool PreviewEnabled { get; private set; }
    internal NativeApi(CancellationToken cancellation)
    {
            cancellation.ThrowIfCancellationRequested();
            string json = Request("GET", "/api/host/session", null, cancellation, 5000);
            var data = new JavaScriptSerializer().DeserializeObject(json) as System.Collections.Generic.Dictionary<string, object>;
            token = (string)data["token"];
            var settings = data["settings"] as System.Collections.Generic.Dictionary<string, object>;
            var preview = settings["preview"] as System.Collections.Generic.Dictionary<string, object>;
            var widgets = settings["widgets"] as System.Collections.Generic.Dictionary<string, object>;
            PreviewEnabled = (bool)preview["enabled"] && (bool)widgets["preview"];
    }
    internal static bool IsReady()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Program.BaseUrl + "/api/health");
            request.Timeout = 1000;
            request.Proxy = null;
            using (WebResponse response = request.GetResponse()) return true;
        }
        catch (WebException) { return false; }
    }
    public void UploadDesktop(CancellationToken cancellation)
    {
        try
        {
            cancellation.ThrowIfCancellationRequested();
            Rectangle bounds = Screen.PrimaryScreen.Bounds;
            double scale = Math.Min(1, Math.Min(640.0 / bounds.Width, 360.0 / bounds.Height));
            using (Bitmap screen = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb))
            using (Graphics capture = Graphics.FromImage(screen))
            using (Bitmap small = new Bitmap(Math.Max(1, (int)(bounds.Width * scale)), Math.Max(1, (int)(bounds.Height * scale))))
            using (Graphics resize = Graphics.FromImage(small))
            using (MemoryStream png = new MemoryStream())
            {
                cancellation.ThrowIfCancellationRequested();
                capture.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size, CopyPixelOperation.SourceCopy);
                resize.InterpolationMode = InterpolationMode.HighQualityBicubic;
                resize.DrawImage(screen, new Rectangle(0, 0, small.Width, small.Height));
                small.Save(png, ImageFormat.Png);
                cancellation.ThrowIfCancellationRequested();
                Request("POST", "/api/preview", png.ToArray(), cancellation, 5000);
            }
        }
        catch (Exception ex)
        {
            if (!(ex is ExternalException || ex is WebException || ex is ArgumentException)) throw;
            Clear(); // A protected or unavailable desktop is simply absent.
        }
    }
    public void Clear()
    {
        if (token == null) return;
        try
        {
            Request("DELETE", "/api/preview", null, CancellationToken.None, 2000);
        }
        catch (WebException) { }
    }
    private string Request(string method, string path, byte[] pixels, CancellationToken cancellation, int timeout)
    {
        cancellation.ThrowIfCancellationRequested();
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Program.BaseUrl + path);
        request.Method = method;
        request.Timeout = timeout;
        request.ReadWriteTimeout = timeout;
        request.Proxy = null;
        request.AllowAutoRedirect = false;
        if (path == "/api/host/session") request.Headers["X-LRD-Native"] = "1";
        else request.Headers["X-LRD-Token"] = token;
        if (pixels != null)
        {
            request.Headers["X-Captured-At"] = DateTime.UtcNow.ToString("o");
            request.ContentType = "image/png";
            request.ContentLength = pixels.Length;
        }
        using (cancellation.Register(delegate { request.Abort(); }))
        {
            try
            {
                cancellation.ThrowIfCancellationRequested();
                if (pixels != null) using (Stream body = request.GetRequestStream()) body.Write(pixels, 0, pixels.Length);
                using (WebResponse response = request.GetResponse())
                {
                    if (((HttpWebResponse)response).StatusCode == HttpStatusCode.NoContent) return "";
                    using (StreamReader reader = new StreamReader(response.GetResponseStream())) return reader.ReadToEnd();
                }
            }
            catch (WebException) { cancellation.ThrowIfCancellationRequested(); throw; }
        }
    }
}

internal sealed class OwnedBrowser : IAmbientBrowser
{
    private IntPtr job;
    private CancellationTokenRegistration cancellationRegistration;
    internal OwnedBrowser(string executable, string url, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        job = Native.CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        try
        {
            cancellationRegistration = cancellation.Register(CloseJob);
            cancellation.ThrowIfCancellationRequested();
            Native.JobLimits limits = new Native.JobLimits();
            limits.BasicLimitInformation.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
            if (!Native.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)))
                throw new System.ComponentModel.Win32Exception();
            string profile = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "edge-profile"));
            string arguments = Native.Quote(executable) + " --kiosk " + Native.Quote(url) +
                " --edge-kiosk-type=fullscreen --no-first-run --no-default-browser-check --disable-background-mode --inprivate --user-data-dir=" + Native.Quote(profile);
            Native.StartupInfo startup = new Native.StartupInfo();
            startup.cb = Marshal.SizeOf(startup);
            Native.ProcessInformation process;
            if (!Native.CreateProcess(executable, new StringBuilder(arguments), IntPtr.Zero, IntPtr.Zero, false, 4, IntPtr.Zero, null, ref startup, out process))
                throw new System.ComponentModel.Win32Exception();
            try
            {
                if (!Native.AssignProcessToJobObject(job, process.hProcess))
                {
                    Native.TerminateProcess(process.hProcess, 1);
                    throw new System.ComponentModel.Win32Exception();
                }
                cancellation.ThrowIfCancellationRequested();
                if (Native.ResumeThread(process.hThread) == uint.MaxValue)
                    throw new System.ComponentModel.Win32Exception();
            }
            finally { Native.CloseHandle(process.hThread); Native.CloseHandle(process.hProcess); }
        }
        catch { Dispose(); cancellation.ThrowIfCancellationRequested(); throw; }
    }
    public bool IsEmpty
    {
        get
        {
            Native.JobAccounting account;
            return Native.QueryInformationJobObject(job, 1, out account, (uint)Marshal.SizeOf(typeof(Native.JobAccounting)), IntPtr.Zero) && account.ActiveProcesses == 0;
        }
    }
    private void CloseJob()
    {
        IntPtr ownedJob = Interlocked.Exchange(ref job, IntPtr.Zero);
        if (ownedJob != IntPtr.Zero) Native.CloseHandle(ownedJob);
    }
    public void Dispose() { cancellationRegistration.Dispose(); CloseJob(); }
}

internal static class Native
{
    internal static string StopEventName()
    {
        string path = Path.GetFullPath(Process.GetCurrentProcess().MainModule.FileName).ToUpperInvariant();
        using (var hash = System.Security.Cryptography.SHA256.Create())
            return "Local\\LivingRoomDisplay.Stop." + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(path))).Replace("-", "").Substring(0, 12);
    }
    internal static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
    internal static uint LastInputTick() { LastInput info = new LastInput(); info.cbSize = (uint)Marshal.SizeOf(info); return GetLastInputInfo(ref info) ? info.dwTime : 0; }
    [StructLayout(LayoutKind.Sequential)] internal struct LastInput { internal uint cbSize, dwTime; }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { internal int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] internal struct StartupInfo { internal int cb; internal string lpReserved, lpDesktop, lpTitle; internal uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; internal short wShowWindow, cbReserved2; internal IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] internal struct ProcessInformation { internal IntPtr hProcess, hThread; internal uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] internal struct BasicLimits { internal long PerProcessUserTimeLimit, PerJobUserTimeLimit; internal uint LimitFlags; internal UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; internal uint ActiveProcessLimit; internal UIntPtr Affinity; internal uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] internal struct IoCounters { internal ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] internal struct JobLimits { internal BasicLimits BasicLimitInformation; internal IoCounters IoInfo; internal UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential)] internal struct JobAccounting { internal long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime; internal uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
    [DllImport("user32.dll")] internal static extern bool GetLastInputInfo(ref LastInput info);
    [DllImport("user32.dll")] internal static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] internal static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] internal static extern int SetWindowLong(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")] internal static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetInformationJobObject(IntPtr job, int type, ref JobLimits information, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool QueryInformationJobObject(IntPtr job, int type, out JobAccounting information, uint size, IntPtr returned);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation information);
    [DllImport("kernel32.dll")] internal static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] internal static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
}
