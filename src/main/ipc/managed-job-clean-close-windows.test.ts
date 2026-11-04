import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadWindowsSecurity } from '../../shared/windows-security-addon'
import type { ManagedJobContainedProcess } from '../../../native/windows-security'

// ORCA-D02 Gate 9B-C3-E-C. Only privately owned, newly spawned synthetic
// Node workers in disposable TEMP directories. No operational motor,
// system service, WCB, privileged port or process enumeration.
const windowsOnly = process.platform === 'win32' ? describe : describe.skip

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitUntil(predicate: () => boolean, timeoutMs = 12000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('GATE9C3EC_SYNTHETIC_JOB_TIMEOUT')
    }
    await wait(100)
  }
}

function environmentBlock(): string {
  const keys = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'Path', 'PATHEXT']
  return keys.flatMap((key) =>
    process.env[key] ? [key + '=' + process.env[key]] : []
  ).join('\0') + '\0\0'
}

function quote(input: string): string {
  if (input.includes('"') || input.includes('\0')) {
    throw new Error('GATE9C3EC_UNSAFE_QA_EXECUTABLE')
  }
  return '"' + input + '"'
}

async function syntheticJob(
  source: string,
  run: (job: ManagedJobContainedProcess) => Promise<void>
): Promise<void> {
  const loaded = loadWindowsSecurity()
  if ('error' in loaded) throw new Error('GATE9C3EC_ADDON_UNAVAILABLE')
  const root = mkdtempSync(path.join(tmpdir(), 'orca-gate9c3ec-job-'))
  const script = path.join(root, 'qa-synthetic-worker.cjs')
  let job: ManagedJobContainedProcess | null = null
  try {
    writeFileSync(script, source, { flag: 'wx' })
    job = loaded.addon.spawnManagedJobContained(
      process.execPath,
      quote(process.execPath) + ' ' + quote(script),
      root,
      environmentBlock()
    )
    await run(job)
  } finally {
    // Explicit close affects ONLY the Job Object containing the QA child we
    // created through this exact handle; never a PID found in the host.
    job?.close()
    await waitUntil(() => {
      try {
        rmSync(root, { recursive: true, force: true })
        return true
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY') return false
        throw error
      }
    }, 8000)
  }
}

windowsOnly('Gate 9B-C3-E-C private Job Object clean close witness', () => {
  it('closes only when the original synthetic root exited AND native job accounting is empty', async () => {
    await syntheticJob('process.exit(0)', async (job) => {
      await waitUntil(() => {
        const snap = job.snapshot()
        return !snap.rootRunning && snap.activeProcesses === 0
      })
      const prior = job.snapshot()
      expect(prior.closed).toBe(false)
      const proof = job.closeIfEmptyForQa()
      expect(proof).toEqual({
        state: 'CLOSED_EMPTY_QA_ONLY',
        pid: prior.pid,
        creationTimeTicks: prior.creationTimeTicks,
        observedActiveProcesses: 0,
        rootExitedBeforeClose: true,
        notHistoricalAttestation: true
      })
      expect(job.snapshot().closed).toBe(true)
      expect(job.closeIfEmptyForQa()).toEqual({ state: 'ALREADY_CLOSED' })
    })
  }, 20000)

  it('refuses to close a private job while its synthetic root is running', async () => {
    await syntheticJob('setInterval(() => {}, 1000)', async (job) => {
      await waitUntil(() => job.snapshot().rootRunning)
      expect(job.closeIfEmptyForQa()).toEqual({ state: 'ROOT_STILL_RUNNING' })
      expect(job.snapshot()).toMatchObject({
        closed: false,
        rootRunning: true
      })
    })
  }, 20000)

  it('refuses clean-close when the root exits but a synthetic descendant remains alive', async () => {
    const worker = [
      "const { spawn } = require('node:child_process')",
      "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],",
      "  { stdio: 'ignore', windowsHide: true })",
      "process.exit(0)"
    ].join('\n')
    await syntheticJob(worker, async (job) => {
      await waitUntil(() => {
        const snap = job.snapshot()
        return !snap.rootRunning && snap.activeProcesses >= 1
      })
      expect(job.closeIfEmptyForQa()).toEqual({ state: 'DESCENDANTS_STILL_RUNNING' })
      expect(job.snapshot().closed).toBe(false)
      expect(job.snapshot().activeProcesses).toBeGreaterThanOrEqual(1)
    })
  }, 20000)
})
