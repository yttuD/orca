import { z } from 'zod'
import { defineMethod, type RpcContext } from '../core'
import { callEngineRpc, type ManagedCallerAuth } from '../../../ipc/managed-resolver'

const ManagedAuthFields = {
  deviceId: z.string().optional(),
  device_id: z.string().optional(),
  deviceToken: z.string().optional(),
  device_token: z.string().optional(),
  nonce: z.string().optional(),
  timestamp: z.number().optional(),
  profile: z.string().optional(),
  _auth: z
    .object({
      deviceId: z.string().optional(),
      deviceToken: z.string().optional(),
      nonce: z.string().optional(),
      timestamp: z.number().optional(),
      profile: z.string().optional()
    })
    .optional()
}

const ManagedEmptyParamsSchema = z.object({ ...ManagedAuthFields }).optional()

const ManagedProjectScopedParamsSchema = z
  .object({
    projectId: z.string().optional(),
    project_id: z.string().optional(),
    ...ManagedAuthFields
  })
  .optional()

const ManagedTaskScopedParamsSchema = z.object({
  projectId: z.string().optional(),
  project_id: z.string().optional(),
  taskId: z.string().optional(),
  task_id: z.string().optional(),
  ...ManagedAuthFields
})

const ManagedActivityParamsSchema = z
  .object({
    projectId: z.string().optional(),
    project_id: z.string().optional(),
    taskId: z.string().optional(),
    task_id: z.string().optional(),
    limit: z.number().optional(),
    before_id: z.number().optional(),
    ...ManagedAuthFields
  })
  .optional()

function extractCallerAuth(
  params: Record<string, unknown> | undefined,
  ctx?: RpcContext
): ManagedCallerAuth | undefined {
  const isMobile =
    ctx?.clientKind === 'mobile' ||
    Boolean(params?._auth) ||
    Boolean(params?.deviceId) ||
    Boolean(params?.device_id) ||
    Boolean(ctx?.pairedDeviceId)

  if (!isMobile) {
    return undefined
  }

  const authObj = params?._auth as Record<string, unknown> | undefined
  const untrustedDeviceId =
    (authObj?.deviceId as string | undefined) ??
    (params?.deviceId as string | undefined) ??
    (params?.device_id as string | undefined)

  if (ctx?.pairedDeviceId && untrustedDeviceId && untrustedDeviceId !== ctx.pairedDeviceId) {
    throw new Error(
      `DEVICE_IDENTITY_SPOOF_REJECTED: transport device is '${ctx.pairedDeviceId}' but payload claimed '${untrustedDeviceId}'`
    )
  }

  const deviceId = ctx?.pairedDeviceId || untrustedDeviceId
  const deviceToken = authObj?.deviceToken
    ? String(authObj.deviceToken)
    : params?.deviceToken
      ? String(params.deviceToken)
      : params?.device_token
        ? String(params.device_token)
        : null

  const nonce = authObj?.nonce ? String(authObj.nonce) : params?.nonce ? String(params.nonce) : null

  const rawTs = authObj?.timestamp ?? params?.timestamp
  const timestamp = typeof rawTs === 'number' ? rawTs : null

  if (!deviceId || !deviceToken || !nonce || timestamp === null) {
    throw new Error('INCOMPLETE_AUTHENTICATION_METADATA')
  }

  const profile =
    (authObj?.profile as string | undefined) ?? (params?.profile as string | undefined)

  return {
    surface: 'mobile',
    deviceId,
    deviceToken,
    nonce,
    timestamp,
    ...(profile ? { profile } : {})
  }
}

export const MANAGED_RPC_METHODS = [
  defineMethod({
    name: 'managed.listProjects',
    permission: 'workspace',
    params: ManagedEmptyParamsSchema,
    handler: async (params, ctx) => {
      const auth = extractCallerAuth(params, ctx)
      const res = await callEngineRpc('managed.listProjects', {}, auth)
      if (!res.ok) {
        throw new Error(String(res.error_code || res.error_message || 'RPC_FAILED'))
      }
      return res.data ?? {}
    }
  }),
  defineMethod({
    name: 'managed.listTasks',
    permission: 'workspace',
    params: ManagedProjectScopedParamsSchema,
    handler: async (params, ctx) => {
      const auth = extractCallerAuth(params, ctx)
      const pId = params?.project_id || params?.projectId || ''
      const res = await callEngineRpc('managed.listTasks', { project_id: pId }, auth)
      if (!res.ok) {
        throw new Error(String(res.error_code || res.error_message || 'RPC_FAILED'))
      }
      return res.data ?? {}
    }
  }),
  defineMethod({
    name: 'managed.getExecution',
    permission: 'workspace',
    params: ManagedTaskScopedParamsSchema,
    handler: async (params, ctx) => {
      const auth = extractCallerAuth(params, ctx)
      const pId = params?.project_id || params?.projectId || ''
      const tId = params?.task_id || params?.taskId || ''
      const res = await callEngineRpc(
        'managed.getExecution',
        { project_id: pId, task_id: tId },
        auth
      )
      if (!res.ok) {
        throw new Error(String(res.error_code || res.error_message || 'RPC_FAILED'))
      }
      return res.data ?? {}
    }
  }),
  defineMethod({
    name: 'managed.getEvidence',
    permission: 'workspace',
    params: ManagedTaskScopedParamsSchema,
    handler: async (params, ctx) => {
      const auth = extractCallerAuth(params, ctx)
      const pId = params?.project_id || params?.projectId || ''
      const tId = params?.task_id || params?.taskId || ''
      const res = await callEngineRpc(
        'managed.getEvidence',
        { project_id: pId, task_id: tId },
        auth
      )
      if (!res.ok) {
        throw new Error(String(res.error_code || res.error_message || 'RPC_FAILED'))
      }
      return res.data ?? {}
    }
  }),
  defineMethod({
    name: 'managed.presentReviewPacket',
    permission: 'workspace',
    params: ManagedTaskScopedParamsSchema,
    handler: async (params, ctx) => {
      const auth = extractCallerAuth(params, ctx)
      const pId = params?.project_id || params?.projectId || ''
      const tId = params?.task_id || params?.taskId || ''
      const res = await callEngineRpc(
        'managed.presentReviewPacket',
        { project_id: pId, task_id: tId },
        auth
      )
      if (!res.ok) {
        throw new Error(String(res.error_code || res.error_message || 'RPC_FAILED'))
      }
      return res.data ?? {}
    }
  }),
  defineMethod({
    name: 'managed.listActivity',
    permission: 'workspace',
    params: ManagedActivityParamsSchema,
    handler: async (params, ctx) => {
      const auth = extractCallerAuth(params, ctx)
      const pId = params?.project_id || params?.projectId || ''
      const tId = params?.task_id || params?.taskId || ''
      const res = await callEngineRpc(
        'managed.listActivity',
        {
          project_id: pId,
          task_id: tId,
          limit: params?.limit,
          before_id: params?.before_id
        },
        auth
      )
      if (!res.ok) {
        throw new Error(String(res.error_code || res.error_message || 'RPC_FAILED'))
      }
      return res.data ?? {}
    }
  })
]
