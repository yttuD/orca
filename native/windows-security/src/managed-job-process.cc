// Gate 9B Windows Job Object proof-of-implementation.
// This is a primitive, NOT an IPC entrypoint and NOT authorization to start
// Orcastrator's operational motor. Caller must supply a verified executable,
// isolated environment, exclusive lease and operator approval separately.
//
// Ordering invariant: CREATE_SUSPENDED -> ASSIGN to private kill-on-close job
// -> verify process creation time -> ResumeThread. No PID-based adoption or
// termination, no shell, no inherited handles, and no breakaway flags.

#include "managed-job-process.h"

#include <windows.h>

#include <cstdint>
#include <string>
#include <utility>

namespace {

Napi::Value WinError(Napi::Env env, const char* syscall, DWORD code) {
  Napi::Error::New(
      env, std::string(syscall) + " failed with Win32 error " + std::to_string(code))
      .ThrowAsJavaScriptException();
  return env.Undefined();
}

Napi::Value ArgumentError(Napi::Env env) {
  Napi::TypeError::New(
      env, "spawnManagedJobContained(file, commandLine, cwd, environmentBlock): "
           "four nonempty strings, NUL-terminated environmentBlock required")
      .ThrowAsJavaScriptException();
  return env.Undefined();
}

void CloseOnLaunchFailure(HANDLE job, PROCESS_INFORMATION* created) {
  // The root remains suspended until the only job-ownership handle exists.
  // If anything fails, terminate that specific process handle, never a PID.
  if (created != nullptr && created->hProcess != nullptr) {
    TerminateProcess(created->hProcess, 1);
    WaitForSingleObject(created->hProcess, 5000);
    CloseHandle(created->hProcess);
  }
  if (created != nullptr && created->hThread != nullptr) {
    CloseHandle(created->hThread);
  }
  if (job != nullptr) {
    CloseHandle(job);  // KILL_ON_JOB_CLOSE also covers any assigned descendants.
  }
}

// ObjectWrap owns the ONLY private unnamed job handle. Job is destroyed and
// contained processes killed on explicit close, GC or main process death.
// Never expose a raw HANDLE or a constructor usable from untrusted JS.
// Type-tagged native Job Object: a copied JS prototype is never evidence of
// a retained Windows Job Object handle. Never expose the raw handle.
constexpr napi_type_tag kManagedJobProcessTypeTag{
  0x289a7bcc21c44ce4ULL, 0xb35bc61429558aafULL
};

class ManagedJobProcess final : public Napi::ObjectWrap<ManagedJobProcess> {
 public:
  explicit ManagedJobProcess(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<ManagedJobProcess>(info) {}

  ~ManagedJobProcess() { CloseOwned(); }

  static void Initialize(Napi::Env env) {
    auto type = DefineClass(env, "ManagedJobProcess", {
        InstanceMethod("snapshot", &ManagedJobProcess::Snapshot),
        InstanceMethod("close", &ManagedJobProcess::Close),
        InstanceMethod("closeIfEmptyForQa", &ManagedJobProcess::CloseIfEmptyForQa)
    });
    Constructor() = Napi::Persistent(type);
    Constructor().SuppressDestruct();
  }

  static Napi::Object Create(
      Napi::Env env, HANDLE job, HANDLE process, DWORD pid, uint64_t creation) {
    auto instance = Constructor().New({});
    if (env.IsExceptionPending()) return Napi::Object::New(env);
    if (napi_type_tag_object(env, instance, &kManagedJobProcessTypeTag) != napi_ok) {
      return Napi::Object::New(env);
    }
    auto* owned = Unwrap(instance);
    if (owned == nullptr) return Napi::Object::New(env);
    owned->job_ = job;
    owned->process_ = process;
    owned->pid_ = pid;
    owned->creationTicks_ = creation;
    return instance;
  }

  /**
   * QA-only native entrypoint: deny fake JS prototypes and require identity
   * of the exact private Job Object originally created by this addon.
   * Calls the existing verified empty-job close path directly (not an
   * overridable JS method). This does NOT verify historic journal authorship.
   */
  static Napi::Value CloseRecordedEmptyForQa(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto denied = [&](const char* reason) -> Napi::Value {
      auto result = Napi::Object::New(env);
      result.Set("state", Napi::String::New(env, reason));
      return result;
    };
    if (info.Length() != 3 || !info[0].IsObject() ||
        !info[1].IsNumber() || !info[2].IsString()) {
      return denied("UNTRUSTED_JOB_OBJECT");
    }
    const double expectedPid = info[1].As<Napi::Number>().DoubleValue();
    const std::string expectedTime = info[2].As<Napi::String>().Utf8Value();
    if (expectedPid < 1 || expectedPid > 4294967295.0 ||
        static_cast<double>(static_cast<DWORD>(expectedPid)) != expectedPid ||
        expectedTime.empty()) {
      return denied("JOB_IDENTITY_MISMATCH");
    }
    bool tagged = false;
    if (napi_check_object_type_tag(env, info[0], &kManagedJobProcessTypeTag,
                                   &tagged) != napi_ok || !tagged) {
      return denied("UNTRUSTED_JOB_OBJECT");
    }
    void* raw = nullptr;
    if (napi_unwrap(env, info[0], &raw) != napi_ok || raw == nullptr) {
      return denied("UNTRUSTED_JOB_OBJECT");
    }
    auto* owned = static_cast<ManagedJobProcess*>(raw);
    if (owned->pid_ != static_cast<DWORD>(expectedPid) ||
        std::to_string(owned->creationTicks_) != expectedTime) {
      return denied("JOB_IDENTITY_MISMATCH");
    }
    // An already-closed native handle is not evidence of a NEW clean close.
    return owned->CloseIfEmptyForQa(info);
  }

 private:
  static Napi::FunctionReference& Constructor() {
    static Napi::FunctionReference reference;
    return reference;
  }

  void CloseOwned() {
    if (job_ != nullptr) {
      // Unnamed, noninheritable: closing the last handle kills descendants.
      CloseHandle(job_);
      job_ = nullptr;
    }
    if (process_ != nullptr) {
      CloseHandle(process_);
      process_ = nullptr;
    }
  }

  Napi::Value Close(const Napi::CallbackInfo& info) {
    CloseOwned();
    return info.Env().Undefined();
  }

  /**
   * C3-E-C QA-only: verify this *same native* private Job Object is empty,
   * and its original root HANDLE signaled, BEFORE closing the last job handle.
   * Never enumerates, adopts or kills any external process. If still active,
   * it leaves job+process handles untouched and reports BLOCKED.
   *
   * This is deliberately not a durable previous-owner attestation; it must
   * not be replayed by a new process or interpreted from JSON alone.
   */
  Napi::Value CloseIfEmptyForQa(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto denied = [&](const char* state) -> Napi::Value {
      auto result = Napi::Object::New(env);
      result.Set("state", Napi::String::New(env, state));
      return result;
    };
    if (job_ == nullptr || process_ == nullptr) {
      return denied("ALREADY_CLOSED");
    }

    const DWORD rootWait = WaitForSingleObject(process_, 0);
    if (rootWait == WAIT_TIMEOUT) {
      return denied("ROOT_STILL_RUNNING");
    }
    if (rootWait != WAIT_OBJECT_0) {
      return denied("UNKNOWN");
    }

    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
    if (!QueryInformationJobObject(job_, JobObjectBasicAccountingInformation,
                                   &accounting, sizeof(accounting), nullptr)) {
      return denied("UNKNOWN");
    }
    if (accounting.ActiveProcesses != 0) {
      return denied("DESCENDANTS_STILL_RUNNING");
    }

    // No active processes are members of this private job, and the root's
    // own kernel HANDLE has signaled. Closing now cannot kill a live member.
    // A separate future writer must still verify integrity and generation;
    // this returned JS object itself is not an authenticated journal record.
    if (!CloseHandle(job_)) {
      return denied("UNKNOWN");
    }
    job_ = nullptr;
    CloseHandle(process_);
    process_ = nullptr;

    auto result = Napi::Object::New(env);
    result.Set("state", Napi::String::New(env, "CLOSED_EMPTY_QA_ONLY"));
    result.Set("pid", Napi::Number::New(env, static_cast<double>(pid_)));
    result.Set("creationTimeTicks",
               Napi::String::New(env, std::to_string(creationTicks_)));
    result.Set("observedActiveProcesses", Napi::Number::New(env, 0));
    result.Set("rootExitedBeforeClose", Napi::Boolean::New(env, true));
    result.Set("notHistoricalAttestation", Napi::Boolean::New(env, true));
    return result;
  }

  Napi::Value Snapshot(const Napi::CallbackInfo& info) {
    const auto env = info.Env();
    auto value = Napi::Object::New(env);
    value.Set("closed", Napi::Boolean::New(env, job_ == nullptr));
    value.Set("pid", Napi::Number::New(env, static_cast<double>(pid_)));
    // Win32 FILETIME 100ns ticks exceed JS MAX_SAFE_INTEGER: use a string.
    value.Set("creationTimeTicks", Napi::String::New(env, std::to_string(creationTicks_)));
    if (job_ == nullptr || process_ == nullptr) {
      value.Set("rootRunning", Napi::Boolean::New(env, false));
      value.Set("activeProcesses", Napi::Number::New(env, 0));
      return value;
    }
    DWORD wait = WaitForSingleObject(process_, 0);
    if (wait == WAIT_FAILED) {
      return WinError(env, "WaitForSingleObject", GetLastError());
    }
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
    if (!QueryInformationJobObject(job_, JobObjectBasicAccountingInformation,
                                   &accounting, sizeof(accounting), nullptr)) {
      return WinError(env, "QueryInformationJobObject", GetLastError());
    }
    value.Set("rootRunning", Napi::Boolean::New(env, wait == WAIT_TIMEOUT));
    value.Set("activeProcesses", Napi::Number::New(env, accounting.ActiveProcesses));
    return value;
  }

  HANDLE job_ = nullptr;
  HANDLE process_ = nullptr;
  DWORD pid_ = 0;
  uint64_t creationTicks_ = 0;
};

bool ValidEnvironmentBlock(const std::u16string& block) {
  // Windows CreateProcess expects UTF-16 K=V\0...\0\0, not a normal string.
  // Empty environment: exactly two NULs. Max Win32 environment block 32767.
  return block.size() >= 2 && block.size() <= 32767 &&
         block[block.size() - 1] == u'\0' &&
         block[block.size() - 2] == u'\0';
}

uint64_t FileTimeTicks(const FILETIME& time) {
  ULARGE_INTEGER ticks{};
  ticks.LowPart = time.dwLowDateTime;
  ticks.HighPart = time.dwHighDateTime;
  return ticks.QuadPart;
}

}  // namespace

void InitializeManagedJobProcess(Napi::Env env) {
  ManagedJobProcess::Initialize(env);
}

Napi::Value CloseRecordedManagedJobIfEmptyForQa(const Napi::CallbackInfo& info) {
  return ManagedJobProcess::CloseRecordedEmptyForQa(info);
}

Napi::Value SpawnManagedJobContained(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 4 ||
      !info[0].IsString() || !info[1].IsString() ||
      !info[2].IsString() || !info[3].IsString()) {
    return ArgumentError(env);
  }

  const std::u16string file = info[0].As<Napi::String>().Utf16Value();
  const std::u16string commandLine = info[1].As<Napi::String>().Utf16Value();
  const std::u16string cwd = info[2].As<Napi::String>().Utf16Value();
  std::u16string environment = info[3].As<Napi::String>().Utf16Value();

  if (file.empty() || commandLine.empty() || cwd.empty() ||
      !ValidEnvironmentBlock(environment)) {
    return ArgumentError(env);
  }

  // Unnamed job avoids cross-process open/adoption; handle is non-inheritable.
  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (job == nullptr) return WinError(env, "CreateJobObjectW", GetLastError());

  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                               &limits, sizeof(limits))) {
    DWORD error = GetLastError();
    CloseHandle(job);
    return WinError(env, "SetInformationJobObject", error);
  }

  // Read-back prevents a silent downgrade to a job without kill-on-close.
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION verified{};
  if (!QueryInformationJobObject(job, JobObjectExtendedLimitInformation,
                                 &verified, sizeof(verified), nullptr) ||
      (verified.BasicLimitInformation.LimitFlags &
       JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) == 0) {
    DWORD error = GetLastError();
    CloseHandle(job);
    return WinError(env, "VerifyJobKillOnClose", error ? error : ERROR_INVALID_DATA);
  }

  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESHOWWINDOW;
  startup.wShowWindow = SW_HIDE;

  PROCESS_INFORMATION created{};
  const DWORD flags = CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT;
  // CreateProcessW mutates the command-line buffer.
  std::u16string mutableCommand = commandLine;
  if (!CreateProcessW(reinterpret_cast<LPCWSTR>(file.c_str()),
                      reinterpret_cast<LPWSTR>(mutableCommand.data()),
                      nullptr, nullptr, FALSE, flags,
                      environment.data(), reinterpret_cast<LPCWSTR>(cwd.c_str()),
                      &startup, &created)) {
    DWORD error = GetLastError();
    CloseHandle(job);
    return WinError(env, "CreateProcessW", error);
  }

  if (!AssignProcessToJobObject(job, created.hProcess)) {
    DWORD error = GetLastError();
    CloseOnLaunchFailure(job, &created);
    return WinError(env, "AssignProcessToJobObject", error);
  }

  FILETIME creation{}, exit{}, kernel{}, user{};
  if (!GetProcessTimes(created.hProcess, &creation, &exit, &kernel, &user)) {
    DWORD error = GetLastError();
    CloseOnLaunchFailure(job, &created);
    return WinError(env, "GetProcessTimes", error);
  }

  // On assign failure we NEVER resume; on resume failure kill the entire
  // private job. Assignment-before-resume closes the child-spawn race.
  if (ResumeThread(created.hThread) == static_cast<DWORD>(-1)) {
    DWORD error = GetLastError();
    CloseOnLaunchFailure(job, &created);
    return WinError(env, "ResumeThread", error);
  }
  CloseHandle(created.hThread);
  created.hThread = nullptr;

  auto instance = ManagedJobProcess::Create(
      env, job, created.hProcess, created.dwProcessId, FileTimeTicks(creation));
  if (env.IsExceptionPending() || !instance.IsObject() ||
      !instance.Has("snapshot")) {
    CloseOnLaunchFailure(job, &created);
    return env.Undefined();
  }
  return instance;
}
