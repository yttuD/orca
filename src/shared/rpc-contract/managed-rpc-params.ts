import { z } from 'zod'

// Shared, optional read-only Managed RPC payload contract.
// Every caller's device credentials are checked in the runtime context.
export const ManagedRpcParams = z.record(z.string(), z.unknown()).optional()
