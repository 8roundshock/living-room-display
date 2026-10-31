using System;
using System.Diagnostics;
using System.Threading;

// Exercise the actual production context comparison with injected scalar values.
// Never call Read: this fixture has no input/session/desktop or capture access.
internal static class NativePreviewContextTests
{
    private static int assertions;
    private static void Check(bool value,string why) { assertions++; if(!value)throw new Exception(why); }
    private static NativePreviewContext Context()
    {
        return new NativePreviewContext { Readable=true, Safe=true, DefaultInput=true, TimeoutSeconds=600, InputTick=100, SessionId=3 };
    }
    private sealed class ProcessProof : IPreviewRetentionProcess
    {
        internal bool Alive=true, Disposed;
        internal readonly ManualResetEvent Released=new ManualResetEvent(false);
        public bool Running { get { return Alive && !Disposed; } }
        public void Dispose() { Disposed=true; Released.Set(); }
    }
    private static NativePreviewContext Saver()
    { var value=Context(); value.DefaultInput=false; value.SaverInput=true; value.SaverRunning=true; return value; }
    private static void Main()
    {
        var initial=Context();
        Check(NativePreviewContext.Same(initial,Context()),"unchanged validated context remains eligible");
        var active=Context(); active.InputTick++;
        Check(NativePreviewContext.CaptureCompatible(initial,active),"periodic copy permits normal input while context remains safe");
        Check(!NativePreviewContext.Same(initial,active),"claim publication still requires current input stability");
        foreach(string change in new string[] { "session","timeout","unsafe","unreadable","saver","ambient","near deadline" })
        {
            var current=Context();
            if(change=="session")current.SessionId++;
            if(change=="timeout")current.TimeoutSeconds++;
            if(change=="unsafe")current.Safe=false;
            if(change=="unreadable")current.Readable=false;
            if(change=="saver")current.SaverRunning=true;
            if(change=="ambient")current.AmbientRunning=true;
            if(change=="near deadline")current.IdleMilliseconds=570000;
            Check(!NativePreviewContext.CaptureCompatible(initial,current),"periodic copy rejects "+change);
            if(change=="saver" || change=="ambient" || change=="near deadline")
                Check(NativePreviewContext.PrivacyCompatible(initial,current),change+" cancels refresh but preserves the earlier safe cache");
        }
        foreach(string change in new string[] { "timeout","input","session","unreadable","unsafe" })
        {
            var current=Context();
            if(change=="timeout")current.TimeoutSeconds=1200;
            if(change=="input")current.InputTick++;
            if(change=="session")current.SessionId++;
            if(change=="unreadable")current.Readable=false;
            if(change=="unsafe")current.Safe=false;
            Check(!NativePreviewContext.Same(initial,current),change+" change before claim publication fails closed");
        }
        int discoveries=0;
        var proof=new ProcessProof();
        using(var retention=new PreviewRetentionIdentity(session => { discoveries++; return proof; },CancellationToken.None))
        {
            int reads=0;
            var retained=NativePreviewContext.Resolve(Saver(),()=> { reads++; return Saver(); },retention);
            Check(retained.Safe && retained.Readable && reads==1 && discoveries==1,"native retention requires a fresh context after its exact process proof");
            Check(NativePreviewContext.PrivacyCompatible(initial,retained),"validated native display retains an earlier image");
            Check(!NativePreviewContext.CaptureCompatible(initial,retained),"retention is never capture eligibility");
            retained.SaverRunning=false;
            Check(!NativePreviewContext.CaptureCompatible(initial,retained),"non-Default input independently prevents capture even without a saver flag");
            Check(NativePreviewContext.Resolve(Saver(),Saver,retention).Safe && discoveries==1,"pinned live process is reused without repeated identity queries");
            foreach(string change in new string[] { "locked","unknown","session","timeout","other desktop","not running" })
            {
                var changed=Saver();
                if(change=="locked")changed.Safe=false;
                if(change=="unknown")changed.Readable=false;
                if(change=="session")changed.SessionId++;
                if(change=="timeout")changed.TimeoutSeconds++;
                if(change=="other desktop")changed.SaverInput=false;
                if(change=="not running")changed.SaverRunning=false;
                Check(!NativePreviewContext.Resolve(Saver(),()=>changed,retention).Safe,"fresh "+change+" observation refuses retention");
            }
            proof.Alive=false;
            Check(!NativePreviewContext.Resolve(Saver(),Saver,retention).Safe && proof.Disposed,"exited pinned saver immediately loses retention");
            Check(!NativePreviewContext.Resolve(Saver(),Saver,retention).Safe && discoveries==1,"failed episode cannot respawn identity readers");
            Check(NativePreviewContext.Resolve(Context(),()=> { throw new Exception(); },retention).DefaultInput,"return to ordinary desktop needs no native proof");
        }
        using(var absent=new PreviewRetentionIdentity(session => null,CancellationToken.None))
            Check(!NativePreviewContext.Resolve(Saver(),Saver,absent).Safe,"pre-process desktop-switch gap fails closed without a grace period");
        using(var rejected=new PreviewRetentionIdentity(session => { throw new Exception(); },CancellationToken.None))
            Check(!NativePreviewContext.Resolve(Saver(),Saver,rejected).Safe,"unreadable identity fails closed");
        var release=new ManualResetEvent(false); var entered=new ManualResetEvent(false); var late=new ProcessProof(); int attempts=0;
        using(var bounded=new PreviewRetentionIdentity(session => { Interlocked.Increment(ref attempts); entered.Set(); release.WaitOne(); return late; },CancellationToken.None,30))
        {
            var elapsed=Stopwatch.StartNew();
            Check(!bounded.Confirm(3) && elapsed.ElapsedMilliseconds<1000,"blocked discovery has a bounded caller wait");
            Check(entered.WaitOne(1000),"reader entered the injected blocked provider");
            bounded.Reset();
            Check(!bounded.Confirm(3) && attempts==1,"a still-blocked reader prevents even a new episode from spawning another");
            release.Set();
            Check(late.Released.WaitOne(1000) && late.Disposed,"late identity success releases its own pin instead of being adopted");
        }
        release.Dispose(); entered.Dispose(); late.Released.Dispose(); proof.Released.Dispose();
        Console.WriteLine("Native preparation context: "+assertions+" assertions passed; injected scalars only.");
    }
}
