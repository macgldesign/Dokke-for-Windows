using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Dokke;

/// <summary>Ícone na bandeja: inicia/monitora o servidor Node e abre a tela do host.</summary>
internal sealed partial class TrayApp : ApplicationContext
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const int MaxQuickFailures = 5;

    private static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Dokke");
    private static readonly string LogDir = Path.Combine(DataDir, "logs");
    private static readonly string LogFile = Path.Combine(LogDir, "server.log");
    private static readonly string StateFile = Path.Combine(DataDir, "tray.json");
    private static readonly string FirstRunFile = Path.Combine(DataDir, ".first-run-done");

    [GeneratedRegex(@"Dokke ouvindo em http://127\.0\.0\.1:(\d+)")]
    private static partial Regex ListeningLine();

    private readonly Control _ui = new();
    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _autostart;
    private readonly JobObject _job = new();
    private readonly object _logLock = new();
    private readonly bool _smoke;
    private readonly System.Windows.Forms.Timer? _smokeTimer;
    private Process? _server;
    private DateTime _serverStarted;
    private int _quickFailures;
    private int _port;
    private bool _quitting;

    public static int Run(string[] args)
    {
        var smoke = args.Contains("--smoke-test");
        ApplicationConfiguration.Initialize();
        using var mutex = new Mutex(true, smoke ? null : @"Local\Dokke.Tray", out var first);
        if (!first)
        {
            // Já está rodando: só abre a tela do host da instância existente.
            OpenHostFromState();
            return 0;
        }
        using var app = new TrayApp(smoke);
        Application.Run(app);
        return Environment.ExitCode;
    }

    private TrayApp(bool smoke)
    {
        _smoke = smoke;
        _ = _ui.Handle; // cria o handle para BeginInvoke vindo de outras threads
        Directory.CreateDirectory(LogDir);
        RotateLog();

        _autostart = new ToolStripMenuItem("Iniciar com o Windows") { CheckOnClick = true, Checked = IsAutostart() };
        _autostart.CheckedChanged += (_, _) => SetAutostart(_autostart.Checked);

        var menu = new ContextMenuStrip();
        menu.Items.Add(new ToolStripMenuItem("Abrir Dokke", null, (_, _) => OpenHost()) { Font = new Font(SystemFonts.MenuFont!, FontStyle.Bold) });
        menu.Items.Add("Copiar endereço para o celular", null, (_, _) => CopyAddress());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Liberar no Firewall…", null, (_, _) => AllowFirewall());
        menu.Items.Add(_autostart);
        menu.Items.Add("Abrir pasta de logs", null, (_, _) => Process.Start(new ProcessStartInfo(LogDir) { UseShellExecute = true }));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Sair do Dokke", null, (_, _) => Quit());

        _icon = new NotifyIcon
        {
            Icon = LoadIcon(),
            Text = "Dokke — iniciando…",
            Visible = !smoke,
            ContextMenuStrip = menu,
        };
        _icon.DoubleClick += (_, _) => OpenHost();

        if (smoke)
        {
            var deadline = DateTime.UtcNow.AddSeconds(25);
            _smokeTimer = new System.Windows.Forms.Timer { Interval = 200 };
            _smokeTimer.Tick += (_, _) =>
            {
                if (_port > 0) { Console.Out.WriteLine($"TRAY OK port={_port}"); Environment.ExitCode = 0; Quit(); }
                else if (DateTime.UtcNow > deadline) { Console.Error.WriteLine("TRAY FAIL: o servidor não respondeu a tempo"); Environment.ExitCode = 1; Quit(); }
            };
            _smokeTimer.Start();
        }
        StartServer();
    }

    // ---- servidor ----------------------------------------------------------------

    private void StartServer()
    {
        if (_quitting) return;
        var root = AppContext.BaseDirectory;
        var bundledNode = Path.Combine(root, "node.exe");
        var serverDir = Directory.Exists(Path.Combine(root, "server")) ? Path.Combine(root, "server") : root;
        var psi = new ProcessStartInfo
        {
            FileName = File.Exists(bundledNode) ? bundledNode : "node.exe",
            WorkingDirectory = serverDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        psi.ArgumentList.Add(Path.Combine(serverDir, "server.js"));
        psi.Environment["DOKKE_HELPER"] = Environment.ProcessPath!;
        psi.Environment["DOKKE_DATA_DIR"] = DataDir;
        psi.Environment["DOKKE_PORT_FALLBACK"] = "1";

        try
        {
            var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            process.OutputDataReceived += (_, e) => OnServerLine(e.Data);
            process.ErrorDataReceived += (_, e) => OnServerLine(e.Data);
            process.Exited += (_, _) => OnUi(() => OnServerExit(process));
            _serverStarted = DateTime.UtcNow;
            process.Start();
            _job.Add(process);
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            _server = process;
            Log($"[tray] servidor iniciado (pid {process.Id})");
        }
        catch (Exception ex)
        {
            Log($"[tray] falha ao iniciar o servidor: {ex.Message}");
            Balloon("Dokke", "Não foi possível iniciar o servidor. Veja a pasta de logs.");
        }
    }

    private void OnServerLine(string? line)
    {
        if (line is null) return;
        Log(line);
        var match = ListeningLine().Match(line);
        if (!match.Success || !int.TryParse(match.Groups[1].Value, out var port)) return;
        OnUi(() =>
        {
            _port = port;
            _quickFailures = 0;
            _icon.Text = $"Dokke — porta {port}";
            try { File.WriteAllText(StateFile, $"{{\"port\":{port}}}"); } catch { }
            if (!_smoke && !File.Exists(FirstRunFile))
            {
                try { File.WriteAllText(FirstRunFile, DateTime.UtcNow.ToString("o")); } catch { }
                OpenHost(); // primeira vez: já abre a tela de pareamento
            }
        });
    }

    private void OnServerExit(Process process)
    {
        if (_quitting || process != _server) return;
        _port = 0;
        _icon.Text = "Dokke — reiniciando…";
        var quick = DateTime.UtcNow - _serverStarted < TimeSpan.FromSeconds(10);
        _quickFailures = quick ? _quickFailures + 1 : 0;
        Log($"[tray] servidor encerrou (código {SafeExitCode(process)}); falhas seguidas: {_quickFailures}");
        if (_quickFailures >= MaxQuickFailures)
        {
            _icon.Text = "Dokke — parado";
            Balloon("Dokke", "O servidor parou de iniciar. Abra a pasta de logs para ver o motivo.");
            return;
        }
        var delay = TimeSpan.FromSeconds(Math.Min(30, 1 << _quickFailures));
        var timer = new System.Windows.Forms.Timer { Interval = (int)delay.TotalMilliseconds };
        timer.Tick += (_, _) => { timer.Stop(); timer.Dispose(); StartServer(); };
        timer.Start();
    }

    private static int SafeExitCode(Process p) { try { return p.ExitCode; } catch { return -1; } }

    // ---- ações do menu -------------------------------------------------------------

    private void OpenHost()
    {
        if (_port <= 0) { Balloon("Dokke", "O servidor ainda está iniciando. Tente de novo em instantes."); return; }
        Process.Start(new ProcessStartInfo($"http://127.0.0.1:{_port}/host") { UseShellExecute = true });
    }

    private static void OpenHostFromState()
    {
        try
        {
            var text = File.ReadAllText(StateFile);
            var match = Regex.Match(text, "\"port\":(\\d+)");
            if (match.Success)
            {
                Process.Start(new ProcessStartInfo($"http://127.0.0.1:{match.Groups[1].Value}/host") { UseShellExecute = true });
                return;
            }
        }
        catch { }
        MessageBox.Show("O Dokke já está em execução. Procure o ícone dele na bandeja do Windows.", "Dokke", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void CopyAddress()
    {
        if (_port <= 0) return;
        var ip = FirstLanAddress();
        var text = ip is null ? $"http://127.0.0.1:{_port}" : $"http://{ip}:{_port}";
        Clipboard.SetText(text);
        Balloon("Dokke", $"Endereço copiado: {text}");
    }

    private static string? FirstLanAddress()
    {
        foreach (var nic in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
            if (nic.NetworkInterfaceType is System.Net.NetworkInformation.NetworkInterfaceType.Loopback or System.Net.NetworkInformation.NetworkInterfaceType.Tunnel) continue;
            if (Regex.IsMatch(nic.Name + nic.Description, "vEthernet|Virtual|VMware|Hyper-V|WSL|Tailscale|Bluetooth", RegexOptions.IgnoreCase)) continue;
            foreach (var unicast in nic.GetIPProperties().UnicastAddresses)
            {
                if (unicast.Address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) continue;
                var text = unicast.Address.ToString();
                if (!text.StartsWith("169.254.")) return text;
            }
        }
        return null;
    }

    private void AllowFirewall()
    {
        var node = Path.Combine(AppContext.BaseDirectory, "node.exe");
        if (!File.Exists(node)) { Balloon("Dokke", "node.exe não encontrado nesta instalação."); return; }
        var ok = Firewall.AllowElevated(node, out var message);
        Balloon("Dokke", message, ok ? ToolTipIcon.Info : ToolTipIcon.Warning);
    }

    private static bool IsAutostart()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue("Dokke") is string;
    }

    private static void SetAutostart(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (enabled) key.SetValue("Dokke", $"\"{Environment.ProcessPath}\"");
        else key.DeleteValue("Dokke", false);
    }

    private void Quit()
    {
        _quitting = true;
        _smokeTimer?.Stop();
        try { if (_server is { HasExited: false }) _server.Kill(entireProcessTree: true); } catch { }
        _icon.Visible = false;
        _icon.Dispose();
        _job.Dispose();
        ExitThread();
    }

    // ---- utilidades --------------------------------------------------------------

    private void Balloon(string title, string text, ToolTipIcon icon = ToolTipIcon.Info)
    {
        if (_smoke) { Console.Error.WriteLine($"{title}: {text}"); return; }
        _icon.ShowBalloonTip(4000, title, text, icon);
    }

    private void OnUi(Action action)
    {
        if (_quitting || _ui.IsDisposed) return;
        try { _ui.BeginInvoke(action); } catch (InvalidOperationException) { /* encerrando */ }
    }

    private void Log(string line)
    {
        lock (_logLock)
        {
            try { File.AppendAllText(LogFile, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {line}{Environment.NewLine}"); } catch { }
        }
    }

    private static void RotateLog()
    {
        try
        {
            if (File.Exists(LogFile) && new FileInfo(LogFile).Length > 1_000_000)
                File.Move(LogFile, LogFile + ".old", overwrite: true);
        }
        catch { }
    }

    private static Icon LoadIcon()
    {
        using var stream = typeof(TrayApp).Assembly.GetManifestResourceStream("Dokke.ico")
            ?? throw new InvalidOperationException("Ícone do Dokke ausente.");
        using var source = new Icon(stream, SystemInformation.SmallIconSize);
        return (Icon)source.Clone();
    }
}
