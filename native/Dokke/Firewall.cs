using System.Diagnostics;

namespace Dokke;

/// <summary>
/// Regra de firewall de entrada para o node.exe do Dokke (redes Privadas e de Domínio).
/// Roda elevada, sob demanda, via "Dokke.exe firewall-allow &lt;caminho&gt;" (um único UAC).
/// Regras de bloqueio criadas quando o usuário clicou em "Cancelar" no aviso do Windows
/// têm prioridade sobre as de permissão, então as regras antigas do programa são apagadas antes.
/// </summary>
internal static class Firewall
{
    private const string RuleName = "Dokke";

    public static int Allow(string program)
    {
        if (!Path.IsPathFullyQualified(program) || program.StartsWith(@"\\") || !File.Exists(program))
            throw new ArgumentException("Caminho inválido para a regra de firewall.");
        var file = Path.GetFileName(program);
        if (!file.Equals("node.exe", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Programa não permitido.");

        Netsh("advfirewall", "firewall", "delete", "rule", "name=all", $"program={program}");
        var code = Netsh("advfirewall", "firewall", "add", "rule", $"name={RuleName}", "dir=in", "action=allow",
            $"program={program}", "enable=yes", "profile=private,domain");
        return code;
    }

    private static int Netsh(params string[] args)
    {
        var psi = new ProcessStartInfo("netsh.exe") { UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in args) psi.ArgumentList.Add(arg);
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("netsh não iniciou.");
        process.WaitForExit(15_000);
        return process.HasExited ? process.ExitCode : 1;
    }

    /// <summary>Pede elevação (UAC) e roda a regra. Retorna true se o netsh concluiu com sucesso.</summary>
    public static bool AllowElevated(string program, out string message)
    {
        try
        {
            var psi = new ProcessStartInfo(Environment.ProcessPath!)
            {
                UseShellExecute = true,
                Verb = "runas",
                Arguments = $"firewall-allow \"{program}\"",
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            using var process = Process.Start(psi);
            process?.WaitForExit(30_000);
            var ok = process is { HasExited: true, ExitCode: 0 };
            message = ok ? "Regra de firewall criada para redes Privadas." : "Não foi possível criar a regra de firewall.";
            return ok;
        }
        catch (System.ComponentModel.Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            message = "Cancelado: a permissão de administrador não foi concedida.";
            return false;
        }
        catch (Exception ex)
        {
            message = ex.Message;
            return false;
        }
    }
}
