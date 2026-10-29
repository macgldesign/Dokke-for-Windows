// Comandos de linha de comando usados pelo servidor Node (via execFile, um argumento por
// entrada de argv: nada é interpretado por shell). Todo resultado sai como JSON em UTF-8.
//
//   running                        janelas de app visíveis (ordem Z) com pid/hwnd/caminho/AUMID
//   focus <hwnd>                   {"result":"focused|flashed|not-found|error"}
//   launch <exe> [argumentos]      inicia um executável do inventário
//   launch-packaged <AUMID>        inicia um app da Store
//   icon <alvo> [local-do-ícone]   {"png":"<base64>"|null}
//   icon-packaged <AUMID>          idem, para apps da Store
//   firewall-allow <node.exe>      regra de firewall (precisa de admin; o tray pede o UAC)

using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Dokke;

internal static class Verbs
{
    private static readonly HashSet<string> Names = new(StringComparer.Ordinal)
    {
        "running", "focus", "launch", "launch-packaged", "icon", "icon-packaged", "firewall-allow",
    };

    public static bool IsVerb(string arg) => Names.Contains(arg);

    public static int Run(string[] args)
    {
        try
        {
            return args[0] switch
            {
                "running" when args.Length == 1 => Print(WindowList.Running()),
                "focus" when args.Length == 2 => Focus(args[1]),
                "launch" when args.Length is 2 or 3 => Launch(args),
                "launch-packaged" when args.Length == 2 => LaunchPackaged(args[1]),
                "icon" when args.Length is 2 or 3 => Print(new { png = AppIcon.Extract(args[1], args.Length == 3 ? args[2] : "") }),
                "icon-packaged" when args.Length == 2 => Print(new { png = PackagedApp.Icon(args[1]) }),
                "firewall-allow" when args.Length == 2 => Firewall.Allow(args[1]),
                _ => Fail($"uso inválido: {args[0]}"),
            };
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    private static int Focus(string handleText)
    {
        if (!long.TryParse(handleText, out var raw) || raw == 0) return Print(new { result = "error", detail = "handle inválido" });
        try
        {
            return Print(new { result = WindowList.Focus(new IntPtr(raw)) });
        }
        catch (Exception ex)
        {
            return Print(new { result = "error", detail = ex.Message });
        }
    }

    private static int Launch(string[] args)
    {
        var target = args[1];
        if (!Path.IsPathFullyQualified(target) || target.StartsWith(@"\\") ||
            !target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || !File.Exists(target))
            return Fail("launch: alvo inválido");
        // UseShellExecute: o Windows resolve o app com o token do próprio usuário.
        // O caminho vai em FileName, nunca dentro de uma linha de comando.
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = target,
            Arguments = args.Length == 3 ? args[2] : string.Empty,
            UseShellExecute = true,
            WorkingDirectory = Path.GetDirectoryName(target) ?? string.Empty,
        });
        return 0; // process pode ser null quando o shell reaproveita uma instância existente
    }

    private static int LaunchPackaged(string id)
    {
        if (!PackagedApp.IsValid(id)) return Fail("launch-packaged: identificador inválido");
        PackagedApp.Launch(id);
        return 0;
    }

    private static int Print(object value)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value) + "\n");
        using var stdout = Console.OpenStandardOutput();
        stdout.Write(bytes, 0, bytes.Length);
        return 0;
    }

    private static int Fail(string message)
    {
        var bytes = Encoding.UTF8.GetBytes(message + "\n");
        using var stderr = Console.OpenStandardError();
        stderr.Write(bytes, 0, bytes.Length);
        return 2;
    }
}
