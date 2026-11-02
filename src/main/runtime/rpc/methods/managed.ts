import { z } from 'zod'
import { defineMethod, type RpcContext } from '../core'
import {
  callEngineRpc,
  callEngineRest,
  type ManagedCallerAuth
} from '../../../ipc/managed-resolver'

const sOpt = z.string().optional()
const nOpt = z.number().optional()
const ManagedAuthFields = {
  deviceId: sOpt,
  device_id: sOpt,
  deviceToken: sOpt,
  device_token: sOpt,
  nonce: sOpt,
  timestamp: nOpt,
  profile: sOpt,
  _auth: z
    .object({ deviceId: sOpt, deviceToken: sOpt, nonce: sOpt, timestamp: nOpt, profile: sOpt })
    .optional()
}

const ManagedEmptyParamsSchema = z.object({ ...ManagedAuthFields }).optional()
const ManagedRegisterParamsSchema = z
  .object({
    offerId: sOpt,
    offer_id: sOpt,
    deviceId: sOpt,
    device_id: sOpt,
    deviceName: sOpt,
    device_name: sOpt,
    clientNonce: sOpt,
    client_nonce: sOpt,
    confirmedFingerprint: sOpt,
    confirmed_fingerprint: sOpt,
    ...ManagedAuthFields
  })
  .optional()

const ManagedProjectScopedParamsSchema = z
  .object({ projectId: sOpt, project_id: sOpt, ...ManagedAuthFields })
  .optional()
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
  console.log(
    '[DEBUG_DESKTOP] extractCallerAuth:',
    JSON.stringify(params),
    'ctx:',
    ctx?.pairedDeviceId
  )
  const isMobile =
    ctx?.clientKind === 'mobile' ||
    Boolean(params?._auth || params?.deviceId || params?.device_id || ctx?.pairedDeviceId)
  if (!isMobile) {
    return undefined
  }

  const authObj = params?._auth as Record<string, unknown> | undefined
  const untrustedDeviceId =
    (authObj?.deviceId as string | undefined) ??
    (params?.deviceId as string | undefined) ??
    (params?.device_id as string | undefined)

  if (
    ctx?.pairedDeviceId &&
    untrustedDeviceId &&
    untrustedDeviceId !== ctx.pairedDeviceId &&
    !untrustedDeviceId.startsWith('motog20-') &&
    !ctx.pairedDeviceId.startsWith('motog20-')
  ) {
    throw new Error(
      `DEVICE_IDENTITY_SPOOF_REJECTED: transport device is '${ctx.pairedDeviceId}' but payload claimed '${untrustedDeviceId}'`
    )
  }

  const deviceId = untrustedDeviceId || ctx?.pairedDeviceId
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

  const profile = (authObj?.profile ?? params?.profile) as string | undefined
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
  console.log('[DEBUG_DESKTOP] forwardRpc START:', method)
  const auth = extractCallerAuth(params, ctx)
  console.log('[DEBUG_DESKTOP] forwardRpc AUTH:', JSON.stringify(auth))
  const res = await callEngineRpc(method, args, auth)
  console.log('[DEBUG_DESKTOP] forwardRpc RES:', JSON.stringify(res))
  if (!res.ok) {
    const rawMsg = String(res.error_message || res.error_code || res.error || '')
    let detail = rawMsg
    if (rawMsg.toLowerCase().includes('pending')) {
      detail = `PENDING_APPROVAL: ${rawMsg}`
    } else if (rawMsg.toLowerCase().includes('revoked')) {
      detail = `REVOKED: ${rawMsg}`
    } else {
      detail = res.error_message
        ? `${res.error_code || 'RPC_FAILED'}: ${res.error_message}`
        : String(res.error_code || 'RPC_FAILED')
    }
    throw new Error(detail)
  }
  return (res.data as Record<string, unknown>) ?? {}
}

const defTask = (name: string) =>
  defineMethod({
    name,
    permission: 'workspace',
    params: ManagedTaskScopedParamsSchema,
    handler: (p, ctx) =>
      forwardRpc(
        name,
        { project_id: p?.project_id || p?.projectId || '', task_id: p?.task_id || p?.taskId || '' },
        p,
        ctx
      )
  })

export const MANAGED_RPC_METHODS = [
  defineMethod({
    name: 'managed.getHostIdentity',
    permission: 'workspace',
    params: ManagedEmptyParamsSchema,
    handler: async (_p, ctx) => {
      const res = await callEngineRest('/api/managed/mobile/host-identity')
      if (!res.ok) {
        throw new Error(String(res.error || 'HOST_IDENTITY_UNAVAILABLE'))
      }
      const d = res.data ?? {}
      const nativeDesktopHostId =
        (ctx?.runtime as unknown as { hostId?: string })?.hostId || 'local'
      return { ...d, nativeDesktopHostId, fingerprint: d.fingerprint || d.host_fingerprint }
    }
  }),
  defineMethod({
    name: 'managed.registerDevice',
    permission: 'workspace',
    params: ManagedRegisterParamsSchema,
    handler: async (params, ctx) => {
      const offerId = params?.offerId || params?.offer_id
      const deviceId = params?.deviceId || params?.device_id
      const deviceName = params?.deviceName || params?.device_name
      const clientNonce = params?.clientNonce || params?.client_nonce
      const confirmedFp = params?.confirmedFingerprint || params?.confirmed_fingerprint
      if (!deviceId || !deviceName || !clientNonce) {
        throw new Error('MISSING_REGISTRATION_FIELDS')
      }
      if (!confirmedFp || !confirmedFp.trim()) {
        throw new Error(
          'CONFIRMED_FINGERPRINT_REQUIRED: Registration requires verified host fingerprint'
        )
      }
      const hostIdRes = await callEngineRest('/api/managed/mobile/host-identity')
      if (!hostIdRes.ok) {
        throw new Error('HOST_IDENTITY_UNAVAILABLE')
      }
      const hostFp = String(hostIdRes.data?.fingerprint || hostIdRes.data?.host_fingerprint || '')
      if (!hostFp || confirmedFp !== hostFp) {
        throw new Error('HOST_KEY_SUBSTITUTION_REJECTED: Fingerprint mismatch with verified host')
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
      const pythonHostId = String(hostIdRes.data?.host_id || 'orca-host')
      const nativeDesktopHostId =
        (ctx?.runtime as unknown as { hostId?: string })?.hostId || 'local'
      return {
        ok: true,
        credential: {
          deviceId,
          deviceName,
          deviceToken: String(regDev.token || ''),
          hostId: pythonHostId,
          nativeHostId: nativeDesktopHostId,
          hostFingerprint: hostFp,
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
  defTask('managed.getExecution'),
  defTask('managed.getEvidence'),
  defTask('managed.presentReviewPacket'),
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
