using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// Alternate entry point: real token query and test-owned scalar IPC only. Never
// instantiate NativePreviewPreparer or call its Main, Context.Read or desktop APIs.
internal static class NativePreviewPipeTests
{
    private static int assertions;
    [StructLayout(LayoutKind.Sequential)] private struct SidAndAttributes { internal IntPtr sid; internal uint attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct TokenGroupsOne { internal uint count; internal SidAndAttributes group; }
    private static void Check(bool value,string reason) { assertions++; if(!value)throw new Exception(reason); }
    private static void Refuses(Action run,string reason)
    {
        bool refused=false;
        try { run(); } catch(InvalidDataException) { refused=true; }
        Check(refused,reason);
    }
    private static void Buffers()
    {
        int groupOffset=Marshal.OffsetOf(typeof(TokenGroupsOne),"group").ToInt32();
        int header=groupOffset+Marshal.SizeOf(typeof(SidAndAttributes));
        var sid=new SecurityIdentifier("S-1-5-5-17-23");
        var bytes=new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes,0);
        int length=header+bytes.Length;
        IntPtr buffer=Marshal.AllocHGlobal(length);
        try
        {
            Action reset=delegate {
                Marshal.Copy(new byte[length],0,buffer,length); Marshal.WriteInt32(buffer,1);
                Marshal.StructureToPtr(new SidAndAttributes { sid=IntPtr.Add(buffer,header),attributes=0xc0000007 },IntPtr.Add(buffer,groupOffset),false);
                Marshal.Copy(bytes,0,IntPtr.Add(buffer,header),bytes.Length);
            };
            reset(); Check(NativePreviewLogonSid.Parse(buffer,length)==sid.Value,"aligned bounded logon SID parses");
            Refuses(delegate { NativePreviewLogonSid.Parse(IntPtr.Zero,length); },"null token buffer refused");
            Refuses(delegate { NativePreviewLogonSid.Parse(buffer,header-1); },"short group header refused");
            Marshal.WriteInt32(buffer,0); Refuses(delegate { NativePreviewLogonSid.Parse(buffer,length); },"missing logon group refused");
            Marshal.WriteInt32(buffer,2); Refuses(delegate { NativePreviewLogonSid.Parse(buffer,length); },"multiple logon groups refused");
            foreach(uint attributes in new uint[] { 4,0xc0000000,0xc0000014 })
            {
                reset(); Marshal.WriteInt32(buffer,groupOffset+IntPtr.Size,unchecked((int)attributes));
                Refuses(delegate { NativePreviewLogonSid.Parse(buffer,length); },"non-logon/disabled/deny-only group refused");
            }
            reset(); Marshal.WriteIntPtr(buffer,groupOffset,IntPtr.Zero); Refuses(delegate { NativePreviewLogonSid.Parse(buffer,length); },"null SID refused");
            reset(); Marshal.WriteIntPtr(buffer,groupOffset,IntPtr.Add(buffer,length)); Refuses(delegate { NativePreviewLogonSid.Parse(buffer,length); },"out-of-buffer SID refused");
            reset(); Refuses(delegate { NativePreviewLogonSid.Parse(buffer,length-1); },"truncated SID refused");
            reset(); Marshal.WriteByte(IntPtr.Add(buffer,header),0,2); Refuses(delegate { NativePreviewLogonSid.Parse(buffer,length); },"invalid SID revision refused");
            reset(); Marshal.WriteByte(IntPtr.Add(buffer,header),1,4); Refuses(delegate { NativePreviewLogonSid.Parse(buffer,length); },"unexpected SID shape refused");
            reset(); Marshal.WriteInt32(IntPtr.Add(buffer,header),8,32); Refuses(delegate { NativePreviewLogonSid.Parse(buffer,length); },"ordinary group cannot replace logon SID");
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static void Exchange()
    {
        string name="LivingRoomDisplay.Preview."+Guid.NewGuid().ToString("N");
        using(var deadline=new Timer(delegate { Environment.Exit(2); },null,8000,Timeout.Infinite))
        using(var server=NativePreviewPipe.Create(name))
        {
            bool duplicateRefused=false;
            try { using(var duplicate=NativePreviewPipe.Create(name)) { } } catch(System.ComponentModel.Win32Exception) { duplicateRefused=true; }
            Check(duplicateRefused,"existing exact pipe cannot be replaced");
            Exception failure=null; bool serverPassed=false;
            uint expected=checked((uint)Process.GetCurrentProcess().Id);
            var thread=new Thread(delegate() {
                try
                {
                    server.WaitForConnection();
                    uint peer;
                    if(!NativePreviewPipe.GetNamedPipeClientProcessId(server.SafePipeHandle,out peer) || peer!=expected)throw new Exception("owned peer PID mismatch");
                    var request=new JavaScriptSerializer().DeserializeObject(PreparedSnapshotClient.ReadLine(server,256)) as System.Collections.Generic.Dictionary<string,object>;
                    if(request==null || request.Count!=1 || Convert.ToInt64(request["enteredMonotonicMs"])!=1234567890123L)throw new Exception("scalar framing mismatch");
                    byte[] response=Encoding.UTF8.GetBytes("{\"claimed\":true}\n"); server.Write(response,0,response.Length); server.Flush(); serverPassed=true;
                }
                catch(Exception ex) { failure=ex; }
            });
            thread.IsBackground=true; thread.Start();
            bool claimed=PreparedSnapshotClient.Claim(name,1234567890123L,CancellationToken.None);
            Check(thread.Join(3000),"test-owned pipe thread ends");
            if(failure!=null)throw failure;
            Check(claimed && serverPassed,"production pipe ACL/client rights/peer identity/framing complete real exchange");
        }
    }
    private static int Main()
    {
        try
        {
            Buffers(); Exchange();
            Console.WriteLine("Native preview pipe: "+assertions+" assertions passed; bounded token buffers and test-owned scalar IPC only."); return 0;
        }
        catch(Exception ex) { Console.Error.WriteLine("Native preview pipe: "+ex.GetType().Name+": "+ex.Message); return 1; }
    }
}
