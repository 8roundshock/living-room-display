// Separate non-display process. Never launched by source/test application defaults.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Management;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

internal static class PreviewPreparerProgram
{
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    private static int Main()
    {
        // Deliberately no diagnostics: stdin contains a capability, never command-line arguments.
        try
        {
            PreparationDpi.Run(SetProcessDPIAware,
                delegate { return SetThreadDpiAwarenessContext(new IntPtr(-4)); },
                delegate(IntPtr previous) { SetThreadDpiAwarenessContext(previous); },
                delegate { using (var preparer = new NativePreviewPreparer()) preparer.Run(); });
            return 0;
        }
        catch { return 1; }
    }
}

internal sealed class NativePreviewPreparer : IDisposable
{
    private readonly CancellationTokenSource stop = new CancellationTokenSource();
    private readonly object gate = new object();
    private readonly object publication = new object();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly Process parent;
    private readonly string hostPath, token, baseUrl;
    private readonly string pipeName = null; // Legacy claim code is uninvoked in required shared-snapshot mode.
    private readonly PreviewPreparationPolicy policy = new PreviewPreparationPolicy();
    private readonly PreparationDiagnostics diagnostics = new PreparationDiagnostics();
    private readonly PreparationLifetime lifetime;
    private readonly Timer parentTimer;
    private readonly Thread inputThread;
    private NamedPipeServerStream pipe;
    private bool disposed;

    private sealed class PreparedFrame
    {
        internal long Generation, CompletedMonotonic;
        internal string Configuration;
        internal uint InputTick;
        internal int SessionId, TimeoutSeconds;
        internal DateTime CompletedUtc;
    }
    internal NativePreviewPreparer()
    {
        // Bootstrap is bounded, and a parent which never sends it cannot leave an orphan reader.
        string bootstrap;
        using (var timeout = new Timer(delegate { Environment.Exit(1); }, null, 3000, Timeout.Infinite))
            bootstrap = PreparedSnapshotClient.ReadLine(Console.OpenStandardInput(), 2048);
        var data = json.DeserializeObject(bootstrap) as Dictionary<string,object>;
        if (data == null) throw new InvalidDataException();
        SharedSnapshotMode.Validate(data.ContainsKey("sharedSnapshot") ? data["sharedSnapshot"] : null);
        token = (string)data["token"];
        if (!System.Text.RegularExpressions.Regex.IsMatch(token, "^[a-f0-9]{64}$") ||
            Convert.ToInt32(data["port"]) != 4318)
            throw new InvalidDataException();
        baseUrl = "http://127.0.0.1:4318";
        string windows = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
        string app = Path.GetFullPath(Path.Combine(windows,".."));
        string root = Path.GetFullPath(Path.Combine(app,".."));
        hostPath = Path.Combine(windows,"LivingRoomDisplay.scr");
        string node = Path.Combine(root,"runtime","node.exe");
        string entry = Path.Combine(app,"dist","server","index.js");
        if (!File.Exists(Path.Combine(root,"installation.json"))) throw new InvalidDataException();
        parent = Process.GetProcessById(Convert.ToInt32(data["parentProcessId"]));
        IntPtr pin = parent.Handle;
        lifetime = new PreparationLifetime(Cancel,delegate { Environment.Exit(0); });
        // This child owns no descendants. A pinned parent handle prevents PID reuse from extending life.
        parentTimer = new Timer(delegate {
            try { if (!parent.HasExited) return; } catch { }
            // ExitProcess releases even an in-progress native GDI call and every RAM-only buffer.
            lifetime.ParentObserved(false);
        },null,0,100);
        if (!NativePreviewContext.ExactProcess(parent,node,entry,false)) throw new InvalidDataException();
        inputThread = new Thread(delegate() {
            try { while (Console.ReadLine() != null) { } } catch { }
            lifetime.InputClosed();
        });
        inputThread.IsBackground=true; inputThread.Start();
        // Shared-file publication needs no claim pipe. Automatic and browser
        // renderers both use the backend's existing snapshot reader.
    }

    internal void Run()
    {
        int failures=0;
        while (!stop.IsCancellationRequested)
        {
            try
            {
                var context=NativePreviewContext.Read(hostPath);
                var config=ReadConfiguration(context); failures=0;
                var decision=policy.Observe(config.Reading(new PreparationReading {
                    Readable=context.Readable, Safe=context.Safe,
                    CaptureAllowed=!context.SaverRunning && !context.AmbientRunning,
                    InputTick=context.InputTick, IdleMilliseconds=context.IdleMilliseconds,
                    TimeoutSeconds=context.TimeoutSeconds, SessionId=context.SessionId,
                    MonotonicMilliseconds=checked((long)PreparedSnapshotClient.GetTickCount64())
                }));
                if (decision.Invalidate) { Invalidate(decision.InvalidateActive); config=ReadConfiguration(context); policy.Acknowledge(config.Generation); }
                else if (decision.InvalidateActive) ClearActive();
                if (decision.Capture) Capture(config,context);
            }
            catch (OperationCanceledException) { break; }
            catch
            {
                Invalidate(true);
                policy.ObservationLost();
                if (++failures >= 3) break; // No automatic child restart or capture retry.
            }
            if (stop.Token.WaitHandle.WaitOne(500)) break;
        }
    }
    private PreparationConfiguration ReadConfiguration(NativePreviewContext context)
    {
        PreparedFrame ignored;
        return ReadConfiguration(context,false,out ignored);
    }
    private PreparationConfiguration ReadConfiguration(NativePreviewContext context,bool freeze,out PreparedFrame prepared)
    {
        lock(publication)
        {
        var headers=new Dictionary<string,string> { {"X-Preparation-Safe",context.Readable && context.Safe ? "1" : "0"},
            {"X-Session-Id",context.SessionId.ToString(CultureInfo.InvariantCulture)},
            {"X-Preparation-Capture-Eligible",NativePreviewContext.CaptureCompatible(context,context) ? "1" : "0"} };
        var observed=diagnostics.Snapshot();
        if(observed.Sequence>0)
        {
            headers["X-Preparation-Event"]=observed.Event;
            headers["X-Preparation-Event-Sequence"]=observed.Sequence.ToString(CultureInfo.InvariantCulture);
            headers["X-Preparation-Capture-Attempts"]=observed.CaptureAttempts.ToString(CultureInfo.InvariantCulture);
            headers["X-Preparation-Capture-Failures"]=observed.CaptureFailures.ToString(CultureInfo.InvariantCulture);
        }
        if(freeze)headers["X-Preparation-Freeze"]="1";
        var data=json.DeserializeObject(Request("GET","/api/preview/preparation",null,headers,stop.Token)) as Dictionary<string,object>;
        if (data==null || Convert.ToInt32(data["parentProcessId"])!=parent.Id) throw new InvalidDataException();
        // Shared-file publication has no private frame attestation or claim.
        prepared=null;
        return new PreparationConfiguration { Generation=Convert.ToInt64(data["generation"]), Revision=(string)data["configuration"],
            Enabled=(bool)data["enabled"], CapturePaused=(bool)data["capturePaused"], CaptureRevision=PreparationConfiguration.ReadCaptureRevision(data["captureRevision"]),
            TimeoutSeconds=Convert.ToInt32(data["timeoutSeconds"]), LeadSeconds=Convert.ToInt32(data["prepareLeadSeconds"]) };
        }
    }
    private void Capture(PreparationConfiguration config, NativePreviewContext initial)
    {
        if(!config.Enabled || config.CapturePaused)return;
        diagnostics.CaptureStarted();
        PreparationConfiguration confirmation;
        try { confirmation=ReadConfiguration(initial); }
        catch { diagnostics.CaptureFailed(); throw; }
        // Establish the attempted stage before GDI and reject a pause or upload
        // fence transition. The backend separately fences publication races.
        if(!config.ConfirmsCapture(confirmation)) { diagnostics.CaptureSkipped(); return; }
        byte[] png=null;
        int contextLost=0;
        using (var cancellation=CancellationTokenSource.CreateLinkedTokenSource(stop.Token))
        using (var deadline=new Timer(delegate { PreparationCancellation.Cancel(cancellation); },null,5000,Timeout.Infinite))
        using (var monitor=new Timer(delegate {
            try { var current=NativePreviewContext.Read(hostPath);
                if (!NativePreviewContext.CaptureCompatible(initial,current)) {
                    if(!NativePreviewContext.PrivacyCompatible(initial,current)) Interlocked.Exchange(ref contextLost,1);
                    PreparationCancellation.Cancel(cancellation);
                }
            } catch { Interlocked.Exchange(ref contextLost,1); PreparationCancellation.Cancel(cancellation); }
        },null,0,50))
        {
            try
            {
                cancellation.Token.ThrowIfCancellationRequested();
                DateTime capturedUtc=DateTime.UtcNow;
                Rectangle bounds=System.Windows.Forms.Screen.PrimaryScreen.Bounds;
                png=DesktopSnapshot.Create(bounds.Size,delegate(Bitmap bitmap) {
                    using (Graphics copy=Graphics.FromImage(bitmap)) copy.CopyFromScreen(bounds.Location,Point.Empty,bounds.Size,CopyPixelOperation.SourceCopy);
                },cancellation.Token);
                long completedMonotonic=checked((long)PreparedSnapshotClient.GetTickCount64());
                DateTime completedUtc=DateTime.UtcNow;
                var after=NativePreviewContext.Read(hostPath);
                if (!NativePreviewContext.CaptureCompatible(initial,after)) { diagnostics.CaptureSkipped(); if(!NativePreviewContext.PrivacyCompatible(initial,after)) Invalidate(true); return; }
                cancellation.Token.ThrowIfCancellationRequested();
                var headers=new Dictionary<string,string> {
                    {"X-Preparation-Generation",config.Generation.ToString(CultureInfo.InvariantCulture)},
                    {"X-Preparation-Capture-Revision",config.CaptureRevision.ToString(CultureInfo.InvariantCulture)},
                    {"X-Preparation-Configuration",config.Revision}, {"X-Input-Tick",initial.InputTick.ToString(CultureInfo.InvariantCulture)},
                    {"X-Session-Id",initial.SessionId.ToString(CultureInfo.InvariantCulture)}, {"X-Desktop-Id","Default"},
                    {"X-Captured-At",capturedUtc.ToString("o")}, {"X-Completed-At",completedUtc.ToString("o")},
                    {"X-Completed-Monotonic-Ms",completedMonotonic.ToString(CultureInfo.InvariantCulture)},
                    {"X-Idle-Timeout-Seconds",initial.TimeoutSeconds.ToString(CultureInfo.InvariantCulture)}
                };
                // Only the backend writes the canonical file. A lost upload
                // acknowledgment never makes the native host publish a replacement.
                lock(publication)
                {
                    Request("POST","/api/preview/preparation",png,headers,cancellation.Token);
                    diagnostics.CaptureUploaded();
                }
                if(Interlocked.CompareExchange(ref contextLost,0,0)!=0 || stop.IsCancellationRequested) Invalidate(true);
            }
            // A failed eligible refresh leaves the last success intact. Context
            // loss still invalidates immediately, including an in-flight upload.
            catch(Exception failure)
            {
                var web=failure as WebException;
                var response=web==null ? null : web.Response as HttpWebResponse;
                bool contextChanged=Interlocked.CompareExchange(ref contextLost,0,0)!=0;
                bool skipped=(response!=null && response.StatusCode==HttpStatusCode.Conflict) ||
                    (failure is OperationCanceledException && (contextChanged || stop.IsCancellationRequested));
                if(skipped)diagnostics.CaptureSkipped(); else diagnostics.CaptureFailed();
                if(contextChanged || stop.IsCancellationRequested)Invalidate(true);
            }
            finally { if(png!=null) Array.Clear(png,0,png.Length); }
        }
    }
    private void ClearActive()
    {
        try { Request("DELETE","/api/preview/preparation",null,new Dictionary<string,string>{{"X-Invalidate-Active-Only","1"}},stop.Token); } catch { }
    }
    private void Invalidate(bool active)
    {
        try { Request("DELETE","/api/preview/preparation",null, active ? new Dictionary<string,string>{{"X-Invalidate-Active","1"}} : null, stop.Token); } catch { }
    }
    private string Request(string method,string path,byte[] body,Dictionary<string,string> headers,CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var request=(HttpWebRequest)WebRequest.Create(baseUrl+path);
        request.Method=method; request.Proxy=null; request.AllowAutoRedirect=false; request.Timeout=1500; request.ReadWriteTimeout=1500;
        request.Headers["X-LRD-Preparation"]=token;
        if(headers!=null) foreach(var pair in headers) request.Headers[pair.Key]=pair.Value;
        if(body!=null) { request.ContentType=path.EndsWith("/claim")?"application/json":"image/png"; request.ContentLength=body.Length; }
        using(cancellation.Register(delegate { request.Abort(); }))
        {
            if(body!=null) using(var output=request.GetRequestStream()) output.Write(body,0,body.Length);
            using(var response=request.GetResponse())
            using(var reader=new StreamReader(response.GetResponseStream())) { string result=reader.ReadToEnd(); if(result.Length>4096) throw new InvalidDataException(); return result; }
        }
    }
    private void ServeClaims()
    {
        try
        {
            while(!stop.IsCancellationRequested)
            {
                using(var server=NativePreviewPipe.Create(pipeName))
                {
                    lock(gate) { if(disposed)return; pipe=server; }
                    server.WaitForConnection();
                    using(var deadline=new Timer(delegate { try { server.Dispose(); } catch { } },null,2000,Timeout.Infinite))
                    {
                        bool claimed=false;
                        try { claimed=Claim(server); } catch { }
                        byte[] response=Encoding.UTF8.GetBytes(claimed ? "{\"claimed\":true}\n" : "{\"claimed\":false}\n");
                        try { server.Write(response,0,response.Length); server.Flush(); } catch { }
                    }
                    lock(gate) pipe=null;
                }
            }
        }
        catch { Cancel(); } // Preexisting instance/ACL/identity failures never start a different pipe.
    }
    private bool Claim(NamedPipeServerStream server)
    {
        uint processId;
        if(!NativePreviewPipe.GetNamedPipeClientProcessId(server.SafePipeHandle,out processId) || processId==0) return false;
        var data=json.DeserializeObject(PreparedSnapshotClient.ReadLine(server,256)) as Dictionary<string,object>;
        if(data==null || data.Count!=1) return false;
        long entered=Convert.ToInt64(data["enteredMonotonicMs"]);
        var context=NativePreviewContext.Read(hostPath);
        if(!context.Readable || !context.Safe)return false;
        using(var claimant=PreparedClaimAdmission.Pin(processId,context.SessionId,delegate(uint pid) { return new NativePreparedClaimProcess(pid,hostPath); }))
        {
            if(claimant==null)return false;
            DateTime created=claimant.CreatedUtc;
            lock(publication)
            {
            PreparedFrame prepared;
            var latest=ReadConfiguration(context,true,out prepared);
            return PreparedClaimFlow.Run(delegate { return !(prepared==null || !context.Readable || !context.Safe ||
                !latest.Enabled || prepared.Generation!=latest.Generation || prepared.Configuration!=latest.Revision ||
                context.SessionId!=prepared.SessionId || context.TimeoutSeconds!=prepared.TimeoutSeconds || claimant.SessionId!=prepared.SessionId ||
                !PreparedSnapshotOrder.Eligible(prepared.CompletedMonotonic,entered,prepared.CompletedUtc,created,
                    checked((long)PreparedSnapshotClient.GetTickCount64())-prepared.CompletedMonotonic,DateTime.UtcNow)); },delegate {
            // Pin and recheck immediately before the secret-authenticated atomic promotion.
            return claimant.Running && claimant.CreatedUtc==created &&
                NativePreviewContext.Same(context,NativePreviewContext.Read(hostPath)); },delegate {
            byte[] body=Encoding.UTF8.GetBytes(json.Serialize(new {
                generation=prepared.Generation, configuration=prepared.Configuration, processId=processId,
                processStartedAt=created.ToString("o"), startedMonotonicMs=entered, inputTick=prepared.InputTick,
                sessionId=prepared.SessionId, desktopId="Default", completedMonotonicMs=prepared.CompletedMonotonic
            }));
            var response=json.DeserializeObject(Request("POST","/api/preview/preparation/claim",body,null,stop.Token)) as Dictionary<string,object>;
            return response!=null && response.ContainsKey("claimed") && response["claimed"] is bool && (bool)response["claimed"];
            },stop.Token);
            }
        }
    }
    private void Cancel() { try { stop.Cancel(); } catch { } lock(gate) { if(pipe!=null)try { pipe.Dispose(); } catch { } } }
    public void Dispose()
    {
        lock(gate) { if(disposed)return; disposed=true; }
        Cancel(); parentTimer.Dispose(); parent.Dispose();
        // Background readers hold no persisted state; parent closes inherited stdin on normal stop.
    }
}

internal sealed class NativePreparedClaimProcess : IPreparedClaimProcess
{
    private readonly Process process;
    private readonly string executable;
    internal NativePreparedClaimProcess(uint pid,string executable)
    {
        this.executable=executable;
        process=Process.GetProcessById(checked((int)pid));
        try { IntPtr pin=process.Handle; } catch { process.Dispose(); throw; }
    }
    public bool OwnedAutomatic { get { return NativePreviewContext.ExactProcess(process,executable,null,true); } }
    public bool Running { get { return !process.HasExited; } }
    public int SessionId { get { return process.SessionId; } }
    public DateTime CreatedUtc { get { return process.StartTime.ToUniversalTime(); } }
    public void Dispose() { process.Dispose(); }
}

internal sealed class NativePreviewContext
{
    internal bool Readable, Safe, SaverRunning, AmbientRunning;
    internal uint InputTick;
    internal int SessionId, TimeoutSeconds;
    internal long IdleMilliseconds;
    [StructLayout(LayoutKind.Sequential)] private struct LastInput { internal uint cbSize,tick; }
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInput input);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] private static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("user32.dll")] private static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("user32.dll")] private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool GetUserObjectInformation(IntPtr handle,int index,StringBuilder value,uint size,out uint needed);
    [DllImport("user32.dll",EntryPoint="GetUserObjectInformationW",SetLastError=true)] private static extern bool GetUserObjectFlag(IntPtr handle,int index,out int value,uint size,out uint needed);
    [DllImport("user32.dll",SetLastError=true)] private static extern bool SystemParametersInfo(uint action,uint parameter,out int value,uint flags);
    [DllImport("wtsapi32.dll",SetLastError=true)] private static extern bool WTSQuerySessionInformation(IntPtr server,int session,int info,out IntPtr value,out int bytes);
    [DllImport("wtsapi32.dll")] private static extern void WTSFreeMemory(IntPtr value);
    private static string ObjectName(IntPtr handle)
    {
        uint needed; var text=new StringBuilder(256);
        return handle!=IntPtr.Zero && GetUserObjectInformation(handle,2,text,512,out needed)?text.ToString():null;
    }
    private static bool AmbientPresent()
    {
        // Observe the existing own-session mutex only; never hold it across capture/claim.
        try
        {
            using(var mutex=Mutex.OpenExisting("Local\\LivingRoomDisplay.Ambient"))
            {
                bool acquired=false;
                try { acquired=mutex.WaitOne(0); return !acquired; }
                catch(AbandonedMutexException) { acquired=true; return true; }
                finally { if(acquired)mutex.ReleaseMutex(); }
            }
        }
        catch(WaitHandleCannotBeOpenedException) { return false; }
    }
    internal static NativePreviewContext Read(string hostPath)
    {
        var result=new NativePreviewContext();
        try
        {
            var input=new LastInput { cbSize=(uint)Marshal.SizeOf(typeof(LastInput)) };
            if(!GetLastInputInfo(ref input)) return result;
            result.InputTick=input.tick; result.SessionId=Process.GetCurrentProcess().SessionId;
            result.IdleMilliseconds=unchecked((uint)(PreparedSnapshotClient.GetTickCount64()-input.tick));
            IntPtr desktop=GetThreadDesktop(GetCurrentThreadId()); uint needed; int receiving;
            if(ObjectName(GetProcessWindowStation())!="WinSta0" || ObjectName(desktop)!="Default" ||
                !GetUserObjectFlag(desktop,6,out receiving,4,out needed) || receiving!=1 ||
                WTSGetActiveConsoleSessionId()!=(uint)result.SessionId) return result;
            IntPtr state; int bytes;
            if(!WTSQuerySessionInformation(IntPtr.Zero,result.SessionId,25,out state,out bytes))return result;
            try
            {
                // WTSINFOEX level1: DWORD level, 8-byte aligned union, session/state/flags.
                if(bytes<20 || Marshal.ReadInt32(state)!=1 || Marshal.ReadInt32(state,8)!=result.SessionId ||
                    Marshal.ReadInt32(state,12)!=0 || Marshal.ReadInt32(state,16)!=1)return result;
            }
            finally { WTSFreeMemory(state); }
            int active,running,timeout;
            if(!SystemParametersInfo(16,0,out active,0) || !SystemParametersInfo(14,0,out timeout,0) ||
                !SystemParametersInfo(114,0,out running,0))return result;
            using(var key=Registry.CurrentUser.OpenSubKey("Control Panel\\Desktop",false))
            {
                var selected=key==null?null:key.GetValue("SCRNSAVE.EXE") as string;
                if(active!=1 || selected==null || !String.Equals(Path.GetFullPath(selected.Trim('"')),Path.GetFullPath(hostPath),StringComparison.OrdinalIgnoreCase))return result;
            }
            result.TimeoutSeconds=timeout; result.SaverRunning=running!=0; result.AmbientRunning=AmbientPresent(); result.Readable=true; result.Safe=true;
        }
        catch { }
        return result;
    }
    internal static bool Same(NativePreviewContext first,NativePreviewContext second)
    { return second.Readable && second.Safe && first.InputTick==second.InputTick && first.SessionId==second.SessionId && first.TimeoutSeconds==second.TimeoutSeconds; }
    internal static bool CaptureCompatible(NativePreviewContext first,NativePreviewContext second)
    { return PrivacyCompatible(first,second) && !second.SaverRunning && !second.AmbientRunning &&
        PreviewPreparationPolicy.OutsideTransition(second.IdleMilliseconds,second.TimeoutSeconds,30); }
    internal static bool PrivacyCompatible(NativePreviewContext first,NativePreviewContext second)
    { return second.Readable && second.Safe && first.SessionId==second.SessionId && first.TimeoutSeconds==second.TimeoutSeconds; }
    internal static bool ExactProcess(Process process,string executable,string entry,bool ambient)
    {
        try
        {
            if(process.HasExited || !String.Equals(process.MainModule.FileName,executable,StringComparison.OrdinalIgnoreCase))return false;
            using(var query=new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE ProcessId="+process.Id.ToString(CultureInfo.InvariantCulture)))
            {
            query.Options.Timeout=TimeSpan.FromMilliseconds(1000);
            using(var matches=query.Get())
            {
                foreach(ManagementObject item in matches)
                using(item)
                {
                    string command=item["CommandLine"] as string;
                    if(command==null)return false;
                    return !process.HasExited && NativePreparationIdentity.ExactCommand(command,executable,entry,ambient);
                }
            }
            }
        }
        catch { }
        return false;
    }
}

internal static class NativePreviewPipe
{
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { internal int length; internal IntPtr descriptor; internal int inherit; }
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,uint revision,out IntPtr descriptor,out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafePipeHandle CreateNamedPipe(string name,uint mode,uint type,uint instances,uint output,uint input,uint timeout,ref SecurityAttributes security);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe,out uint pid);
    internal static NamedPipeServerStream Create(string name)
    {
        string logon=NativePreviewLogonSid.Read();
        IntPtr descriptor; uint bytes;
        // The production client exchange fails without read-attributes on Windows.
        // Keep the exact logon principal; never grant create-instance/generic write.
        if(!ConvertStringSecurityDescriptorToSecurityDescriptor("D:P(A;;0x00100083;;;"+logon+")",1,out descriptor,out bytes))throw new System.ComponentModel.Win32Exception();
        try
        {
            var security=new SecurityAttributes { length=Marshal.SizeOf(typeof(SecurityAttributes)),descriptor=descriptor,inherit=0 };
            // First-instance refusal, overlapped duplex, byte mode, local clients only.
            var handle=CreateNamedPipe("\\\\.\\pipe\\"+name,0x40080003,8,1,1024,1024,2000,ref security);
            if(handle.IsInvalid) { handle.Dispose(); throw new System.ComponentModel.Win32Exception(); }
            return new NamedPipeServerStream(PipeDirection.InOut,true,false,handle);
        }
        finally { LocalFree(descriptor); }
    }
}

internal static class NativePreviewLogonSid
{
    [StructLayout(LayoutKind.Sequential)] private struct SidAndAttributes { internal IntPtr sid; internal uint attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct TokenGroupsOne { internal uint count; internal SidAndAttributes group; }
    [DllImport("advapi32.dll",SetLastError=true)] private static extern bool GetTokenInformation(IntPtr token,int information,IntPtr buffer,uint length,out uint needed);

    internal static string Read()
    {
        // WindowsIdentity.Groups deliberately filters out SE_GROUP_LOGON_ID.
        // Query this token's dedicated TokenLogonSid result, never a user-SID fallback.
        using(var identity=WindowsIdentity.GetCurrent(TokenAccessLevels.Query))
        {
            uint needed;
            if(GetTokenInformation(identity.Token,28,IntPtr.Zero,0,out needed) || Marshal.GetLastWin32Error()!=122 || needed<8 || needed>4096)
                throw new InvalidDataException("Logon SID size is unavailable.");
            IntPtr buffer=Marshal.AllocHGlobal(checked((int)needed));
            try
            {
                uint returned;
                if(!GetTokenInformation(identity.Token,28,buffer,needed,out returned))throw new System.ComponentModel.Win32Exception();
                if(returned>needed)throw new InvalidDataException("Logon SID size changed.");
                return Parse(buffer,checked((int)returned));
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
    }

    // Shared with bounded synthetic buffers, including x86/x64 pointer alignment.
    internal static string Parse(IntPtr buffer,int length)
    {
        int groupOffset=Marshal.OffsetOf(typeof(TokenGroupsOne),"group").ToInt32();
        if(buffer==IntPtr.Zero || length<groupOffset+Marshal.SizeOf(typeof(SidAndAttributes)) || Marshal.ReadInt32(buffer)!=1)
            throw new InvalidDataException("Exactly one logon SID is required.");
        var group=(SidAndAttributes)Marshal.PtrToStructure(IntPtr.Add(buffer,groupOffset),typeof(SidAndAttributes));
        if((group.attributes&0xc0000004)!=0xc0000004 || (group.attributes&0x10)!=0 || group.sid==IntPtr.Zero)
            throw new InvalidDataException("An enabled logon SID is required.");
        long offset=group.sid.ToInt64()-buffer.ToInt64();
        if(offset<groupOffset+Marshal.SizeOf(typeof(SidAndAttributes)) || offset>length-8 || Marshal.ReadByte(group.sid)!=1 || Marshal.ReadByte(group.sid,1)!=3)
            throw new InvalidDataException("Logon SID is outside its token buffer.");
        const int sidLength=20; // SID header plus the three S-1-5-5-X-Y subauthorities.
        if(offset>length-sidLength)throw new InvalidDataException("Logon SID is truncated.");
        var bytes=new byte[sidLength]; Marshal.Copy(group.sid,bytes,0,bytes.Length);
        var sid=new SecurityIdentifier(bytes,0);
        if(!sid.Value.StartsWith("S-1-5-5-",StringComparison.Ordinal))throw new InvalidDataException("Token SID is not a logon SID.");
        return sid.Value;
    }
}
