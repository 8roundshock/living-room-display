using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Threading;

// Shared by native capture and synthetic encoding tests. Pixels never leave RAM here.
internal static class DesktopSnapshot
{
    internal static byte[] Create(Size size, Action<Bitmap> copy, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        double scale = Math.Min(1, Math.Min(640.0 / size.Width, 360.0 / size.Height));
        // GDI color copies do not establish alpha. Treat the fourth byte as unused,
        // so zero high bytes cannot erase valid desktop RGB during DrawImage.
        using (Bitmap screen = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppRgb))
        using (Bitmap small = new Bitmap(Math.Max(1, (int)(size.Width * scale)), Math.Max(1, (int)(size.Height * scale)), PixelFormat.Format24bppRgb))
        using (Graphics resize = Graphics.FromImage(small))
        using (MemoryStream png = new MemoryStream())
        {
            cancellation.ThrowIfCancellationRequested();
            copy(screen);
            cancellation.ThrowIfCancellationRequested();
            resize.InterpolationMode = InterpolationMode.HighQualityBicubic;
            resize.DrawImage(screen, new Rectangle(0, 0, small.Width, small.Height));
            small.Save(png, ImageFormat.Png);
            cancellation.ThrowIfCancellationRequested();
            return png.ToArray();
        }
    }
}
