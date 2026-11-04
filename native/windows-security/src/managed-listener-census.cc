// ORCA-D02 Gate 9B-C3-B: read-only Win32 TCP listener census.
// A snapshot is NOT a permission to start a motor. In particular, an empty
// listener table cannot prove an orphaned motor process does not exist.
// This module NEVER binds, terminates, adopts or starts a process.

#include <winsock2.h>   // MUST precede windows.h
#include <ws2tcpip.h>
#include <windows.h>
#include <iphlpapi.h>

#include "managed-listener-census.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr DWORD kMaximumTableBytes = 8 * 1024 * 1024;
constexpr DWORD kMaximumMatchingRows = 256;
constexpr unsigned kMaximumAttempts = 5;

uint64_t FileTimeAsTicks(const FILETIME& time) {
  ULARGE_INTEGER ticks{};
  ticks.LowPart = time.dwLowDateTime;
  ticks.HighPart = time.dwHighDateTime;
  return ticks.QuadPart;
}

bool ReservedOperationalPort(unsigned port) {
  return port == 8765 || port == 8768 || port == 8769 || port == 18765;
}

struct TableResult {
  bool ok = false;
  DWORD code = ERROR_SUCCESS;
  std::vector<BYTE> buffer;
};

// Read IPv4 and IPv6 separately, always using the *listener* owner PID table.
// Retry boundedly when Windows adds entries between size query and fill.
TableResult ReadListenerTable(ULONG family) {
  DWORD bytes = 0;
  DWORD code = GetExtendedTcpTable(
      nullptr, &bytes, FALSE, family, TCP_TABLE_OWNER_PID_LISTENER, 0);
  if (code != ERROR_INSUFFICIENT_BUFFER && code != NO_ERROR) {
    return {false, code, {}};
  }
  for (unsigned i = 0; i < kMaximumAttempts; ++i) {
    if (bytes < 128) bytes = 128;
    if (bytes > kMaximumTableBytes) return {false, ERROR_INSUFFICIENT_BUFFER, {}};
    std::vector<BYTE> data(bytes);
    DWORD actual = bytes;
    code = GetExtendedTcpTable(
        data.data(), &actual, FALSE, family, TCP_TABLE_OWNER_PID_LISTENER, 0);
    if (code == NO_ERROR) {
      if (actual > data.size()) return {false, ERROR_BAD_LENGTH, {}};
      data.resize(actual);
      return {true, NO_ERROR, std::move(data)};
    }
    if (code != ERROR_INSUFFICIENT_BUFFER) return {false, code, {}};
    bytes = actual > bytes ? actual : bytes * 2;
  }
  return {false, ERROR_INSUFFICIENT_BUFFER, {}};
}

Napi::Object ReadOwnerIdentity(Napi::Env env, DWORD pid, const char* family) {
  auto result = Napi::Object::New(env);
  result.Set("family", Napi::String::New(env, family));
  result.Set("pid", Napi::Number::New(env, static_cast<double>(pid)));
  result.Set("creationTimeTicks", env.Null());
  result.Set("executablePath", env.Null());
  result.Set("identityVerified", Napi::Boolean::New(env, false));

  if (pid == 0) return result;
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (process == nullptr) return result;

  FILETIME creation{}, exit{}, kernel{}, user{};
  bool timeValid = GetProcessTimes(process, &creation, &exit, &kernel, &user) != FALSE;

  // QueryFullProcessImageNameW is read-only; no token or user secret access.
  // The path must remain restricted to trusted Electron main/native code,
  // never exposed to renderer or copied to remote logs.
  std::wstring executable(32768, L'\0');
  DWORD chars = static_cast<DWORD>(executable.size());
  bool imageValid = QueryFullProcessImageNameW(
      process, 0, executable.data(), &chars) != FALSE;
  CloseHandle(process);

  if (timeValid) {
    result.Set("creationTimeTicks",
               Napi::String::New(env, std::to_string(FileTimeAsTicks(creation))));
  }
  if (imageValid && chars > 0 && chars < executable.size()) {
    executable.resize(chars);
    result.Set("executablePath", Napi::String::New(
        env, reinterpret_cast<const char16_t*>(executable.data()), executable.size()));
  } else {
    imageValid = false;
  }
  result.Set("identityVerified", Napi::Boolean::New(env, timeValid && imageValid));
  return result;
}

bool ReadIpv4Rows(const TableResult& table, unsigned port,
                  Napi::Env env, std::vector<Napi::Object>* rows) {
  const size_t start = offsetof(MIB_TCPTABLE_OWNER_PID, table);
  if (table.buffer.size() < start) return false;
  const auto* view =
      reinterpret_cast<const MIB_TCPTABLE_OWNER_PID*>(table.buffer.data());
  if (view->dwNumEntries > (table.buffer.size() - start) / sizeof(MIB_TCPROW_OWNER_PID)) {
    return false;
  }
  for (DWORD i = 0; i < view->dwNumEntries; ++i) {
    const auto& row = view->table[i];
    if (ntohs(static_cast<u_short>(row.dwLocalPort)) != port) continue;
    if (row.dwState != MIB_TCP_STATE_LISTEN || rows->size() >= kMaximumMatchingRows) {
      return false;
    }
    rows->push_back(ReadOwnerIdentity(env, row.dwOwningPid, "IPv4"));
  }
  return true;
}

bool ReadIpv6Rows(const TableResult& table, unsigned port,
                  Napi::Env env, std::vector<Napi::Object>* rows) {
  const size_t start = offsetof(MIB_TCP6TABLE_OWNER_PID, table);
  if (table.buffer.size() < start) return false;
  const auto* view =
      reinterpret_cast<const MIB_TCP6TABLE_OWNER_PID*>(table.buffer.data());
  if (view->dwNumEntries > (table.buffer.size() - start) / sizeof(MIB_TCP6ROW_OWNER_PID)) {
    return false;
  }
  for (DWORD i = 0; i < view->dwNumEntries; ++i) {
    const auto& row = view->table[i];
    if (ntohs(static_cast<u_short>(row.dwLocalPort)) != port) continue;
    if (row.dwState != MIB_TCP_STATE_LISTEN || rows->size() >= kMaximumMatchingRows) {
      return false;
    }
    rows->push_back(ReadOwnerIdentity(env, row.dwOwningPid, "IPv6"));
  }
  return true;
}

Napi::Value MakeUnknownCensus(Napi::Env env, unsigned port, const char* code) {
  auto result = Napi::Object::New(env);
  result.Set("status", Napi::String::New(env, "UNKNOWN"));
  result.Set("port", Napi::Number::New(env, port));
  result.Set("reason", Napi::String::New(env, code));
  result.Set("listeners", Napi::Array::New(env));
  return result;
}

}  // namespace

Napi::Value InspectManagedQaTcpListeners(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  if (info.Length() != 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "inspectManagedQaTcpListeners(port): number required")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const double candidate = info[0].As<Napi::Number>().DoubleValue();
  if (!std::isfinite(candidate) || std::floor(candidate) != candidate ||
      candidate < 1024 || candidate > 65535 ||
      ReservedOperationalPort(static_cast<unsigned>(candidate))) {
    Napi::RangeError::New(env, "Gate C3 QA only: non-reserved TCP port 1024..65535 required")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const unsigned port = static_cast<unsigned>(candidate);

  auto ipv4 = ReadListenerTable(AF_INET);
  auto ipv6 = ReadListenerTable(AF_INET6);
  if (!ipv4.ok || !ipv6.ok) return MakeUnknownCensus(env, port, "TCP_TABLE_UNAVAILABLE");

  std::vector<Napi::Object> rows;
  if (!ReadIpv4Rows(ipv4, port, env, &rows) ||
      !ReadIpv6Rows(ipv6, port, env, &rows)) {
    return MakeUnknownCensus(env, port, "TCP_TABLE_INCONSISTENT");
  }
  auto result = Napi::Object::New(env);
  result.Set("status", Napi::String::New(
      env, rows.empty() ? "NO_LISTENER" : "LISTENER_PRESENT"));
  result.Set("port", Napi::Number::New(env, port));
  auto listeners = Napi::Array::New(env, rows.size());
  for (uint32_t i = 0; i < rows.size(); ++i) listeners.Set(i, rows[i]);
  result.Set("listeners", listeners);
  return result;
}
