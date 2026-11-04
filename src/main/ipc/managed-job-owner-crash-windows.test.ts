import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Gate 9B-C: an isolated synthetic Node owner (NOT Electron, WCB or Python)
// is forcibly terminated. Its owned Windows Job Object MUST then terminate
// both a synthetic Node root and its synthetic Node grandchild.
//
// No port binding, token, PID-based kill or operational motor is used.
// Even if the test fails, all synthetic processes have a 25s self-expiry.
const onlyWindows = process.platform === 'win32' ? describe : describe.skip

type OwnerEvidence = {
  parentPid: number
  jobRootPid: number
  jobRootCreationTimeTicks: string
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitUntil(check: () => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('GATE9C_TIMEOUT')
    }
    await sleep(100)
  }
}

function isRunning(pid: number): boolean {
  try {
    // Signal 0 is observation, NOT a kill.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function safeOwnerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ORCA_GATE9C_TEST_ONLY: '1' }
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'Path', 'PATHEXT']) {
    if (process.env[name]) env[name] = process.env[name]
  }
  return env
}

function stopOwnOwner(parent: ChildProcess): void {
  // This handle is returned directly by our own spawn(), never inferred
  // from a PID, port or a process enumeration.
  if (parent.exitCode === null && parent.signalCode === null) {
    parent.kill()
  }
}

onlyWindows('Gate 9B-C: native Job Object survives supervisor crash', () => {
  it('terminates child and grandchild after the owner dies without calling job.close()', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'orca-gate9c-'))
    const worker = path.join(root, 'synthetic-worker.cjs')
    const ownerFile = path.join(root, 'owner.json')
    const grandchildFile = path.join(root, 'grandchild.pid')
    writeFileSync(worker, [
      "'use strict'",
      "const fs = require('node:fs')",
      "const { spawn } = require('node:child_process')",
      "const grandchild = spawn(process.execPath,",
      "  ['-e', 'setTimeout(() => process.exit(0), 25000)'],",
      "  { stdio: 'ignore', windowsHide: true })",
      "fs.writeFileSync(process.argv[2], String(grandchild.pid), {flag:'wx'})",
      "setTimeout(() => process.exit(0), 25000)"
    ].join('\n'))

    const ownerHelper = path.resolve(
      process.cwd(), 'tests', 'fixtures', 'orca-gate9c-job-owner.cjs'
    )
    expect(existsSync(ownerHelper)).toBe(true)

    const owner = spawn(process.execPath, [ownerHelper, root], {
      cwd: process.cwd(),
      env: safeOwnerEnv(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore']
    })
    // Another process using the *same* executable, but never assigned to
    // the private job, must survive the synthetic owner's forced exit.
    const independent = spawn(process.execPath, [
      '-e', 'setTimeout(() => process.exit(0), 25000)'
    ], {
      env: safeOwnerEnv(),
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    })
    try {
      await waitUntil(() => existsSync(ownerFile) && existsSync(grandchildFile))
      const evidence = JSON.parse(readFileSync(ownerFile, 'utf8')) as OwnerEvidence
      const grandchildPid = Number(readFileSync(grandchildFile, 'utf8'))
      expect(evidence.parentPid).toBe(owner.pid)
      expect(evidence.jobRootPid).toBeGreaterThan(0)
      expect(evidence.jobRootCreationTimeTicks).toMatch(/^[0-9]{12,}$/)
      expect(Number.isSafeInteger(grandchildPid) && grandchildPid > 0).toBe(true)
      expect(isRunning(evidence.jobRootPid)).toBe(true)
      expect(isRunning(grandchildPid)).toBe(true)
      expect(independent.pid).toBeGreaterThan(0)
      expect(isRunning(independent.pid!)).toBe(true)

      // Kill ONLY the synthetic owner via its own ChildProcess handle.
      // No explicit job.close() is invoked by that parent.
      stopOwnOwner(owner)
      await waitUntil(
        () => owner.exitCode !== null || owner.signalCode !== null,
        8000
      )
      await waitUntil(
        () => !isRunning(evidence.jobRootPid) && !isRunning(grandchildPid),
        8000
      )
      expect(isRunning(independent.pid!)).toBe(true)
    } finally {
      stopOwnOwner(owner)
      stopOwnOwner(independent)
      rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 })
    }
  }, 20000)
})
