#pragma once

#include <napi.h>

// Gate 9B-C3-B — read-only Windows TCP listener snapshot for QA.
// Never creates sockets, launches/kills processes or grants admission.
Napi::Value InspectManagedQaTcpListeners(const Napi::CallbackInfo& info);
