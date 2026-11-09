"""Restricted synthetic acceptance worker, not a general Python sandbox."""
import json
import os
import sys

MEMORY = 512 * 1024 * 1024
_job_handle = None


def install_limits():
    global _job_handle
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class Basic(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
                        ("flags", wintypes.DWORD), ("min_ws", ctypes.c_size_t), ("max_ws", ctypes.c_size_t),
                        ("active", wintypes.DWORD), ("affinity", ctypes.c_size_t),
                        ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]

        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]

        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", IO), ("process_memory", ctypes.c_size_t),
                        ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.SetInformationJobObject.restype = wintypes.BOOL
        kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
        kernel.QueryInformationJobObject.restype = wintypes.BOOL
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        job = kernel.CreateJobObjectW(None, None)
        if not job:
            raise RuntimeError("limits unavailable")
        info = Extended()
        info.basic.flags = 0x2 | 0x8 | 0x100 | 0x2000
        info.basic.process_time = 8 * 10_000_000
        info.basic.active = 1
        info.process_memory = MEMORY
        if not kernel.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
            raise RuntimeError("limits unavailable")
        if not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
            raise RuntimeError("limits unavailable")
        observed = Extended()
        if not kernel.QueryInformationJobObject(job, 9, ctypes.byref(observed), ctypes.sizeof(observed), None):
            raise RuntimeError("limits unavailable")
        if observed.basic.flags & info.basic.flags != info.basic.flags or observed.process_memory != MEMORY or observed.basic.active != 1:
            raise RuntimeError("limits mismatch")
        _job_handle = job
        return "windows-job"
    if sys.platform.startswith("linux"):
        import resource
        for kind, value in [(resource.RLIMIT_AS, MEMORY), (resource.RLIMIT_CPU, 8),
                            (resource.RLIMIT_FSIZE, 1024 * 1024), (resource.RLIMIT_NOFILE, 64), (resource.RLIMIT_CORE, 0)]:
            resource.setrlimit(kind, (value, value))
            if resource.getrlimit(kind) != (value, value):
                raise RuntimeError("limits mismatch")
        return "linux-rlimit"
    raise RuntimeError("unsupported platform")


def main():
    try:
        mechanism = install_limits()
    except Exception:
        print('study-limits-v1:{"installed":false}', flush=True)
        return 70
    print("study-limits-v1:" + json.dumps({"installed": True, "mechanism": mechanism, "memory": MEMORY, "cpuSeconds": 8}, separators=(",", ":")), flush=True)
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "probe" and len(sys.argv) == 2:
        return 0
    if mode == "environment" and len(sys.argv) == 2:
        assert "DSH_REFORGE_STUDY_KEY" not in os.environ and "REFORGE_PARENT_SENTINEL" not in os.environ
        print("study-environment-v1:isolated", flush=True)
        return 0
    if mode == "memory" and len(sys.argv) == 2:
        try:
            bytearray(MEMORY + 64 * 1024 * 1024)
        except MemoryError:
            print("study-memory-v1:bounded", flush=True)
            return 0
        return 71
    if mode != "pytest" or len(sys.argv) != 7:
        return 64
    vendor, project, tests, config, xml = map(os.path.realpath, sys.argv[2:])
    sys.path[:0] = [vendor, project]
    os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
    os.environ["PYTEST_ADDOPTS"] = ""
    import pytest
    assert pytest.__version__ == "9.1.1"
    return pytest.main([tests, "-q", "--noconftest", "-c", config, "--import-mode=importlib", "-p", "no:cacheprovider", "--junitxml", xml])


if __name__ == "__main__":
    sys.exit(main())
