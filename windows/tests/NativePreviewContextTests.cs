using System;
using System.Diagnostics;
using System.Threading;

// Injected facts and clock only: never invoke production desktop/session readers.
internal static class NativePreviewContextTests
{
    private static int assertions;
    private static void Check(bool value,string why) { assertions++; if(!value)throw new Exception(why); }
    private sealed class Clock { internal long Now; }
    private sealed class ProcessProof : IPreviewRetentionProcess
    {
        internal bool Alive=true, Disposed;
        internal readonly ManualResetEvent Released=new ManualResetEvent(false);
        public bool Running { get { return Alive && !Disposed; } }
        public void Dispose() { Disposed=true; Released.Set(); }
    }
    private static NativePreviewContext Context()
    { return new NativePreviewContext { Readable=true, Safe=true, DefaultInput=true, TimeoutSeconds=600, InputTick=100, SessionId=3 }; }
    private static NativePreviewContext Saver()
    { var value=Context(); value.DefaultInput=false; value.SaverInput=true; value.SaverRunning=true; return value; }
    private static void Finished(PreviewRetentionIdentity identity)
    { Check(SpinWait.SpinUntil(()=>!identity.IsDiscovering,2000),"bounded injected worker finishes"); }
    private static PreviewRetentionIdentity Owned(Clock clock,ProcessProof proof)
    {
        var identity=new PreviewRetentionIdentity(session=>new PreviewRetentionDiscovery(PreviewDiscoveryKind.Owned,proof),CancellationToken.None,()=>clock.Now);
        Check(identity.Observe(3,600)==PreviewRetentionState.Pending,"new episode is pending");
        identity.AcknowledgePending(identity.Epoch); Finished(identity);
        Check(identity.Observe(3,600)==PreviewRetentionState.Owned,"completed proof adopts exact pin");
        return identity;
    }
    private static void Main()
    {
        var initial=Context();
        Check(NativePreviewContext.Same(initial,Context()),"unchanged validated context remains eligible");
        var active=Context(); active.InputTick++;
        Check(NativePreviewContext.CaptureCompatible(initial,active),"normal input permits periodic copy");
        Check(!NativePreviewContext.Same(initial,active),"claim publication requires stable input");
        foreach(string change in new string[] { "session","timeout","unsafe","unreadable","saver","ambient" })
        {
            var current=Context();
            if(change=="session")current.SessionId++;
            if(change=="timeout")current.TimeoutSeconds++;
            if(change=="unsafe")current.Safe=false;
            if(change=="unreadable")current.Readable=false;
            if(change=="saver")current.SaverRunning=true;
            if(change=="ambient")current.AmbientRunning=true;
            Check(!NativePreviewContext.CaptureCompatible(initial,current),change+" refuses capture");
        }
        var clock=new Clock(); var proof=new ProcessProof(); int attempts=0;
        using(var identity=new PreviewRetentionIdentity(session=> { attempts++; return attempts==1 ?
            new PreviewRetentionDiscovery(PreviewDiscoveryKind.Empty) : new PreviewRetentionDiscovery(PreviewDiscoveryKind.Owned,proof); },CancellationToken.None,()=>clock.Now))
        {
            var gap=Saver(); gap.SaverRunning=false;
            var pending=NativePreviewContext.Resolve(gap,Saver,identity); long epoch=pending.TransitionEpoch;
            Check(pending.TransitionPending && !pending.Safe && !pending.NativeRetained && attempts==0,"pre-process gap is hidden before any identity read");
            Check(!NativePreviewContext.CaptureCompatible(initial,pending),"pending never authorizes capture");
            identity.AcknowledgePending(epoch+1); Check(attempts==0,"wrong acknowledgement cannot start discovery");
            identity.AcknowledgePending(epoch); Finished(identity);
            Check(identity.Observe(3,600)==PreviewRetentionState.Pending && attempts==1,"successful empty discovery remains pending");
            clock.Now=500; identity.AcknowledgePending(epoch); Finished(identity);
            int rereads=0;
            var retained=NativePreviewContext.Resolve(Saver(),()=> { rereads++; return Saver(); },identity);
            Check(retained.Safe && retained.NativeRetained && retained.TransitionEpoch==epoch && rereads==1 && attempts==2,"later process is adopted only after fresh facts in same epoch");
            Check(!NativePreviewContext.CaptureCompatible(initial,retained),"owned retention never captures");
            clock.Now=10000;
            Check(NativePreviewContext.Resolve(Saver(),Saver,identity).Safe,"owned lifetime does not expire with startup deadline");
            Check(NativePreviewContext.Resolve(Context(),Saver,identity).DefaultInput && proof.Disposed,"ordinary desktop releases owned proof");
            Check(identity.Observe(3,600)==PreviewRetentionState.Pending && identity.Epoch>epoch,"new transition uses a strictly newer epoch");
        }
        proof.Released.Dispose();
        foreach(string change in new string[] { "locked","unknown","session","timeout","other desktop","not running" })
        {
            var localClock=new Clock(); var localProof=new ProcessProof();
            using(var identity=Owned(localClock,localProof))
            {
                var changed=Saver();
                if(change=="locked")changed.Safe=false;
                if(change=="unknown")changed.Readable=false;
                if(change=="session")changed.SessionId++;
                if(change=="timeout")changed.TimeoutSeconds++;
                if(change=="other desktop")changed.SaverInput=false;
                if(change=="not running")changed.SaverRunning=false;
                Check(!NativePreviewContext.Resolve(Saver(),()=>changed,identity).Safe,"fresh "+change+" refuses retention");
                Check(identity.Observe(3,600)==PreviewRetentionState.Failed && localProof.Disposed,"unsafe transition is terminal and releases pin");
            }
            localProof.Released.Dispose();
        }
        foreach(var kind in new[] { PreviewDiscoveryKind.Empty, PreviewDiscoveryKind.NotReady })
        {
            var localClock=new Clock(); int count=0;
            using(var identity=new PreviewRetentionIdentity(session=> { count++; return new PreviewRetentionDiscovery(kind); },CancellationToken.None,()=>localClock.Now))
            {
                identity.Observe(3,600); long epoch=identity.Epoch;
                identity.AcknowledgePending(epoch); Finished(identity);
                Check(identity.Observe(3,600)==PreviewRetentionState.Pending,"successful "+kind+" allows bounded retry");
                localClock.Now=4999;
                Check(identity.Observe(3,600)==PreviewRetentionState.Pending,"pending does not extend original deadline");
                localClock.Now=5000;
                Check(identity.Observe(3,600)==PreviewRetentionState.Failed,"fixed startup deadline expires");
                identity.AcknowledgePending(epoch); Check(count==1,"expired episode cannot query again");
            }
        }
        foreach(bool throws in new[] { false,true })
        {
            using(var identity=new PreviewRetentionIdentity(session=> { if(throws)throw new Exception(); return new PreviewRetentionDiscovery(PreviewDiscoveryKind.Failed); },CancellationToken.None,()=>0))
            {
                identity.Observe(3,600); identity.AcknowledgePending(identity.Epoch); Finished(identity);
                Check(identity.Observe(3,600)==PreviewRetentionState.Failed,"query failure/ambiguity is terminal, not absence");
            }
        }
        const string executable="C:\\fixture\\LivingRoomDisplay.scr", logon="S-1-5-5-42-99";
        Check(NativePreparationIdentity.ExactCommand("\""+executable+"\" /s",executable,null,true),"quoted automatic argv accepted");
        Check(NativePreparationIdentity.ExactCommand(executable+" /S",executable,null,true),"unquoted automatic argv accepted");
        foreach(string command in new[] { executable+" --display",executable+" /s extra","C:\\other\\LivingRoomDisplay.scr /s" })
            Check(!NativePreparationIdentity.ExactCommand(command,executable,null,true),"wrong argv/path refused");
        foreach(string mismatch in new[] { "argv","exited","session","logon","unknown logon" })
            Check(!NativePreparationIdentity.RetentionOwner(mismatch!="argv",mismatch!="exited",3,mismatch=="session"?4:3,
                mismatch=="unknown logon"?null:logon,mismatch=="logon"?"S-1-5-5-42-100":logon),"identity rejects "+mismatch);
        using(var release=new ManualResetEvent(false))
        using(var entered=new ManualResetEvent(false))
        {
            var localClock=new Clock(); var late=new ProcessProof(); int count=0;
            using(var identity=new PreviewRetentionIdentity(session=> { Interlocked.Increment(ref count); entered.Set(); release.WaitOne(); return new PreviewRetentionDiscovery(PreviewDiscoveryKind.Owned,late); },CancellationToken.None,()=>localClock.Now))
            {
                identity.Observe(3,600); long old=identity.Epoch; identity.AcknowledgePending(old);
                Check(entered.WaitOne(1000),"injected blocked provider started");
                localClock.Now=1500;
                Check(identity.Observe(3,600)==PreviewRetentionState.Failed,"blocked query has independent fixed bound");
                identity.Reset(); identity.Observe(3,600); identity.AcknowledgePending(identity.Epoch);
                Check(count==1,"old blocked reader prevents concurrent replacement in new episode");
                release.Set(); Check(late.Released.WaitOne(1000) && late.Disposed,"late proof disposed, never adopted");
                Finished(identity);
                Check(identity.Observe(3,600)!=PreviewRetentionState.Owned,"late old result cannot become new proof");
            }
            late.Released.Dispose();
        }
        using(var cancellation=new CancellationTokenSource())
        using(var release=new ManualResetEvent(false))
        using(var entered=new ManualResetEvent(false))
        {
            var late=new ProcessProof();
            using(var identity=new PreviewRetentionIdentity(session=> { entered.Set(); release.WaitOne(); return new PreviewRetentionDiscovery(PreviewDiscoveryKind.Owned,late); },cancellation.Token,()=>0))
            {
                identity.Observe(3,600); identity.AcknowledgePending(identity.Epoch); Check(entered.WaitOne(1000),"cancel fixture entered");
                cancellation.Cancel(); Check(identity.Observe(3,600)==PreviewRetentionState.Failed,"in-flight cancellation refuses proof");
                release.Set(); Check(late.Released.WaitOne(1000) && late.Disposed,"cancelled late pin disposed"); Finished(identity);
                Check(identity.Observe(3,600)==PreviewRetentionState.Failed,"completion cannot reverse cancellation");
            }
            late.Released.Dispose();
        }
        using(var cancellation=new CancellationTokenSource())
        {
            cancellation.Cancel(); int count=0;
            using(var identity=new PreviewRetentionIdentity(session=> { count++; return new PreviewRetentionDiscovery(PreviewDiscoveryKind.Empty); },cancellation.Token,()=>0))
            { Check(identity.Observe(3,600)==PreviewRetentionState.Failed,"precancel refuses episode"); identity.AcknowledgePending(identity.Epoch); Check(count==0,"precancel starts no reader"); }
        }
        Console.WriteLine("Native preparation context: "+assertions+" assertions passed; injected facts and clocks only.");
    }
}
