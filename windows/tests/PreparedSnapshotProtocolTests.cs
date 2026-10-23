using System;
using System.IO;
using System.Text;

internal static class PreparedSnapshotProtocolTests
{
    private static void Check(bool value,string why) { if(!value)throw new Exception(why); }
    private static string Read(string text,int limit) { using(var stream=new MemoryStream(Encoding.UTF8.GetBytes(text)))return PreparedSnapshotClient.ReadLine(stream,limit); }
    private static void Main()
    {
        Check(Read("{\"enteredMonotonicMs\":1000}\nignored",256)=="{\"enteredMonotonicMs\":1000}","one bounded scalar claim frame");
        Check(Read("{\"claimed\":false}\n",256)=="{\"claimed\":false}","bounded unavailable response");
        bool refused=false; try { Read(new string('x',257)+"\n",256); } catch(InvalidDataException) { refused=true; }
        Check(refused,"overlong frame fails before unbounded allocation");
        refused=false; try { Read("{\"claimed\":true}",256); } catch(EndOfStreamException) { refused=true; }
        Check(refused,"closed incomplete frame is unavailable");
        refused=false; try { Read("",256); } catch(EndOfStreamException) { refused=true; }
        Check(refused,"empty transport fails closed");
        Console.WriteLine("Prepared snapshot scalar protocol: 5 assertions passed; in-memory streams only.");
    }
}
