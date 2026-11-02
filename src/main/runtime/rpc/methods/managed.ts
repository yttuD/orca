import { z } from 'zod'
import { defineMethod } from '../core'
import { callEngineRpc } from '../../../ipc/managed-resolver'

const ManagedEmptyParamsSchema = z.object({}).optional()

const ManagedProjectScopedParamsSchema = z
  .object({
    projectId: z.string().optional(),
    project_id: z.string().optional()
  })
  .optional()

const ManagedTaskScopedParamsSchema = z.object({
  projectId: z.string().optional(),
  project_id: z.string().optional(),
  taskId: z.string().optional(),
  task_id: z.string().optional()
})

const ManagedActivityParamsSchema = z
  .object({
    projectId: z.string().optional(),
    project_id: z.string().optional(),
    taskId: z.string().optional(),
    task_id: z.string().optional(),
    limit: z.number().optional(),
    before_id: z.number().optional()
  })
  .optional()

export const MANAGED_RPC_METHODS = [
  defineMethod({
    name: 'managed.listProjects',
    permission: 'workspace',
    params: ManagedEmptyParamsSchema,
    handler: async () => {
      const res = await callEngineRpc('managed.listProjects', {})
      if (!res.ok) {
        throw new Error(String(res.error_message || res.error_code || 'RPC_FAILED'))
      }
      return res.data ?? {}
    }
  }),
  defineMethod({
    name: 'managed.listTasks',
    permission: 'workspace',
    params: ManagedProjectScopedParamsSchema,
    handler: async (params) => {
      const pId = params?.project_id || params?.projectId || ''
      const res = await callEngineRpc('managed.listTasks', { project_id: pId })
      if (!res.ok) {
        throw new Error(String(res.error_message || res.error_code || 'RPC_FAILED'))
      }
      return res.data ?? {}
    }
  }),
  defineMethod({
    name: 'managed.getExecution',
    permission: 'workspace',
    params: ManagedTaskScopedParamsSchema,
    handler: async (params) => {
      const pId = params?.project_id || params?.projectId || ''
      const tId = params?.task_id || params?.taskId || ''
      const res = await callEngineRpc('managed.getExecution', {
        project_id: pId,
        task_id: tId
      })
      if (!res.ok) {
        throw new Error(String(res.error_message || res.error_code || 'RPC_FAILED'))
      }
      return res.data ?? {}
    }
  }),
  defineMethod({
    name: 'managed.getEvidence',
    permission: 'workspace',
    params: ManagedTaskScopedParamsSchema,
    handler: async (params) => {
      const pId = params?.project_id || params?.projectId || ''
      const tId = params?.task_id || params?.taskId || ''
      const res = await callEngineRpc('managed.getEvidence', {
        project_id: pId,
        task_id: tId
      })
      if (!res.ok) {
        throw new Error(String(res.error_message || res.error_code || 'RPC_FAILED'))
      }
      return res.data ?? {}
    }
  }),
  defineMethod({
    name: 'managed.presentReviewPacket',
    permission: 'workspace',
    params: ManagedTaskScopedParamsSchema,
    handler: async (params) => {
      const pId = params?.project_id || params?.projectId || ''
      const tId = params?.task_id || params?.taskId || ''
      const res = await callEngineRpc('managed.presentReviewPacket', {
        project_id: pId,
        task_id: tId
      })
      if (!res.ok) {
        throw new Error(String(res.error_message || res.error_code || 'RPC_FAILED'))
      }
      return res.data ?? {}
    }
  }),
  defineMethod({
    name: 'managed.listActivity',
    permission: 'workspace',
    params: ManagedActivityParamsSchema,
    handler: async (params) => {
      const pId = params?.project_id || params?.projectId || ''
      const tId = params?.task_id || params?.taskId || ''
      const res = await callEngineRpc('managed.listActivity', {
        project_id: pId,
        task_id: tId,
        limit: params?.limit,
        before_id: params?.before_id
      })
      if (!res.ok) {
        throw new Error(String(res.error_message || res.error_code || 'RPC_FAILED'))
      }
      return res.data ?? {}
    }
  })
]
