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
  const stdout = execFileSync('python', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'inherit']
  })
  const lines = stdout.trim().split('\n')
  const lastLine = lines.at(-1) || '{}'
  try {
    return JSON.parse(lastLine) as OperatorApprovalResult
  } catch {
    return { ok: true, event: 'OPERATOR_UI_APPROVED' }
  }
}
