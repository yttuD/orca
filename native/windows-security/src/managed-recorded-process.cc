// ORCA-D02 Gate 9B-C3-C — read-only identity of an already recorded PID.
// Inputs MUST eventually come from a trusted owner journal in Electron main;
// this native function alone does NOT establish such trust.
// No process enumeration, adoption, startup, termination, token access,
// or permission to launch a motor. A missing PID does not prove that the
// entire previous Job Object or an unrelated listener is gone.

#include <windows.h>
#include "managed-recorded-process.h"

#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

namespace {

Napi::Object Result(Napi::Env env, const char* status, DWORD pid) {
  auto value = Napi::Object::New(env);
  value.Set("status", Napi::String::New(env, status));
  value.Set("pid", Napi::Number::New(env, static_cast<double>(pid)));
  value.Set("actualCreationTimeTicks", env.Null());
  value.Set("executablePath", env.Null());
  return value;
}

uint64_t Ticks(const FILETIME& t) {
  ULARGE_INTEGER value{};
  value.LowPart = t.dwLowDateTime;
  value.HighPart = t.dwHighDateTime;
  return value.QuadPart;
}

bool ValidExpectedTicks(const std::string& value) {
  if (value.size() < 12 || value.size() > 20 || value[0] == '0') return false;
  for (const char digit : value) {
    if (digit < '0' || digit > '9') return false;
  }
  return true;
}

}  // namespace

Napi::Value InspectManagedQaRecordedProcess(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  if (info.Length() != 2 || !info[0].IsNumber() || !info[1].IsString()) {
    Napi::TypeError::New(env,
        "inspectManagedQaRecordedProcess(pid, expectedCreationTimeTicks)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  double pidNumber = info[0].As<Napi::Number>().DoubleValue();
  if (!std::isfinite(pidNumber) || std::floor(pidNumber) != pidNumber ||
      pidNumber <= 0 || pidNumber > 4294967295.0) {
    Napi::RangeError::New(env, "Invalid recorded Windows PID")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto expected = info[1].As<Napi::String>().Utf8Value();
  if (!ValidExpectedTicks(expected)) {
    Napi::TypeError::New(env, "Invalid Win32 creation FILETIME string")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  DWORD pid = static_cast<DWORD>(pidNumber);
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
                               FALSE, pid);
  if (process == nullptr) {
    const DWORD error = GetLastError();
    auto result = Result(env, error == ERROR_INVALID_PARAMETER
                                  ? "NOT_RUNNING" : "UNKNOWN", pid);
    if (error != ERROR_INVALID_PARAMETER) {
      result.Set("reason", Napi::String::New(env, "OPEN_PROCESS_UNVERIFIED"));
    }
    return result;
  }

  FILETIME creation{}, exit{}, kernel{}, user{};
  if (!GetProcessTimes(process, &creation, &exit, &kernel, &user)) {
    CloseHandle(process);
    auto result = Result(env, "UNKNOWN", pid);
    result.Set("reason", Napi::String::New(env, "PROCESS_TIME_UNVERIFIED"));
    return result;
  }

  const std::string actual = std::to_string(Ticks(creation));
  if (actual != expected) {
    CloseHandle(process);
    auto result = Result(env, "PID_REUSED", pid);
    result.Set("actualCreationTimeTicks", Napi::String::New(env, actual));
    return result;
  }

  // The HANDLE refers to the same kernel object throughout the observation,
  // avoiding a race if the process exits while we read its image.
  DWORD wait = WaitForSingleObject(process, 0);
  if (wait != WAIT_TIMEOUT && wait != WAIT_OBJECT_0) {
    CloseHandle(process);
    auto result = Result(env, "UNKNOWN", pid);
    result.Set("reason", Napi::String::New(env, "PROCESS_STATE_UNVERIFIED"));
    return result;
  }

  std::vector<wchar_t> image(32768, L'\0');
  DWORD count = static_cast<DWORD>(image.size());
  if (!QueryFullProcessImageNameW(process, 0, image.data(), &count) ||
      count == 0 || count >= image.size()) {
    CloseHandle(process);
    auto result = Result(env, "UNKNOWN", pid);
    result.Set("reason", Napi::String::New(env, "EXECUTABLE_UNVERIFIED"));
    return result;
  }
  CloseHandle(process);
  auto result = Result(env, wait == WAIT_TIMEOUT ? "MATCH_RUNNING" : "MATCH_EXITED", pid);
  result.Set("actualCreationTimeTicks", Napi::String::New(env, actual));
  // Internal host-only diagnostic. NEVER forward paths to renderer or logs.
  result.Set("executablePath", Napi::String::New(
      env, reinterpret_cast<const char16_t*>(image.data()), count));
  return result;
}
