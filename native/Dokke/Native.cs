using System.Runtime.InteropServices;
using System.Text;

namespace Dokke;

/// <summary>P/Invoke do Win32 usado para listar e focar janelas.</summary>
internal static class Native
{
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    public const uint GW_OWNER = 4;
    public const int GWL_EXSTYLE = -20;
    public const long WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
    public const int SW_RESTORE = 9;
    public const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_SHOWWINDOW = 0x40;
    public static readonly IntPtr HWND_TOPMOST = new(-1), HWND_NOTOPMOST = new(-2);
    public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    public const int DWMWA_CLOAKED = 14;

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool altTab);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO info);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern int GetApplicationUserModelId(IntPtr process, ref uint length, StringBuilder id);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);

    [StructLayout(LayoutKind.Sequential)]
    public struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }
}
