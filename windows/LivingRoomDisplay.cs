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
                    EnsureServer();
                    Application.EnableVisualStyles();
                    using (AmbientSession session = new AmbientSession(mode == "--test-display"))
                        Application.Run(session);
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

    internal static void EnsureServer()
    {
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
    private readonly NativeApi api;
    private readonly OwnedBrowser browser;
    private readonly System.Windows.Forms.Timer timer;
    private readonly Stopwatch age = Stopwatch.StartNew();
    private uint baseline;
    private bool closed;
    private readonly bool test;
    private readonly EventWaitHandle stop = new EventWaitHandle(false, EventResetMode.ManualReset, Native.StopEventName());
    private volatile bool sessionEnded;

    internal AmbientSession(bool testDisplay)
    {
        test = testDisplay;
        stop.Reset();
        api = new NativeApi();
        try
        {
            // Capture occurs once, before any ambient browser is created. Failure omits preview.
            if (api.PreviewEnabled) api.UploadDesktop();
            browser = new OwnedBrowser(Program.FindEdge(), Program.BaseUrl + "/display");
            baseline = Native.LastInputTick();
            timer = new System.Windows.Forms.Timer { Interval = 100 };
            timer.Tick += OnTick;
            SystemEvents.SessionSwitch += OnSessionSwitch;
            timer.Start();
        }
        catch { api.Clear(); if (browser != null) browser.Dispose(); throw; }
    }

    private void OnTick(object sender, EventArgs e)
    {
        uint input = Native.LastInputTick();
        if (age.ElapsedMilliseconds < 1200) baseline = input;
        if (sessionEnded || stop.WaitOne(0) || age.ElapsedMilliseconds >= 1200 && input != baseline ||
            age.ElapsedMilliseconds > 3000 && browser.IsEmpty ||
            test && age.ElapsedMilliseconds > 8000)
            ExitThread();
    }

    private void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        if (e.Reason == SessionSwitchReason.SessionLock || e.Reason == SessionSwitchReason.SessionLogoff ||
            e.Reason == SessionSwitchReason.RemoteDisconnect || e.Reason == SessionSwitchReason.ConsoleDisconnect)
            sessionEnded = true;
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
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        if (timer != null) timer.Dispose();
        if (browser != null) browser.Dispose();
        api.Clear();
        stop.Dispose();
    }
}

internal sealed class NativeApi
{
    private string token;
    internal bool PreviewEnabled;
    internal NativeApi()
    {
        using (WebClient client = new BoundedWebClient())
        {
            client.Headers["X-LRD-Native"] = "1";
            string json = client.DownloadString(Program.BaseUrl + "/api/host/session");
            var data = new JavaScriptSerializer().DeserializeObject(json) as System.Collections.Generic.Dictionary<string, object>;
            token = (string)data["token"];
            var settings = data["settings"] as System.Collections.Generic.Dictionary<string, object>;
            var preview = settings["preview"] as System.Collections.Generic.Dictionary<string, object>;
            PreviewEnabled = (bool)preview["enabled"];
        }
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
    internal void UploadDesktop()
    {
        try
        {
            Rectangle bounds = Screen.PrimaryScreen.Bounds;
            double scale = Math.Min(1, Math.Min(640.0 / bounds.Width, 360.0 / bounds.Height));
            using (Bitmap screen = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb))
            using (Graphics capture = Graphics.FromImage(screen))
            using (Bitmap small = new Bitmap(Math.Max(1, (int)(bounds.Width * scale)), Math.Max(1, (int)(bounds.Height * scale))))
            using (Graphics resize = Graphics.FromImage(small))
            using (MemoryStream png = new MemoryStream())
            {
                capture.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size, CopyPixelOperation.SourceCopy);
                resize.InterpolationMode = InterpolationMode.HighQualityBicubic;
                resize.DrawImage(screen, new Rectangle(0, 0, small.Width, small.Height));
                small.Save(png, ImageFormat.Png);
                using (WebClient client = new BoundedWebClient())
                {
                    client.Headers["X-LRD-Token"] = token;
                    client.Headers["X-Captured-At"] = DateTime.UtcNow.ToString("o");
                    client.Headers[HttpRequestHeader.ContentType] = "image/png";
                    client.UploadData(Program.BaseUrl + "/api/preview", "POST", png.ToArray());
                }
            }
        }
        catch (Exception ex)
        {
            if (!(ex is ExternalException || ex is WebException || ex is ArgumentException)) throw;
            Clear(); // A protected or unavailable desktop is simply absent.
        }
    }
    internal void Clear()
    {
        if (token == null) return;
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Program.BaseUrl + "/api/preview");
            request.Method = "DELETE";
            request.Headers["X-LRD-Token"] = token;
            request.Timeout = 2000;
            request.Proxy = null;
            using (WebResponse response = request.GetResponse()) { }
        }
        catch (WebException) { }
    }
}

internal sealed class BoundedWebClient : WebClient
{
    protected override WebRequest GetWebRequest(Uri address)
    {
        WebRequest request = base.GetWebRequest(address);
        request.Timeout = 5000;
        request.Proxy = null;
        return request;
    }
}

internal sealed class OwnedBrowser : IDisposable
{
    private IntPtr job;
    internal OwnedBrowser(string executable, string url)
    {
        job = Native.CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        try
        {
            Native.JobLimits limits = new Native.JobLimits();
            limits.BasicLimitInformation.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
            if (!Native.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)))
                throw new System.ComponentModel.Win32Exception();
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LivingRoomDisplay", "edge-profile");
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
                if (Native.ResumeThread(process.hThread) == uint.MaxValue)
                    throw new System.ComponentModel.Win32Exception();
            }
            finally { Native.CloseHandle(process.hThread); Native.CloseHandle(process.hProcess); }
        }
        catch { Dispose(); throw; }
    }
    internal bool IsEmpty
    {
        get
        {
            Native.JobAccounting account;
            return Native.QueryInformationJobObject(job, 1, out account, (uint)Marshal.SizeOf(typeof(Native.JobAccounting)), IntPtr.Zero) && account.ActiveProcesses == 0;
        }
    }
    public void Dispose() { if (job != IntPtr.Zero) { Native.CloseHandle(job); job = IntPtr.Zero; } }
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
