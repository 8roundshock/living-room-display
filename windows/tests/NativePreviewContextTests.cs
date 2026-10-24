using System;

// Exercise the actual production context comparison with injected scalar values.
// Never call Read: this fixture has no input/session/desktop or capture access.
internal static class NativePreviewContextTests
{
    private static int assertions;
    private static void Check(bool value,string why) { assertions++; if(!value)throw new Exception(why); }
    private static NativePreviewContext Context()
    {
        return new NativePreviewContext { Readable=true, Safe=true, TimeoutSeconds=600, InputTick=100, SessionId=3 };
    }
    private static void Main()
    {
        var initial=Context();
        Check(NativePreviewContext.Same(initial,Context()),"unchanged validated context remains eligible");
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
        Console.WriteLine("Native preparation context: "+assertions+" assertions passed; injected scalars only.");
    }
}
