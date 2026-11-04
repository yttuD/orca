import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 12000,
  describeState?: () => string
): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      // A failure must preserve the actual Job Object state, rather than
      // assuming Windows lost the child or the native close method failed.
      throw new Error(
        'GATE9C3EC_SYNTHETIC_JOB_TIMEOUT' +
        (describeState ? ': ' + describeState() : '')
      )
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
  run: (job: ManagedJobContainedProcess, root: string) => Promise<void>
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
    await run(job, root)
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
    // Handshake: the test must first witness TWO members of its own Job
    // Object. Exiting immediately after spawn() races with Windows process
    // startup and can leave no descendant to test. This gate does not
    // infer membership from a PID or adopt an unrelated process.
    // Node/libuv on Windows places NON-detached children in a second,
    // internal kill-on-parent-exit Job Object. That previously killed our
    // synthetic descendant when its root exited, even though Orcastrator's
    // own Job Object handle remained open (activeProcesses became zero).
    // Using detached + unref avoids Node's *internal* Job Object while
    // remaining in the outer non-breakaway Orcastrator Job Object.
    const grandchildSource = [
      "const fs = require('node:fs')",
      "const path = require('node:path')",
      "fs.writeFileSync(path.join(process.cwd(), 'grandchild-ready'),",
      "  String(process.pid), { flag: 'wx' })",
      "setInterval(() => {}, 250)"
    ].join('\n')
    const worker = [
      "const fs = require('node:fs')",
      "const path = require('node:path')",
      "const { spawn } = require('node:child_process')",
      `const grandchildSource = ${JSON.stringify(grandchildSource)}`,
      "const child = spawn(process.execPath, ['-e', grandchildSource],",
      "  { detached: true, stdio: 'ignore', windowsHide: true })",
      "child.once('error', () => process.exit(11))",
      "child.unref()",
      "const allowExit = path.join(process.cwd(), 'allow-synthetic-root-exit')",
      "setInterval(() => {",
      "  if (fs.existsSync(allowExit)) process.exit(0)",
      "}, 25)"
    ].join('\n')
    await syntheticJob(worker, async (job, root) => {
      // Before root exit, require both a real child-startup marker and
      // accounting of TWO members inside the original native Job Object.
      await waitUntil(() => {
        const snap = job.snapshot()
        return existsSync(path.join(root, 'grandchild-ready')) &&
          snap.rootRunning && snap.activeProcesses >= 2
      }, 12000, () => JSON.stringify(job.snapshot()))
      // Reject a transient count from a grandchild that immediately died.
      await wait(250)
      expect(job.snapshot().rootRunning).toBe(true)
      expect(job.snapshot().activeProcesses).toBeGreaterThanOrEqual(2)

      // We signal ONLY the disposable root created in this same test.
      writeFileSync(path.join(root, 'allow-synthetic-root-exit'), 'exit', {
        flag: 'wx'
      })
      await waitUntil(() => {
        const snap = job.snapshot()
        return !snap.rootRunning && snap.activeProcesses >= 1
      }, 12000, () => JSON.stringify(job.snapshot()))

      expect(job.closeIfEmptyForQa()).toEqual({ state: 'DESCENDANTS_STILL_RUNNING' })
      expect(job.snapshot()).toMatchObject({ closed: false, rootRunning: false })
      expect(job.snapshot().activeProcesses).toBeGreaterThanOrEqual(1)
    })
  }, 20000)
})
