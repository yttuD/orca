import { spawn, execFileSync, type ChildProcess } from 'node:child_process'

export class AdbError extends Error {
  constructor(
    message: string,
    public readonly command: string[],
    public readonly output: string
  ) {
    super(message)
    this.name = 'AdbError'
  }
}

export function execAdb(args: string[], options: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync('adb', args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (error: unknown) {
    const err = error as { status?: number; stdout?: string; stderr?: string }
    const out = `${err.stdout || ''}\n${err.stderr || ''}`.trim()
    if (options.allowFail) {
      return out
    }
    throw new AdbError(`ADB command failed [${args.join(' ')}]: ${out}`, args, out)
  }
}

export function isScreenTextPresent(text: string): boolean {
  try {
    execAdb(['shell', 'rm', '-f', '/sdcard/dump_check.xml'], { allowFail: true })
    const out = execAdb(['shell', 'uiautomator', 'dump', '/sdcard/dump_check.xml'], {
      allowFail: true
    })
    if (!out.includes('dumped to:')) {
      return false
    }
    const xml = execAdb(['shell', 'cat', '/sdcard/dump_check.xml'], { allowFail: true })
    return xml.includes(text)
  } catch {
    return false
  }
}

export function tapScreenText(text: string): boolean {
  try {
    execAdb(['shell', 'rm', '-f', '/sdcard/dump_check.xml'], { allowFail: true })
    const out = execAdb(['shell', 'uiautomator', 'dump', '/sdcard/dump_check.xml'], {
      allowFail: true
    })
    if (!out.includes('dumped to:')) {
      return false
    }
    const xml = execAdb(['shell', 'cat', '/sdcard/dump_check.xml'], { allowFail: true })
    const esc = text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
    const re = new RegExp(
      `(?:text|content-desc)="[^"]*${esc}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`
    )
    const match = re.exec(xml)
    if (!match) {
      return false
    }
    const x = Math.round((Number.parseInt(match[1], 10) + Number.parseInt(match[3], 10)) / 2)
    const y = Math.round((Number.parseInt(match[2], 10) + Number.parseInt(match[4], 10)) / 2)
    execAdb(['shell', 'input', 'tap', String(x), String(y)])
    return true
  } catch {
    return false
  }
}

export async function waitForScreenText(text: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (isScreenTextPresent(text)) {
      console.log(`  --> UI detected text: "${text}"`)
      return
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`Timed out waiting for UI element: "${text}"`)
}

export function captureScreen(filename: string, destinationDir: string): void {
  execAdb(['shell', 'screencap', '-p', `/sdcard/${filename}`])
  execAdb(['pull', `/sdcard/${filename}`, `${destinationDir}/${filename}`])
  execAdb(['shell', 'rm', `/sdcard/${filename}`], { allowFail: true })
  console.log(`  --> Screenshot saved: ${filename}`)
}

export function startScreenRecording(devicePath = '/sdcard/moto-g20-r2-flow.mp4'): ChildProcess {
  execAdb(['shell', 'rm', '-f', devicePath], { allowFail: true })
  return spawn(
    'adb',
    ['shell', 'screenrecord', '--size', '720x1600', '--time-limit', '180', devicePath],
    {
      stdio: 'ignore'
    }
  )
}

export async function stopScreenRecording(
  recordProcess: ChildProcess,
  destinationPath: string,
  devicePath = '/sdcard/moto-g20-r2-flow.mp4'
): Promise<void> {
  try {
    recordProcess.kill('SIGINT')
  } catch {
    // Process might already have exited
  }
  execAdb(['shell', 'pkill', '-2', 'screenrecord'], { allowFail: true })
  await new Promise((r) => setTimeout(r, 2000))
  execAdb(['pull', devicePath, destinationPath])
  execAdb(['shell', 'rm', '-f', devicePath], { allowFail: true })
  console.log(`  --> Screen recording pulled: ${destinationPath}`)
}
