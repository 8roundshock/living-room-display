using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

// Scalar-only claim IPC. Pixels remain in the private preparer/backend channel.
internal static class PreparedSnapshotClient
{
    [DllImport("kernel32.dll")] internal static extern ulong GetTickCount64();
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool WaitNamedPipe(string name, uint timeout);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint sharing, IntPtr security, uint disposition, uint flags, IntPtr template);

    internal static bool Claim(string pipeName, long enteredMonotonic, CancellationToken token)
    {
        if (String.IsNullOrEmpty(pipeName) || !System.Text.RegularExpressions.Regex.IsMatch(pipeName, "^LivingRoomDisplay\\.Preview\\.[a-f0-9]{32}$")) return false;
        token.ThrowIfCancellationRequested();
        string path = "\\\\.\\pipe\\" + pipeName;
        if (!WaitNamedPipe(path, 500)) return false;
        // Request only data read/write + synchronize, not FILE_GENERIC_WRITE's create-instance right.
        using (var handle = CreateFile(path, 0x100003, 0, IntPtr.Zero, 3, 0, IntPtr.Zero))
        {
            if (handle.IsInvalid) return false;
            using (var stream = new FileStream(handle, FileAccess.ReadWrite))
            using (var deadline = new Timer(delegate { try { stream.Dispose(); } catch { } }, null, 2000, Timeout.Infinite))
            using (token.Register(delegate { try { stream.Dispose(); } catch { } }))
            {
                var json = new JavaScriptSerializer();
                byte[] request = Encoding.UTF8.GetBytes(json.Serialize(new {
                    enteredMonotonicMs=enteredMonotonic
                }) + "\n");
                stream.Write(request,0,request.Length); stream.Flush();
                string response = ReadLine(stream, 256);
                token.ThrowIfCancellationRequested();
                var parsed = json.DeserializeObject(response) as System.Collections.Generic.Dictionary<string,object>;
                return parsed != null && parsed.ContainsKey("claimed") && parsed["claimed"] is bool && (bool)parsed["claimed"];
            }
        }
    }

    internal static string ReadLine(Stream stream, int limit)
    {
        using (var bytes = new MemoryStream())
        {
            for (int i=0; i<limit; i++)
            {
                int value = stream.ReadByte();
                if (value < 0) throw new EndOfStreamException();
                if (value == 10) return Encoding.UTF8.GetString(bytes.ToArray());
                bytes.WriteByte((byte)value);
            }
            throw new InvalidDataException("Private IPC message exceeds its bound.");
        }
    }
}
