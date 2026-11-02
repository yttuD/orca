import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

export type OperatorApprovalResult = {
  ok: boolean
  event: string
}

export function executeWindowsOperatorApproval(params: {
  port: number
  token: string
  deviceId?: string
  outputDir: string
}): OperatorApprovalResult {
  const driverScript = resolve(__dirname, 'operator_panel_driver.py')
  const args = [
    driverScript,
    '--port',
    String(params.port),
    '--token',
    params.token,
    '--output-dir',
    params.outputDir
  ]
  if (params.deviceId) {
    args.push('--device-id', params.deviceId)
  }
  try {
    const stdout = execFileSync('python', args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const lines = stdout.trim().split('\n')
    const lastLine = lines.at(-1) || '{}'
    const parsed = JSON.parse(lastLine) as OperatorApprovalResult
    if (!parsed || typeof parsed.ok !== 'boolean') {
      return { ok: false, event: 'OPERATOR_UI_INVALID_OUTPUT' }
    }
    return parsed
  } catch (err) {
    return { ok: false, event: `OPERATOR_UI_EXEC_FAILED: ${String(err)}` }
  }
}
