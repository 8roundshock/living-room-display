using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

// Synthetic GDI-style BGRx bytes only: no desktop, window, transport or saved image.
internal static class DesktopSnapshotTests
{
    private static readonly Color[] Colors = { Color.Black, Color.Red, Color.Lime, Color.Blue, Color.FromArgb(128, 128, 128) };
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void CopySynthetic(Bitmap target)
    {
        BitmapData data = target.LockBits(new Rectangle(0, 0, target.Width, target.Height), ImageLockMode.WriteOnly, target.PixelFormat);
        try
        {
            byte[] row = new byte[Math.Abs(data.Stride)];
            for (int x = 0; x < target.Width; x++)
            {
                Color color = Colors[Math.Min(Colors.Length - 1, x * Colors.Length / target.Width)];
                row[x * 4] = color.B; row[x * 4 + 1] = color.G; row[x * 4 + 2] = color.R;
                row[x * 4 + 3] = 0; // GDI color bytes do not imply meaningful alpha.
            }
            for (int y = 0; y < target.Height; y++) Marshal.Copy(row, 0, IntPtr.Add(data.Scan0, y * data.Stride), row.Length);
        }
        finally { target.UnlockBits(data); }
    }
    private static void Encoding(Size source, Size expected)
    {
        byte[] png = DesktopSnapshot.Create(source, CopySynthetic, CancellationToken.None);
        using (MemoryStream stream = new MemoryStream(png))
        using (Bitmap decoded = new Bitmap(stream))
        {
            Check(decoded.Size == expected, "Thumbnail scaling changed.");
            for (int i = 0; i < Colors.Length; i++)
            {
                Color actual = decoded.GetPixel((2 * i + 1) * decoded.Width / (2 * Colors.Length), decoded.Height / 2);
                Color expectedColor = Colors[i];
                Check(actual.A == 255 && Math.Abs(actual.R - expectedColor.R) <= 1 && Math.Abs(actual.G - expectedColor.G) <= 1 && Math.Abs(actual.B - expectedColor.B) <= 1,
                    "Synthetic BGRx color was lost or transparent at sample " + i + ": " + actual.ToString());
            }
        }
    }
    private static void Cancellation()
    {
        using (CancellationTokenSource cancelled = new CancellationTokenSource())
        {
            bool copied = false, rejected = false;
            cancelled.Cancel();
            try { DesktopSnapshot.Create(new Size(80, 40), delegate { copied = true; }, cancelled.Token); }
            catch (OperationCanceledException) { rejected = true; }
            Check(rejected && !copied, "Cancelled request reached capture.");
        }
        using (CancellationTokenSource cancelled = new CancellationTokenSource())
        {
            bool rejected = false;
            try { DesktopSnapshot.Create(new Size(80, 40), delegate { cancelled.Cancel(); }, cancelled.Token); }
            catch (OperationCanceledException) { rejected = true; }
            Check(rejected, "Cancellation during capture returned an image.");
        }
    }
    private static int Main()
    {
        try
        {
            Encoding(new Size(1280, 720), new Size(640, 360));
            Encoding(new Size(80, 40), new Size(80, 40));
            Encoding(new Size(360, 640), new Size(202, 360));
            Encoding(new Size(641, 361), new Size(639, 360));
            Cancellation();
            Console.WriteLine("6 snapshot encoding scenarios passed with synthetic BGRx pixels; RAM only, no capture or UI.");
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
    }
}
