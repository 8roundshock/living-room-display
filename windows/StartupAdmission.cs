using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

// A per-user backend must remain accessible to Windows' normal screensaver launch.
// Admission precedes any backend, native surface, named lock or configuration work.
internal static class StartupAdmission
{
    internal const string Refusal = "Living Room Display is a per-user app. Close this administrator window and run the same command normally. An elevated backend prevents normal Windows screensaver startup.";

    internal static bool RequiresNormalContext(string mode)
    {
        return mode == "--start" || mode == "/c" || mode.StartsWith("/c:", StringComparison.Ordinal) ||
            mode == "--editor" || mode == "/s" || mode == "--display" || mode == "--test-display";
    }

    internal static bool IsElevated()
    {
        using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
        {
            int value, returned;
            if (!GetTokenInformation(identity.Token, 18, out value, 4, out returned)) throw new Win32Exception();
            if (returned != 4) throw new InvalidOperationException("The startup token type is unreadable.");
            return IsElevatedType(value);
        }
    }

    internal static bool IsElevatedType(int value)
    {
        // TokenElevationTypeFull only: Default is also used by normal non-split
        // administrator sessions, which the existing Setup policy supports.
        if (value < 1 || value > 3) throw new InvalidOperationException("The startup token type is unreadable.");
        return value == 2;
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int size, out int returned);

    internal static int Run(string mode, Func<bool> elevated, Func<int> operation)
    {
        if (RequiresNormalContext(mode) && elevated()) throw new InvalidOperationException(Refusal);
        return operation();
    }
}
