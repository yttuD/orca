import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'

export type SpawnedEngine = {
  process: ChildProcess
  opToken: string
  dataDir: string
  expectedFingerprint: string
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function spawnEngine(
  port: number,
  repoPath: string,
  dataDirOption?: string
): Promise<SpawnedEngine> {
  const engineDataDir = dataDirOption || resolve(tmpdir(), 'orca_e2e_engine_r3_data')
  const regPath = resolve(engineDataDir, 'authorized_mobile_devices.json')
  if (existsSync(regPath)) {
    try {
      const data = JSON.parse(readFileSync(regPath, 'utf-8'))
      data.devices = {}
      data.nonces = {}
      writeFileSync(regPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch {}
  }
  const pyProcess = spawn(
    'python',
    ['scripts/start_e2e_engine.py', '--port', String(port), '--data-dir', engineDataDir],
    {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        ORCA_HOST_SECRET_KEY: 'T1JDQV9URVNUX1NFRURfS0VZXzMyQllURVNfTEFCXzE='
      }
    }
  )

  let opToken = '',
    dataDir = '',
    activeProfFile = '',
    brTokenFile = ''

  await new Promise<void>((res, rej) => {
    pyProcess?.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.startsWith('ENGINE_READY:')) {
          const p = line.trim().split(':')
          opToken = p[3]
          dataDir = p[4]
          activeProfFile = p[5]
          brTokenFile = p[6]
          res()
        }
      }
    })
    pyProcess?.on('error', rej)
    pyProcess?.on('exit', (c) => {
      if (c !== 0) {
        rej(new Error(`Python exited with code ${c}`))
      }
    })
  })

  Object.assign(process.env, {
    MANAGED_PORT: String(port),
    MANAGED_ACTIVE_PROFILE_PATH: activeProfFile,
    MANAGED_BRIDGE_TOKEN_PATH: brTokenFile,
    MANAGED_PROFILE: 'NORMAL'
  })

  for (let i = 0; i < 40; i++) {
    try {
      const ping = await fetch(`http://127.0.0.1:${port}/api/csrf-token`)
      if (ping.ok) {
        break
      }
    } catch {
      await wait(150)
    }
  }

  const hostIdentRes = await fetch(`http://127.0.0.1:${port}/api/managed/mobile/host-identity`)
  const hostIdent = (await hostIdentRes.json()) as { host_fingerprint: string }

  return {
    process: pyProcess,
    opToken,
    dataDir,
    expectedFingerprint: hostIdent.host_fingerprint
  }
}
