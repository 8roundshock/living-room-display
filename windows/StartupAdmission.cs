using System;
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
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    internal static int Run(string mode, Func<bool> elevated, Func<int> operation)
    {
        if (RequiresNormalContext(mode) && elevated()) throw new InvalidOperationException(Refusal);
        return operation();
    }
}
