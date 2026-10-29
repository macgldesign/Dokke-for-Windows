using System.Text;

namespace Dokke;

/// <summary>Lista as janelas de topo "de app" e traz uma delas para frente.</summary>
internal static class WindowList
{
    // ---- janelas em execução -------------------------------------------------

    public static List<Dictionary<string, object?>> Running()
    {
        var rows = new List<Dictionary<string, object?>>();
        Native.EnumWindows((h, _) =>
        {
            if (!IsAppWindow(h)) return true;
            Native.GetWindowThreadProcessId(h, out var pid);
            if (pid == 0) return true;
            var path = ImagePath(pid);
            string aumid = "";

            // Apps da Store ficam dentro de um "frame" do ApplicationFrameHost: o
            // processo real é o de uma janela filha. O HWND de topo continua sendo o do frame.
            if (string.Equals(Path.GetFileName(path), "ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase))
            {
                uint real = 0;
                Native.EnumChildWindows(h, (child, _) =>
                {
                    Native.GetWindowThreadProcessId(child, out var childPid);
                    if (childPid != 0 && childPid != pid) { real = childPid; return false; }
                    return true;
                }, IntPtr.Zero);
                if (real == 0) return true; // frame sem app hospedado (suspenso)
                pid = real;
                path = ImagePath(real);
                aumid = Aumid(real);
            }
            else
            {
                aumid = Aumid(pid);
            }

            rows.Add(new Dictionary<string, object?>
            {
                ["pid"] = pid,
                ["hwnd"] = h.ToInt64(),
                ["path"] = path,
                ["aumid"] = aumid,
                ["title"] = Title(h),
            });
            return true;
        }, IntPtr.Zero);
        return rows; // EnumWindows percorre da frente para trás (ordem Z)
    }

    private static bool IsAppWindow(IntPtr h)
    {
        if (!Native.IsWindowVisible(h)) return false;
        if (Native.GetWindow(h, Native.GW_OWNER) != IntPtr.Zero) return false;
        var ex = Native.GetWindowLongPtr(h, Native.GWL_EXSTYLE).ToInt64();
        if ((ex & Native.WS_EX_TOOLWINDOW) != 0 && (ex & Native.WS_EX_APPWINDOW) == 0) return false;
        if (Native.DwmGetWindowAttribute(h, Native.DWMWA_CLOAKED, out var cloaked, sizeof(int)) == 0 && cloaked != 0) return false;
        return Native.GetWindowTextLengthW(h) > 0;
    }

    private static string Title(IntPtr h)
    {
        var sb = new StringBuilder(256);
        Native.GetWindowTextW(h, sb, sb.Capacity);
        return sb.ToString();
    }

    private static string ImagePath(uint pid)
    {
        var process = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero) return "";
        try
        {
            var sb = new StringBuilder(1024);
            var size = (uint)sb.Capacity;
            return Native.QueryFullProcessImageNameW(process, 0, sb, ref size) ? sb.ToString() : "";
        }
        finally { Native.CloseHandle(process); }
    }

    private static string Aumid(uint pid)
    {
        var process = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero) return "";
        try
        {
            uint length = 256;
            var sb = new StringBuilder((int)length);
            return Native.GetApplicationUserModelId(process, ref length, sb) == 0 ? sb.ToString() : "";
        }
        finally { Native.CloseHandle(process); }
    }

    // ---- foco ----------------------------------------------------------------

    /// <summary>"focused" | "flashed" | "not-found". Nunca lança por falta de permissão de foco.</summary>
    public static string Focus(IntPtr h)
    {
        if (!Native.IsWindow(h)) return "not-found";
        if (Native.IsIconic(h)) Native.ShowWindow(h, Native.SW_RESTORE);
        if (IsForeground(h)) return "focused";

        // O Windows só deixa um processo "roubar" o foco em situações específicas.
        // Tentamos do jeito mais gentil para o mais insistente, conferindo a cada passo.
        foreach (var attempt in new Func<IntPtr, bool>[] { Direct, ViaInputAttach, ViaAltKey, ViaSwitchToThis })
        {
            try { if (attempt(h) && Settled(h)) return "focused"; } catch { /* tenta o próximo */ }
        }

        // Último recurso: sobe na ordem Z e pisca o botão na barra de tarefas.
        try
        {
            Native.SetWindowPos(h, Native.HWND_TOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_SHOWWINDOW);
            Native.SetWindowPos(h, Native.HWND_NOTOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_SHOWWINDOW);
        }
        catch { }
        Flash(h);
        return IsForeground(h) ? "focused" : "flashed";
    }

    private static bool IsForeground(IntPtr h) => Native.GetForegroundWindow() == h;

    private static bool Settled(IntPtr h)
    {
        for (var i = 0; i < 5; i++)
        {
            if (IsForeground(h)) return true;
            Thread.Sleep(20);
        }
        return false;
    }

    private static bool Direct(IntPtr h) => Native.SetForegroundWindow(h);

    private static bool ViaInputAttach(IntPtr h)
    {
        var fore = Native.GetForegroundWindow();
        var foreThread = fore == IntPtr.Zero ? 0 : Native.GetWindowThreadProcessId(fore, out _);
        var targetThread = Native.GetWindowThreadProcessId(h, out _);
        var self = Native.GetCurrentThreadId();
        var attachedFore = foreThread != 0 && foreThread != self && Native.AttachThreadInput(self, foreThread, true);
        var attachedTarget = targetThread != 0 && targetThread != self && targetThread != foreThread && Native.AttachThreadInput(self, targetThread, true);
        try
        {
            Native.BringWindowToTop(h);
            return Native.SetForegroundWindow(h);
        }
        finally
        {
            if (attachedFore) Native.AttachThreadInput(self, foreThread, false);
            if (attachedTarget) Native.AttachThreadInput(self, targetThread, false);
        }
    }

    private static bool ViaAltKey(IntPtr h)
    {
        // Um toque de Alt conta como "input recente" e libera o SetForegroundWindow.
        const byte VK_MENU = 0x12; const uint KEYEVENTF_KEYUP = 0x2;
        Native.keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
        Native.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        return Native.SetForegroundWindow(h);
    }

    private static bool ViaSwitchToThis(IntPtr h)
    {
        Native.SwitchToThisWindow(h, true);
        return true; // quem confirma é o Settled()
    }

    private static void Flash(IntPtr h)
    {
        const uint FLASHW_TRAY = 0x2, FLASHW_TIMERNOFG = 0xC;
        var info = new Native.FLASHWINFO
        {
            cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<Native.FLASHWINFO>(),
            hwnd = h, dwFlags = FLASHW_TRAY | FLASHW_TIMERNOFG, uCount = 3, dwTimeout = 0,
        };
        Native.FlashWindowEx(ref info);
    }
}
