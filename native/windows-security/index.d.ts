/** Every call throws an Error whose message names the Win32 call and its error code. */

export type GrantAccessOptions = {
  /** Children inherit the grant (OI|CI). Only meaningful on a directory. */
  inheritable: boolean
  /**
   * SET_ACCESS: drop every explicit rule for the trustee, allow and deny, then grant exactly
   * `accessMask`. Otherwise GRANT_ACCESS: add `accessMask` to what the trustee is already allowed.
   */
  replace: boolean
}

/** The process token's user SID, e.g. `S-1-5-21-…-1001`. */
export declare function currentUserSid(): string

/**
 * One DACL entry as stored. `type` and `flags` are the raw ACE_HEADER bytes; `sid` is set only for
 * plain allow (0) and deny (1) ACEs and is null for every other type.
 */
export type WindowsAce = { type: number; flags: number; mask: number; sid: string | null }

/** `protected` is SE_DACL_PROTECTED. */
export type WindowsDacl = { protected: boolean; aces: WindowsAce[] }

/** The path's DACL as structure, or null for a NULL DACL (which grants everyone everything). */
export declare function getDaclAces(path: string): WindowsDacl | null

/**
 * Installs exactly the DACL in `sddl`. Its `P` flag picks protected or inheriting. A directory
 * propagates to every existing descendant, which is seconds on a large tree.
 */
export declare function setDaclSddl(path: string, sddl: string): void
export declare function setDaclSddlAsync(path: string, sddl: string): Promise<void>

/** Creates a NEW file already carrying the DACL in `sddl`, then writes `data` into it. */
export declare function createFileWithDacl(
  path: string,
  sddl: string,
  data: Uint8Array,
  strict?: boolean
): void

/** Read bounded regular-file bytes and their DACL through one handle, excluding writers/replacement. */
export declare function readFileWithDacl(
  path: string,
  maxBytes: number
): { data: Uint8Array; dacl: WindowsDacl | null } | null
/** Missing returns null; native read failures carry syscall='CredReadW' and numeric win32Code. */
export declare function readGenericCredential(target: string): Uint8Array | null
export declare function writeGenericCredential(target: string, user: string, data: Uint8Array): void

/**
 * Adds an allow rule for `sid` to the existing DACL, keeping its protection state; Windows orders
 * the result canonically. A NULL DACL already allows everyone, so it is left untouched.
 */
export declare function grantAccess(
  path: string,
  sid: string,
  accessMask: number,
  options: GrantAccessOptions
): void
export declare function grantAccessAsync(
  path: string,
  sid: string,
  accessMask: number,
  options: GrantAccessOptions
): Promise<void>

export type StdHandleInheritanceFailure = { stream: 'stdin' | 'stdout' | 'stderr'; code: number }

/**
 * Makes the process's std handles non-inheritable, skipping absent ones. Never throws; returns the
 * handles SetHandleInformation rejected (e.g. a legacy console pseudo-handle) with their Win32 code.
 */
export declare function clearStdHandleInheritance(): StdHandleInheritanceFailure[]

/**
 * `exitWatchError` is the Win32 code when the exit can't be observed; the child still runs.
 * `breakawayDenied`: a job this process is in forbids breakaway, so the child stays in it.
 */
export type IsolatedSpawnResult = {
  pid: number
  exitWatchError: number | null
  breakawayDenied: boolean
}

/**
 * Starts `file` detached, hidden and outside this process's jobs where they allow it, inheriting
 * only a NUL handle for its stdio, so none of this process's other inheritable handles reach it. `commandLine` is the full, already quoted line
 * (argv[0] included); an empty `cwd` keeps ours; `environmentBlock` is `K=V\0…\0\0`. `onExit` gets the exit code and never
 * keeps the event loop alive. Throws an Error naming the failed Win32 call.
 */
export declare function spawnDetachedIsolated(
  file: string,
  commandLine: string,
  cwd: string,
  environmentBlock: string,
  onExit: (code: number) => void
): IsolatedSpawnResult

/** Whether the resolved binary exports `name`; loads it, but calls nothing else. */
export declare function hasNativeExport(name: string): boolean

/** True on builds whose isolated spawn requests job breakaway; older binaries lack the export. */
export declare function isolatedSpawnBreaksAwayFromJob(): boolean


/** Opaque, native-owned process + private unnamed Win32 Job Object. */
export type ManagedJobContainedSnapshot = {
  readonly closed: boolean
  readonly pid: number
  /** Exact Win32 FILETIME ticks; never convert to JS Number. */
  readonly creationTimeTicks: string
  readonly rootRunning: boolean
  /** Includes root and all descendants still associated with this job. */
  readonly activeProcesses: number
}

/**
 * In this N-API object, the only job HANDLE is held by Electron.
 * close() is idempotent, kills the whole contained job and does not accept
 * any PID, process name or network port.
 */
export type ManagedJobContainedProcess = {
  snapshot(): ManagedJobContainedSnapshot
  close(): void
}

/**
 * SECURITY: Low-level primitive; NOT approval to launch an operational motor.
 * Caller must authenticate the operator and verify the file, environment,
 * profile, exclusive lease and host policy before using this in production.
 * Spawns suspended, assigns to private kill-on-close Job Object, then resumes.
 * environmentBlock: UTF-16 K=V\0...\0\0. Standard handles are NOT inherited.
 */
export declare function spawnManagedJobContained(
  file: string,
  commandLine: string,
  cwd: string,
  environmentBlock: string
): ManagedJobContainedProcess

/** Gate 9B-C2 only. Lease possession NEVER authorizes an operational motor start. */
export type ManagedMotorLeaseSnapshot = {
  readonly held: boolean
  readonly scope: 'MACHINE'
  readonly motorIdentitySha256: string
  readonly aclVerified: boolean
  /** Exact Win32 FILETIME ticks: string preserves 100ns precision. */
  readonly ownerCreationTimeTicks: string
  /** Requires independent, post-acquisition port/process/Job Object census. */
  readonly reconciliationRequired: true
}

export type ManagedMotorLeaseHandle = {
  snapshot(): ManagedMotorLeaseSnapshot
  /** Releases ONLY the owner's mutex; never kills or adopts processes. */
  close(): void
}

export type ManagedMotorLeaseAcquireResult =
  | { readonly state: 'HELD_BY_OTHER' }
  | {
      readonly state: 'ACQUIRED_REQUIRES_RECONCILIATION'
      readonly lease: ManagedMotorLeaseHandle
    }

/**
 * Windows-only: atomically claim a globally named QA lease keyed by a
 * trusted canonical lower-case SHA-256 identity. Existing objects block.
 * Requires verified ACL, no inheritable handle, and no wait/adoption.
 * NOT an operational start grant. The caller must own the resulting
 * opaque handle until all of its own Job Object processes are stopped.
 */
export declare function acquireManagedMotorLease(
  motorIdentitySha256: string
): ManagedMotorLeaseAcquireResult


/** C3-B, diagnostic QA only. Never expose executablePath to a renderer. */
export type ManagedQaListenerIdentity = {
  readonly family: 'IPv4' | 'IPv6'
  readonly pid: number
  /** Win32 process creation FILETIME ticks as decimal string, or null. */
  readonly creationTimeTicks: string | null
  /** Internal path returned by Windows; null if access denied or process exited. */
  readonly executablePath: string | null
  readonly identityVerified: boolean
}

export type ManagedQaListenerCensus =
  | {
      readonly status: 'NO_LISTENER' | 'LISTENER_PRESENT'
      readonly port: number
      readonly listeners: readonly ManagedQaListenerIdentity[]
    }
  | {
      readonly status: 'UNKNOWN'
      readonly port: number
      readonly reason: 'TCP_TABLE_UNAVAILABLE' | 'TCP_TABLE_INCONSISTENT'
      readonly listeners: readonly []
    }

/**
 * Windows-only read-only snapshot of IPv4 AND IPv6 listening TCP rows by PID.
 * Gate C3 test-only; rejects reserved operational/WCB ports.
 * This checks ONLY socket listeners: no result proves absence of an orphan
 * motor or Job Object. Keep the real lease and revalidate atomically at bind.
 * A returned UNKNOWN or identityVerified=false always blocks admission.
 */
export declare function inspectManagedQaTcpListeners(port: number): ManagedQaListenerCensus

/**
 * C3-C diagnostic QA only. Its input must eventually come from a trusted
 * previous-owner record (PID + exact creation FILETIME), not renderer state.
 * NOT_RUNNING, PID_REUSED and MATCH_EXITED do not prove all old descendants
 * or the previous Python motor's Job Object are gone.
 */
export type ManagedQaRecordedProcessObservation = {
  readonly status:
    | 'MATCH_RUNNING'
    | 'MATCH_EXITED'
    | 'PID_REUSED'
    | 'NOT_RUNNING'
    | 'UNKNOWN'
  readonly pid: number
  readonly actualCreationTimeTicks: string | null
  /** Diagnostic only; keep in trusted main/native, never renderer/logs. */
  readonly executablePath: string | null
  readonly reason?:
    | 'OPEN_PROCESS_UNVERIFIED'
    | 'PROCESS_TIME_UNVERIFIED'
    | 'PROCESS_STATE_UNVERIFIED'
    | 'EXECUTABLE_UNVERIFIED'
}

/** Read-only Windows PID+creation-time identity observation. Never kills. */
export declare function inspectManagedQaRecordedProcess(
  pid: number,
  expectedCreationTimeTicks: string
): ManagedQaRecordedProcessObservation
