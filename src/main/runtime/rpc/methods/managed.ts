import { z } from 'zod'
import { defineMethod, type RpcContext } from '../core'
import {
  callEngineRpc,
  callEngineRest,
  type ManagedCallerAuth
} from '../../../ipc/managed-resolver'

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
const ManagedRegisterParamsSchema = z
  .object({
    offerId: z.string().optional(),
    offer_id: z.string().optional(),
    deviceId: z.string().optional(),
    device_id: z.string().optional(),
    deviceName: z.string().optional(),
    device_name: z.string().optional(),
    clientNonce: z.string().optional(),
    client_nonce: z.string().optional(),
    confirmedFingerprint: z.string().optional(),
    confirmed_fingerprint: z.string().optional(),
    ...ManagedAuthFields
  })
  .optional()

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

async function forwardRpc(
  method: string,
  args: Record<string, unknown>,
  params: Record<string, unknown> | undefined,
  ctx?: RpcContext
): Promise<Record<string, unknown>> {
  const auth = extractCallerAuth(params, ctx)
  const res = await callEngineRpc(method, args, auth)
  if (!res.ok) {
    const detail = res.error_message
      ? `${res.error_code || 'RPC_FAILED'}: ${res.error_message}`
      : String(res.error_code || 'RPC_FAILED')
    throw new Error(detail)
  }
  return (res.data as Record<string, unknown>) ?? {}
}

export const MANAGED_RPC_METHODS = [
  defineMethod({
    name: 'managed.getHostIdentity',
    permission: 'workspace',
    params: ManagedEmptyParamsSchema,
    handler: async () => {
      const res = await callEngineRest('/api/managed/mobile/host-identity')
      if (!res.ok) {
        throw new Error(String(res.error || 'HOST_IDENTITY_UNAVAILABLE'))
      }
      const d = res.data ?? {}
      return { ...d, fingerprint: d.fingerprint || d.host_fingerprint }
    }
  }),
  defineMethod({
    name: 'managed.registerDevice',
    permission: 'workspace',
    params: ManagedRegisterParamsSchema,
    handler: async (params) => {
      const offerId = params?.offerId || params?.offer_id
      const deviceId = params?.deviceId || params?.device_id
      const deviceName = params?.deviceName || params?.device_name
      const clientNonce = params?.clientNonce || params?.client_nonce
      const confirmedFp = params?.confirmedFingerprint || params?.confirmed_fingerprint
      if (!deviceId || !deviceName || !clientNonce) {
        throw new Error('MISSING_REGISTRATION_FIELDS')
      }
      const hostIdRes = await callEngineRest('/api/managed/mobile/host-identity')
      const hostFp = String(hostIdRes.data?.fingerprint || hostIdRes.data?.host_fingerprint || '')
      if (confirmedFp && hostFp && confirmedFp !== hostFp) {
        throw new Error('FINGERPRINT_MISMATCH')
      }
      const regRes = await callEngineRest('/api/managed/mobile/register', {
        method: 'POST',
        body: {
          offer_id: offerId,
          device_id: deviceId,
          device_name: deviceName,
          client_nonce: clientNonce
        }
      })
      if (!regRes.ok) {
        throw new Error(String(regRes.data?.detail || regRes.error || 'REGISTRATION_FAILED'))
      }
      const regDev = (regRes.data?.device as Record<string, unknown>) || {}
      return {
        ok: true,
        credential: {
          deviceId,
          deviceName,
          deviceToken: String(regDev.token || ''),
          hostId: String(hostIdRes.data?.host_id || 'orca-host'),
          issuedAt: Date.now(),
          expiresAt:
            typeof regDev.expires_at === 'number'
              ? Math.floor(regDev.expires_at * 1000)
              : Date.now() + 86400000,
          role: 'MOBILE_READONLY',
          revoked: false,
          nonce: clientNonce,
          status: String(regDev.status || 'PENDING_APPROVAL')
        }
      }
    }
  }),
  defineMethod({
    name: 'managed.checkDeviceStatus',
    permission: 'workspace',
    params: ManagedEmptyParamsSchema,
    handler: async (params, ctx) => {
      try {
        const auth = extractCallerAuth(params, ctx)
        const res = await callEngineRpc('managed.listProjects', {}, auth)
        if (res.ok) {
          return { ok: true, status: 'AUTHORIZED' }
        }
        const msg = String(res.error_message || res.error_code || '')
        if (msg.includes('PENDING')) {
          return { ok: true, status: 'PENDING_APPROVAL' }
        }
        if (msg.includes('REVOKED')) {
          return { ok: true, status: 'REVOKED' }
        }
        return { ok: false, status: 'AUTH_REQUIRED', error: msg }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('PENDING')) {
          return { ok: true, status: 'PENDING_APPROVAL' }
        }
        if (msg.includes('REVOKED')) {
          return { ok: true, status: 'REVOKED' }
        }
        return { ok: false, status: 'AUTH_REQUIRED', error: msg }
      }
    }
  }),
  defineMethod({
    name: 'managed.listProjects',
    permission: 'workspace',
    params: ManagedEmptyParamsSchema,
    handler: (p, ctx) => forwardRpc('managed.listProjects', {}, p, ctx)
  }),
  defineMethod({
    name: 'managed.listTasks',
    permission: 'workspace',
    params: ManagedProjectScopedParamsSchema,
    handler: (p, ctx) =>
      forwardRpc('managed.listTasks', { project_id: p?.project_id || p?.projectId || '' }, p, ctx)
  }),
  defineMethod({
    name: 'managed.getExecution',
    permission: 'workspace',
    params: ManagedTaskScopedParamsSchema,
    handler: (p, ctx) =>
      forwardRpc(
        'managed.getExecution',
        { project_id: p?.project_id || p?.projectId || '', task_id: p?.task_id || p?.taskId || '' },
        p,
        ctx
      )
  }),
  defineMethod({
    name: 'managed.getEvidence',
    permission: 'workspace',
    params: ManagedTaskScopedParamsSchema,
    handler: (p, ctx) =>
      forwardRpc(
        'managed.getEvidence',
        { project_id: p?.project_id || p?.projectId || '', task_id: p?.task_id || p?.taskId || '' },
        p,
        ctx
      )
  }),
  defineMethod({
    name: 'managed.presentReviewPacket',
    permission: 'workspace',
    params: ManagedTaskScopedParamsSchema,
    handler: (p, ctx) =>
      forwardRpc(
        'managed.presentReviewPacket',
        { project_id: p?.project_id || p?.projectId || '', task_id: p?.task_id || p?.taskId || '' },
        p,
        ctx
      )
  }),
  defineMethod({
    name: 'managed.listActivity',
    permission: 'workspace',
    params: ManagedActivityParamsSchema,
    handler: (p, ctx) =>
      forwardRpc(
        'managed.listActivity',
        {
          project_id: p?.project_id || p?.projectId || '',
          task_id: p?.task_id || p?.taskId || '',
          limit: p?.limit,
          before_id: p?.before_id
        },
        p,
        ctx
      )
  })
]
