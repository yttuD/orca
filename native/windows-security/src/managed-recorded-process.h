#pragma once
#include <napi.h>

// ORCA-D02 Gate 9B-C3-C. Read-only check of a *recorded* Windows PID
// against the owner's exact FILETIME creation ticks. No enumeration or kill.
Napi::Value InspectManagedQaRecordedProcess(const Napi::CallbackInfo& info);
