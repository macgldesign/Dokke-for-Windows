using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Dokke;

/// <summary>
/// Job object com KILL_ON_JOB_CLOSE: se o Dokke fechar (ou travar), o Windows encerra o
/// servidor Node junto. Evita um node.exe órfão segurando a porta 3000.
/// </summary>
internal sealed class JobObject : IDisposable
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll")] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint size);
    [DllImport("kernel32.dll")] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong Read, Write, Other, ReadBytes, WriteBytes, OtherBytes; }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    private readonly IntPtr _job;

    public JobObject()
    {
        _job = CreateJobObjectW(IntPtr.Zero, null);
        if (_job == IntPtr.Zero) return;
        var limits = new ExtendedLimits();
        limits.Basic.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        var size = Marshal.SizeOf<ExtendedLimits>();
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, buffer, false);
            SetInformationJobObject(_job, JobObjectExtendedLimitInformation, buffer, (uint)size);
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    public void Add(Process process)
    {
        if (_job != IntPtr.Zero) AssignProcessToJobObject(_job, process.Handle);
    }

    public void Dispose()
    {
        if (_job != IntPtr.Zero) CloseHandle(_job); // fecha o job => encerra os processos dentro dele
    }
}
