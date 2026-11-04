#pragma once

#include <napi.h>

// Gate 9B native primitive, not an operational motor-start authorization.
// Creates an unnamed kill-on-close Job Object and a suspended process,
// assigns the process to the job BEFORE resuming its primary thread.
void InitializeManagedJobProcess(Napi::Env env);
Napi::Value SpawnManagedJobContained(const Napi::CallbackInfo& info);
