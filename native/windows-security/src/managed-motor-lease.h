#pragma once

#include <napi.h>

// Gate 9B-C2: private, QA-only interprocess ownership object.
// No process launch, no service adoption, no production authorization.
void InitializeManagedMotorLease(Napi::Env env);
Napi::Value AcquireManagedMotorLease(const Napi::CallbackInfo& info);
