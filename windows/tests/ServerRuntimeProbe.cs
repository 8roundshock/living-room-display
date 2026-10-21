using System;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;

// Used only by Test-ServerRuntime.ps1. Refuses the production port and non-fixture paths.
internal static class ServerRuntimeProbe {
    private static int Main(string[] args) {
        try {
            int port;
            if (args.Length != 3 || !int.TryParse(args[2], out port) || port < 1024 || port > 65535 || port == 4318)
                throw new ArgumentException("Expected start/status/stop, a synthetic fixture app path and a non-production port.");
            string app = Path.GetFullPath(args[1]);
            string root = Directory.GetParent(app).FullName;
            if (!string.Equals(Path.GetFileName(app), "app", StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(Directory.GetParent(root).FullName.TrimEnd(Path.DirectorySeparatorChar), Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) ||
                !Path.GetFileName(root).StartsWith("lrd-native-runtime-", StringComparison.Ordinal))
                throw new ArgumentException("The probe accepts only its isolated temporary fixture.");
            var runtime = new ServerRuntime(new WindowsServerEnvironment(app, port));
            using (var cancellation = new CancellationTokenSource()) {
                cancellation.CancelAfter(15000);
                if (args[0] == "start") runtime.Start(cancellation.Token);
                else if (args[0] == "stop") runtime.Stop(cancellation.Token);
                else if (args[0] != "status") throw new ArgumentException("Unknown probe operation.");
                // The server deliberately outlives this probe. A redirected stdout pipe would
                // remain inherited by Node and make a parent ReadToEnd wait for the server's exit.
                File.WriteAllText(Path.Combine(root, "probe-result.json"), new JavaScriptSerializer().Serialize(runtime.Status(cancellation.Token)));
            }
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
