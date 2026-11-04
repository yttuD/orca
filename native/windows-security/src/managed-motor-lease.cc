// ORCA-D02 Gate 9B-C2 — Windows-only, synthetic QA interprocess lease.
// This object does not start a motor, inspect ports or authorize production.
// A successful atomic mutex acquisition only permits *reconciliation*.
// Never treat an abandoned/missing previous mutex as evidence that a
// previous FastAPI server or unrelated process has stopped.

#include "managed-motor-lease.h"

#include <windows.h>
#include <aclapi.h>
#include <sddl.h>

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace {

Napi::Value WinError(Napi::Env env, const char* syscall, DWORD code) {
  Napi::Error::New(env, std::string(syscall) +
      " failed with Win32 error " + std::to_string(code)).ThrowAsJavaScriptException();
  return env.Undefined();
}

bool ValidDigest(const std::string& value) {
  if (value.size() != 64) return false;
  for (char c : value) {
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

uint64_t TimeTicks(const FILETIME& value) {
  ULARGE_INTEGER u{};
  u.HighPart = value.dwHighDateTime;
  u.LowPart = value.dwLowDateTime;
  return u.QuadPart;
}

// Return a protected DACL allowing only the caller, local administrators
// and SYSTEM. A same-user application can deny availability by pre-creating
// the object but cannot cause Orcastrator to acquire or kill its process.
bool BuildOwnerSecurity(PSECURITY_DESCRIPTOR* out, DWORD* failure) {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
    *failure = GetLastError();
    return false;
  }
  DWORD size = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &size);
  if (size == 0 || size > 65536) {
    *failure = GetLastError();
    CloseHandle(token);
    return false;
  }
  std::vector<BYTE> bytes(size);
  BOOL got = GetTokenInformation(token, TokenUser, bytes.data(), size, &size);
  *failure = got ? ERROR_SUCCESS : GetLastError();
  CloseHandle(token);
  if (!got) return false;

  LPWSTR currentSid = nullptr;
  if (!ConvertSidToStringSidW(
          reinterpret_cast<TOKEN_USER*>(bytes.data())->User.Sid,
          &currentSid)) {
    *failure = GetLastError();
    return false;
  }

  const std::wstring sddl =
      L"D:P(A;;0x1f0001;;;SY)(A;;0x1f0001;;;BA)(A;;0x1f0001;;;" +
      std::wstring(currentSid) + L")";
  LocalFree(currentSid);

  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          sddl.c_str(), SDDL_REVISION_1, out, nullptr)) {
    *failure = GetLastError();
    return false;
  }
  return true;
}

bool MatchesCreatedAcl(HANDLE mutex, PSECURITY_DESCRIPTOR expected) {
  BOOL present = FALSE, defaulted = FALSE;
  PACL wanted = nullptr;
  if (!GetSecurityDescriptorDacl(expected, &present, &wanted, &defaulted) ||
      !present || wanted == nullptr) return false;

  PACL actual = nullptr;
  PSECURITY_DESCRIPTOR received = nullptr;
  DWORD code = GetSecurityInfo(mutex, SE_KERNEL_OBJECT,
                               DACL_SECURITY_INFORMATION,
                               nullptr, nullptr, &actual, nullptr, &received);
  bool same = code == ERROR_SUCCESS && actual != nullptr &&
              wanted->AclSize == actual->AclSize &&
              std::memcmp(wanted, actual, wanted->AclSize) == 0;
  if (received) LocalFree(received);
  return same;
}

class ManagedMotorLease final : public Napi::ObjectWrap<ManagedMotorLease> {
 public:
  explicit ManagedMotorLease(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<ManagedMotorLease>(info) {}
  ~ManagedMotorLease() { ReleaseOwned(); }

  static void Initialize(Napi::Env env) {
    auto type = DefineClass(env, "ManagedMotorLease", {
      InstanceMethod("snapshot", &ManagedMotorLease::Snapshot),
      InstanceMethod("close", &ManagedMotorLease::Close)
    });
    Constructor() = Napi::Persistent(type);
    Constructor().SuppressDestruct();
  }

  static Napi::Object Create(Napi::Env env, HANDLE handle,
                              std::string digest, uint64_t creation) {
    auto instance = Constructor().New({});
    if (env.IsExceptionPending()) return Napi::Object::New(env);
    auto* lease = Unwrap(instance);
    if (!lease) return Napi::Object::New(env);
    lease->mutex_ = handle;
    lease->digest_ = std::move(digest);
    lease->creation_ = creation;
    return instance;
  }

 private:
  static Napi::FunctionReference& Constructor() {
    static Napi::FunctionReference ref;
    return ref;
  }

  void ReleaseOwned() {
    if (mutex_ != nullptr) {
      // Node N-API calls and finalization occur on the same JS thread that
      // created/acquired the mutex. Windows mutex ownership is thread-affine.
      ReleaseMutex(mutex_);
      CloseHandle(mutex_);
      mutex_ = nullptr;
    }
  }

  Napi::Value Close(const Napi::CallbackInfo& info) {
    if (mutex_) {
      // If ReleaseMutex fails, do not claim that we released ownership.
      if (!ReleaseMutex(mutex_)) {
        return WinError(info.Env(), "ReleaseMutex", GetLastError());
      }
      CloseHandle(mutex_);
      mutex_ = nullptr;
    }
    return info.Env().Undefined();
  }

  Napi::Value Snapshot(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto result = Napi::Object::New(env);
    result.Set("held", Napi::Boolean::New(env, mutex_ != nullptr));
    result.Set("scope", Napi::String::New(env, "MACHINE"));
    result.Set("motorIdentitySha256", Napi::String::New(env, digest_));
    result.Set("aclVerified", Napi::Boolean::New(env, mutex_ != nullptr));
    result.Set("ownerCreationTimeTicks",
               Napi::String::New(env, std::to_string(creation_)));
    result.Set("reconciliationRequired", Napi::Boolean::New(env, true));
    return result;
  }

  HANDLE mutex_ = nullptr;
  std::string digest_;
  uint64_t creation_ = 0;
};

}  // namespace

void InitializeManagedMotorLease(Napi::Env env) {
  ManagedMotorLease::Initialize(env);
}

Napi::Value AcquireManagedMotorLease(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "acquireManagedMotorLease(sha256LowercaseHex: string)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const std::string digest = info[0].As<Napi::String>().Utf8Value();
  if (!ValidDigest(digest)) {
    Napi::TypeError::New(env, "Invalid motor identity SHA-256")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  PSECURITY_DESCRIPTOR descriptor = nullptr;
  DWORD failure = ERROR_SUCCESS;
  if (!BuildOwnerSecurity(&descriptor, &failure)) {
    return WinError(env, "BuildMotorLeaseOwnerAcl", failure);
  }

  SECURITY_ATTRIBUTES attributes{sizeof(attributes), descriptor, FALSE};
  std::wstring name = L"Global\\Orcastrator.Gate9B.C2.QA.";
  name.append(digest.begin(), digest.end());

  // Create atomically with ownership, never wait on existing objects.
  // Existing names (including abandoned or name-squatted ones) are BLOCKED.
  HANDLE mutex = CreateMutexExW(&attributes, name.c_str(),
                                 CREATE_MUTEX_INITIAL_OWNER,
                                 MUTEX_ALL_ACCESS);
  DWORD createdError = GetLastError();
  if (mutex == nullptr) {
    LocalFree(descriptor);
    return WinError(env, "CreateMutexExW", createdError);
  }
  if (createdError == ERROR_ALREADY_EXISTS) {
    CloseHandle(mutex);
    LocalFree(descriptor);
    auto busy = Napi::Object::New(env);
    busy.Set("state", Napi::String::New(env, "HELD_BY_OTHER"));
    return busy;
  }

  const bool verified = MatchesCreatedAcl(mutex, descriptor);
  LocalFree(descriptor);
  if (!verified) {
    ReleaseMutex(mutex);
    CloseHandle(mutex);
    return WinError(env, "VerifyMotorLeaseAcl", ERROR_INVALID_SECURITY_DESCR);
  }

  FILETIME creation{}, exit{}, kernel{}, user{};
  if (!GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user)) {
    DWORD code = GetLastError();
    ReleaseMutex(mutex);
    CloseHandle(mutex);
    return WinError(env, "GetProcessTimes", code);
  }

  Napi::Object lease = ManagedMotorLease::Create(env, mutex, digest, TimeTicks(creation));
  if (env.IsExceptionPending() || !lease.Has("close")) {
    ReleaseMutex(mutex);
    CloseHandle(mutex);
    return env.Undefined();
  }

  auto outcome = Napi::Object::New(env);
  outcome.Set("state", Napi::String::New(env, "ACQUIRED_REQUIRES_RECONCILIATION"));
  outcome.Set("lease", lease);
  return outcome;
}
