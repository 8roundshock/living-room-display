using System;

// No current-token, process, file, UI, registry or network calls.
internal static class StartupAdmissionTests
{
    private static int assertions;
    private static void Check(bool value, string reason) { assertions++; if (!value) throw new Exception(reason); }
    private static int Main()
    {
        try
        {
            Check(!StartupAdmission.IsElevatedType(1), "normal default token was classified as elevated");
            Check(StartupAdmission.IsElevatedType(2), "elevated full split token was admitted");
            Check(!StartupAdmission.IsElevatedType(3), "normal limited split token was refused");
            bool invalid = false;
            try { StartupAdmission.IsElevatedType(0); } catch (InvalidOperationException) { invalid = true; }
            Check(invalid, "unknown token type was admitted");
            foreach (string mode in new[] { "--start", "/c", "/c:123", "--editor", "/s", "--display", "--test-display" })
            {
                int reads = 0, effects = 0; bool refused = false;
                try { StartupAdmission.Run(mode, delegate { reads++; return true; }, delegate { effects++; return 42; }); }
                catch (InvalidOperationException error) { refused = error.Message == StartupAdmission.Refusal; }
                Check(refused && reads == 1 && effects == 0, mode + " performed work before refusing elevation");
                Check(StartupAdmission.Run(mode, delegate { return false; }, delegate { effects++; return 42; }) == 42 && effects == 1,
                    mode + " rejected normal startup");
            }
            foreach (string mode in new[] { "--stop", "--status", "--check", "/p", "/p:123" })
            {
                int effects = 0;
                Check(StartupAdmission.Run(mode, delegate { throw new Exception("must not query token"); }, delegate { effects++; return 0; }) == 0 && effects == 1,
                    mode + " cleanup/inspection was blocked");
            }
            bool unknown = false; int unknownEffects = 0;
            try { StartupAdmission.Run("--start", delegate { throw new InvalidOperationException("synthetic unreadable token"); }, delegate { unknownEffects++; return 0; }); }
            catch (InvalidOperationException) { unknown = true; }
            Check(unknown && unknownEffects == 0, "unreadable token admitted startup");
            Console.WriteLine(assertions + " native admission assertions passed; injected token and effects only.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
