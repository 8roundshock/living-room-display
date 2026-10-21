// Independent fullscreen input surface and exact job-owned Edge. No global cursor/input state.
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal sealed class AmbientInputSurface : Form {
    internal const string LoadingTitle="[LRD] Native cursor surface loading";
    internal const string ReadyTitle="[LRD] Native cursor surface ready";
    private readonly Func<IntPtr,ForegroundKind> classify;
    private readonly Action<string> stop;
    private readonly Action<IntPtr> deactivated;
    private bool shown;
    internal AmbientInputSurface(Func<IntPtr,ForegroundKind> classify,Action<string> stop,Action<IntPtr> deactivated) {
        this.classify=classify; this.stop=stop; this.deactivated=deactivated;
        Text=LoadingTitle; FormBorderStyle=FormBorderStyle.None; ShowInTaskbar=false; TopMost=true;
        AutoScaleMode=AutoScaleMode.None; StartPosition=FormStartPosition.Manual; Bounds=Screen.PrimaryScreen.Bounds; BackColor=Color.Black;
        KeyPreview=true; KeyDown+=delegate(object sender,KeyEventArgs e) { if(e.KeyCode==Keys.Escape) stop("escape"); };
    }
    protected override CreateParams CreateParams {
        get { var value=base.CreateParams; value.ExStyle|=0x80000; return value; } // LAYERED, never TRANSPARENT/colorkey.
    }
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        if(!DisplayNative.SetLayeredWindowAttributes(Handle,0,255,2)) throw new System.ComponentModel.Win32Exception();
    }
    private bool OwnCursorClient() {
        var cursor=DisplayNative.Cursor();
        var foreground=classify(DisplayNative.GetForegroundWindow());
        return cursor.success && (foreground==ForegroundKind.Surface || foreground==ForegroundKind.OwnedEdge) && DisplayNative.HitSurface(Handle,cursor.point);
    }
    protected override void OnShown(EventArgs e) {
        base.OnShown(e); shown=true;
        // Initial establishment only, on this queue and actual own client. The
        // subsequent poll verifies NULL before permitting browser launch.
        if(classify(DisplayNative.GetForegroundWindow())==ForegroundKind.Surface && OwnCursorClient()) DisplayNative.SetCursor(IntPtr.Zero);
    }
    protected override void WndProc(ref Message message) {
        try {
        if(message.Msg==0x20 && (message.LParam.ToInt64()&0xffff)==1 && OwnCursorClient()) {
            DisplayNative.SetCursor(IntPtr.Zero); message.Result=new IntPtr(1); return;
        }
        if(shown && message.Msg==6 && (message.WParam.ToInt64()&0xffff)==0) {
            deactivated(message.LParam);
        }
        base.WndProc(ref message);
        } catch { stop("ui-error"); message.Result=IntPtr.Zero; }
    }
}

internal sealed class OwnedBrowser : IAmbientBrowser {
    private readonly object gate=new object();
    private IntPtr job;
    private bool disposed;
    internal volatile bool Failed;
    internal OwnedBrowser() {
        job=Native.CreateJobObject(IntPtr.Zero,null);
        if(job==IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        var limits=new Native.JobLimits(); limits.BasicLimitInformation.LimitFlags=0x2000;
        if(!Native.SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits))) { Dispose(); throw new System.ComponentModel.Win32Exception(); }
    }
    internal void Launch(string edge,string url,CancellationToken token) {
        ThreadPool.QueueUserWorkItem(delegate {
            IntPtr lease=IntPtr.Zero,attributes=IntPtr.Zero,jobs=IntPtr.Zero;
            bool attributesInitialized=false;
            Native.ProcessInformation process=new Native.ProcessInformation();
            try {
                lock(gate) {
                    token.ThrowIfCancellationRequested(); if(disposed) return;
                    if(!DisplayNative.DuplicateHandle(DisplayNative.GetCurrentProcess(),job,DisplayNative.GetCurrentProcess(),out lease,0,false,2)) throw new System.ComponentModel.Win32Exception();
                }
                // Atomic job-list assignment at process creation avoids a late
                // unassigned suspended child if cancellation/helper exit races IO.
                IntPtr bytes=IntPtr.Zero; DisplayNative.InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref bytes);
                attributes=Marshal.AllocHGlobal(bytes);
                if(!DisplayNative.InitializeProcThreadAttributeList(attributes,1,0,ref bytes)) throw new System.ComponentModel.Win32Exception();
                attributesInitialized=true;
                jobs=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs,lease);
                if(!DisplayNative.UpdateProcThreadAttribute(attributes,0,new IntPtr(0x2000d),jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();
                var info=new DisplayNative.StartupEx(); info.info.cb=Marshal.SizeOf(info); info.attributes=attributes;
                string profile=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"..","..","edge-profile"));
                string command=Native.Quote(edge)+" --kiosk "+Native.Quote(url)+" --edge-kiosk-type=fullscreen --no-first-run --no-default-browser-check --disable-background-mode --inprivate --user-data-dir="+Native.Quote(profile);
                token.ThrowIfCancellationRequested();
                if(!DisplayNative.CreateProcess(edge,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,0x80004,IntPtr.Zero,null,ref info,out process)) throw new System.ComponentModel.Win32Exception();
                lock(gate) {
                    if(disposed || token.IsCancellationRequested) { Native.TerminateProcess(process.hProcess,1); return; }
                    if(Native.ResumeThread(process.hThread)==uint.MaxValue) throw new System.ComponentModel.Win32Exception();
                }
            } catch { Failed=true; if(process.hProcess!=IntPtr.Zero) Native.TerminateProcess(process.hProcess,1); }
            finally {
                if(process.hThread!=IntPtr.Zero) Native.CloseHandle(process.hThread);
                if(process.hProcess!=IntPtr.Zero) Native.CloseHandle(process.hProcess);
                if(attributes!=IntPtr.Zero) { if(attributesInitialized) DisplayNative.DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); }
                if(jobs!=IntPtr.Zero) Marshal.FreeHGlobal(jobs);
                if(lease!=IntPtr.Zero) Native.CloseHandle(lease);
            }
        });
    }
    internal bool OwnsWindow(IntPtr window) {
        IntPtr process=PinWindow(window); if(process==IntPtr.Zero) return false;
        Native.CloseHandle(process); return true;
    }
    private IntPtr PinWindow(IntPtr window) {
        uint pid; DisplayNative.GetWindowThreadProcessId(window,out pid);
        if(pid==0) return IntPtr.Zero;
        IntPtr process=DisplayNative.OpenProcess(0x101000,false,pid); if(process==IntPtr.Zero) return IntPtr.Zero;
        lock(gate) {
            bool owns; uint after; DisplayNative.GetWindowThreadProcessId(window,out after);
            if(!disposed && after==pid && DisplayNative.IsProcessInJob(process,job,out owns) && owns && DisplayNative.WaitForSingleObject(process,0)==258) return process;
        }
        Native.CloseHandle(process); return IntPtr.Zero;
    }
    internal IntPtr ReadyWindow() {
        IntPtr ready=IntPtr.Zero;
        DisplayNative.EnumWindows(delegate(IntPtr window,IntPtr unused) {
            if(!DisplayNative.IsWindowVisible(window)) return true;
            IntPtr pin=PinWindow(window); if(pin==IntPtr.Zero) return true;
            try {
            var text=new StringBuilder(256); DisplayNative.GetWindowText(window,text,text.Capacity);
            var name=new StringBuilder(128); DisplayNative.GetClassName(window,name,name.Capacity);
            string title=text.ToString().Replace("Microsoft\u200b Edge","Microsoft Edge");
            if(name.ToString()=="Chrome_WidgetWin_1" && (title=="Still \u00b7 Display - [InPrivate] - Microsoft Edge" || title=="Still \u00b7 Display - Microsoft Edge")) {
                if(DisplayNative.Client(window)==Screen.PrimaryScreen.Bounds && DisplayNative.WaitForSingleObject(pin,0)==258 && OwnsWindow(window)) { ready=window; return false; }
            }
            return true;
            } finally { Native.CloseHandle(pin); }
        },IntPtr.Zero);
        return ready;
    }
    public bool IsEmpty {
        get { lock(gate) {
            Native.JobAccounting account;
            return disposed || Native.QueryInformationJobObject(job,1,out account,(uint)Marshal.SizeOf(typeof(Native.JobAccounting)),IntPtr.Zero) && account.ActiveProcesses==0;
        } }
    }
    public void Dispose() {
        lock(gate) { if(disposed) return; disposed=true; if(job!=IntPtr.Zero) { DisplayNative.TerminateJobObject(job,0); Native.CloseHandle(job); job=IntPtr.Zero; } }
    }
}

internal static class DisplayNative {
    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] internal struct Info { internal uint size,flags; internal IntPtr cursor; internal Point point; internal bool success; }
    [StructLayout(LayoutKind.Sequential)] private struct CursorInfo { internal uint size,flags; internal IntPtr cursor; internal Point point; }
    [StructLayout(LayoutKind.Sequential)] internal struct StartupEx { internal Native.StartupInfo info; internal IntPtr attributes; }
    internal static Info Cursor() { var raw=new CursorInfo(); raw.size=(uint)Marshal.SizeOf(raw); bool ok=GetCursorInfo(ref raw); return new Info { success=ok,flags=raw.flags,cursor=raw.cursor,point=raw.point }; }
    internal static bool HitSurface(IntPtr window,Point point) { return GetAncestor(WindowFromPoint(point),2)==window; }
    internal static Rectangle Client(IntPtr window) {
        Native.Rect rect; if(!Native.GetClientRect(window,out rect)) return Rectangle.Empty;
        var first=new Point { X=rect.Left,Y=rect.Top };var last=new Point { X=rect.Right,Y=rect.Bottom };
        if(!ClientToScreen(window,ref first) || !ClientToScreen(window,ref last)) return Rectangle.Empty;
        return Rectangle.FromLTRB(first.X,first.Y,last.X,last.Y);
    }
    internal delegate bool Callback(IntPtr window,IntPtr unused);
    [DllImport("user32.dll")] internal static extern bool EnumWindows(Callback callback,IntPtr unused);
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr window,int show);
    [DllImport("user32.dll")] internal static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] internal static extern IntPtr GetAncestor(IntPtr window,uint flags);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr window,ref Point point);
    [DllImport("user32.dll",SetLastError=true)] internal static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
    [DllImport("user32.dll")] private static extern bool GetCursorInfo(ref CursorInfo info);
    [DllImport("user32.dll")] internal static extern IntPtr SetCursor(IntPtr cursor);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] internal static extern int GetWindowText(IntPtr window,StringBuilder text,int length);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] internal static extern int GetClassName(IntPtr window,StringBuilder text,int length);
    [DllImport("user32.dll",SetLastError=true)] internal static extern bool SetLayeredWindowAttributes(IntPtr window,uint color,byte alpha,uint flags);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern IntPtr OpenProcess(uint access,bool inherit,uint process);
    [DllImport("kernel32.dll")] internal static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool TerminateJobObject(IntPtr job,uint code);
    [DllImport("kernel32.dll")] internal static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool DuplicateHandle(IntPtr source,IntPtr handle,IntPtr target,out IntPtr copy,uint access,bool inherit,uint options);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr bytes);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr bytes,IntPtr previous,IntPtr result);
    [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref StartupEx startup,out Native.ProcessInformation process);
}
