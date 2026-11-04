import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadWindowsSecurity } from '../../shared/windows-security-addon'

// Gate 9B: No operational motor, no ports, no Git/WCB credentials, no PID kill.
// Only a synthetic Node root and its synthetic child are created.
const windowsOnly = process.platform === 'win32' ? describe : describe.skip

function environmentBlock(): string {
  const keys = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'Path', 'PATHEXT']
  const entries = keys.flatMap((key) => {
    const value = process.env[key]
    return value ? [key + '=' + value] : []
  })
  return entries.join('\0') + '\0\0'
}

function commandArgument(value: string): string {
  if (value.includes('"') || value.includes('\0')) {
    throw new Error('GATE9B_UNSAFE_TEST_ARG')
  }
  return '"' + value + '"'
}

async function waitUntil(check: () => boolean, timeoutMs = 15000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('GATE9B_NATIVE_TIMEOUT')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function processExists(pid: number): boolean {
  try {
    // Signal 0 checks existence ONLY; never kill a process by PID.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

windowsOnly('Gate 9B native private Job Object containment', () => {
  it('compiled native export holds root and descendant until private job closes', async () => {
    const loaded = loadWindowsSecurity()
    if ('error' in loaded) throw new Error('GATE9B_NATIVE_ADDON_LOAD_FAILED')
    expect(loaded.addon.hasNativeExport('spawnManagedJobContained')).toBe(true)

    const root = mkdtempSync(path.join(tmpdir(), 'orca-gate9b-native-'))
    const script = path.join(root, 'synthetic-root.cjs')
    const marker = path.join(root, 'child-pid.txt')
    writeFileSync(script, [
      "const fs = require('node:fs')",
      "const { spawn } = require('node:child_process')",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],",
      "  { stdio: 'ignore', windowsHide: true })",
      "fs.writeFileSync(process.argv[2], String(child.pid))",
      "setInterval(() => {}, 1000)"
    ].join('\n'))

    let job: ReturnType<typeof loaded.addon.spawnManagedJobContained> | null = null
    let grandchildPid: number | null = null
    try {
      job = loaded.addon.spawnManagedJobContained(
        process.execPath,
        [commandArgument(process.execPath), commandArgument(script), commandArgument(marker)].join(' '),
        root,
        environmentBlock()
      )
      const snapshot = job.snapshot()
      expect(snapshot.closed).toBe(false)
      expect(snapshot.pid).toBeGreaterThan(0)
      expect(snapshot.creationTimeTicks).toMatch(/^[0-9]{12,}$/)
      expect(snapshot.rootRunning).toBe(true)

      await waitUntil(() => existsSync(marker))
      grandchildPid = Number(readFileSync(marker, 'utf8'))
      expect(Number.isSafeInteger(grandchildPid) && grandchildPid > 0).toBe(true)

      await waitUntil(() => job!.snapshot().activeProcesses >= 2)
      expect(processExists(grandchildPid)).toBe(true)

      // Closing the private handle terminates root AND descendants.
      // No PID enumeration or termination is used by the implementation.
      job.close()
      job.close() // idempotent
      expect(job.snapshot()).toMatchObject({
        closed: true, rootRunning: false, activeProcesses: 0
      })
      await waitUntil(() => !processExists(snapshot.pid) && !processExists(grandchildPid!))
    } finally {
      job?.close()
      rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 })
    }
  }, 25000)

  it('rejects malformed environment before process creation', () => {
    const loaded = loadWindowsSecurity()
    if ('error' in loaded) throw new Error('GATE9B_NATIVE_ADDON_LOAD_FAILED')
    expect(() => loaded.addon.spawnManagedJobContained(
      process.execPath,
      commandArgument(process.execPath),
      tmpdir(),
      'BAD_BLOCK'
    )).toThrow()
  })
})
