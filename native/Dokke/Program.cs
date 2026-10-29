namespace Dokke;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        // Mesmo executável: com um comando conhecido age como helper (sem UI);
        // sem argumentos mostra o ícone na bandeja e mantém o servidor rodando.
        if (args.Length > 0 && Verbs.IsVerb(args[0])) return Verbs.Run(args);
        return TrayApp.Run(args);
    }
}
