using System;
using System.IO;
using System.Threading;

internal static class PreparedClaimFlowTests
{
    private static int assertions;
    private static void Check(bool value,string why) { assertions++; if(!value)throw new Exception(why); }
    private sealed class Peer : IPreparedClaimProcess
    {
        internal bool Owned=true, Alive=true, Disposed, Fail;
        internal int Session=3;
        public bool OwnedAutomatic { get { if(Fail)throw new IOException(); return Owned; } }
        public bool Running { get { return Alive; } }
        public int SessionId { get { return Session; } }
        public DateTime CreatedUtc { get { return new DateTime(2026,1,1,0,1,0,DateTimeKind.Utc); } }
        public void Dispose() { Disposed=true; }
    }
    private static void Main()
    {
        int opened=0; var peer=new Peer();
        Check(PreparedClaimAdmission.Pin(0,3,delegate(uint pid) { opened++; return peer; })==null && opened==0,"missing OS peer never opens client-selected process");
        using(var pinned=PreparedClaimAdmission.Pin(17,3,delegate(uint pid) { Check(pid==17,"OS peer PID forwarded exactly"); return peer; }))
            Check(pinned==peer && !peer.Disposed,"valid peer remains pinned through promotion");
        Check(peer.Disposed,"claim exit releases exact pin");
        peer=new Peer { Owned=false };
        Check(PreparedClaimAdmission.Pin(17,3,delegate(uint pid) { return peer; })==null && peer.Disposed,"foreign/manual process refused and pin disposed");
        peer=new Peer { Alive=false };
        Check(PreparedClaimAdmission.Pin(17,3,delegate(uint pid) { return peer; })==null && peer.Disposed,"exited peer refused");
        peer=new Peer { Session=4 };
        Check(PreparedClaimAdmission.Pin(17,3,delegate(uint pid) { return peer; })==null && peer.Disposed,"other session refused");
        peer=new Peer { Fail=true };
        Check(PreparedClaimAdmission.Pin(17,3,delegate(uint pid) { return peer; })==null && peer.Disposed,"unreadable identity fails closed and releases pin");
        Check(PreparedClaimAdmission.Pin(17,3,delegate(uint pid) { throw new IOException(); })==null,"unopenable OS peer fails closed");

        int captures=0, clears=0, claims=0;
        NativePreviewSelection.Run(false,delegate { claims++; return true; },delegate { captures++; },delegate { clears++; });
        Check(captures==1 && claims==0 && clears==0,"manual capture behavior retained");
        NativePreviewSelection.Run(true,delegate { claims++; return false; },delegate { captures++; },delegate { clears++; });
        Check(captures==1 && claims==1 && clears==1,"automatic absence never falls back to capture");
        NativePreviewSelection.Run(true,delegate { throw new IOException(); },delegate { captures++; },delegate { clears++; });
        Check(captures==1 && clears==2,"automatic transport failure is unavailable without blocking ambient startup");
        bool cancelled=false;
        try { NativePreviewSelection.Run(true,delegate { throw new OperationCanceledException(); },delegate { captures++; },delegate { clears++; }); }
        catch(OperationCanceledException) { cancelled=true; }
        Check(cancelled && captures==1,"physical stop cancellation propagates without recapture");

        int posts=0;
        Func<bool> post=delegate { posts++; return true; };
        Check(!PreparedClaimFlow.Run(delegate { return false; },delegate { return true; },post,CancellationToken.None) && posts==0,"bad context/order never posts");
        Check(!PreparedClaimFlow.Run(delegate { return true; },delegate { return false; },post,CancellationToken.None) && posts==0,"context/identity change before promotion never posts");
        Check(PreparedClaimFlow.Run(delegate { return true; },delegate { return true; },post,CancellationToken.None) && posts==1,"valid pinned peer makes one promotion attempt");
        bool refused=false;
        try { PreparedClaimFlow.Run(delegate { return true; },delegate { return true; },delegate { posts++; throw new IOException(); },CancellationToken.None); }
        catch(IOException) { refused=true; }
        Check(refused && posts==2,"transport failure has no implicit retry");
        using(var cancellation=new CancellationTokenSource())
        {
            int exits=0, cancellations=0; bool pipeDisposed=false;
            var lifetime=new PreparationLifetime(delegate { cancellations++; cancellation.Cancel(); pipeDisposed=true; },delegate { exits++; });
            lifetime.ParentObserved(true); Check(!cancellation.IsCancellationRequested && exits==0,"live pinned parent keeps worker alive");
            lifetime.InputClosed(); lifetime.InputClosed();
            Check(cancellation.IsCancellationRequested && pipeDisposed && cancellations==1,"EOF cancels capture/request and closes pending pipe wait once");
            bool aborted=false;
            try { PreparedClaimFlow.Run(delegate { return true; },delegate { return true; },post,cancellation.Token); }
            catch(OperationCanceledException) { aborted=true; }
            Check(aborted && posts==2,"parent/EOF cancellation cannot publish a late frame");
            lifetime.ParentObserved(false); lifetime.ParentObserved(false);
            Check(exits==1 && cancellations==1,"parent loss exits only this worker without restart");
        }
        var at=new DateTime(2026,1,1,0,0,0,DateTimeKind.Utc);
        Check(!PreparedClaimFlow.Run(delegate { return PreparedSnapshotOrder.Eligible(1000,10000,at,at.AddSeconds(-3),9000,at.AddSeconds(9)); },delegate { return true; },post,CancellationToken.None) && posts==2,
            "delayed Main in a process born before frame cannot promote");
        var timerSource=new CancellationTokenSource();
        PreparationCancellation.Cancel(timerSource);
        Check(timerSource.IsCancellationRequested,"dispatched deadline cancels live capture");
        timerSource.Dispose();
        PreparationCancellation.Cancel(timerSource);
        Check(true,"queued deadline/monitor callback after disposal is safe");
        Console.WriteLine("Prepared claim/lifetime orchestration: "+assertions+" assertions passed; injected peers/transports only.");
    }
}
