/**
 * ORCA-D02 Gate 9B-C3-E-A: persisted, QA-ONLY owner telemetry.
 *
 * This is deliberately NOT a trusted operational journal. A SHA-256
 * checksum detects torn/accidental corruption, NOT malicious tampering,
 * rollback, or authenticity. A same-user attacker can replace BOTH bytes
 * and hash. Neither the loaded record nor this module may set
 * journalIntegrity='ATTESTED' in the operational admission contract.
 *
 * Every filesystem operation is limited to a newly created, first-level
 * temporary directory with prefix orca-gate9c3e-owner-, on Windows, while
 * running the isolated Orca QA checkout with explicit test opt-in.
 * No renderer/IPC export, FastAPI spawn, operational port or WCB access.
 */
import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { readPrivateWindowsFile, restrictWindowsPathSync } from '../../shared/secure-path-windows-acl'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'

export const GATE9C3E_QA_JOURNAL_NAME = 'owner-journal.qa.json'
const MAX_BYTES = 16 * 1024
const SHA256 = /^[a-f0-9]{64}$/
const FILETIME = /^[1-9][0-9]{11,19}$/
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const RootProcessSchema = z.object({
  pid: z.number().int().positive().max(4294967295),
  creationTimeTicks: z.string().regex(FILETIME)
}).strict()

const RecordSchema = z.object({
  version: z.literal(1),
  kind: z.literal('ORCA_GATE9C3E_SYNTHETIC_QA_ONLY'),
  motorIdentitySha256: z.string().regex(SHA256),
  generationId: z.string().regex(GUID),
  owner: RootProcessSchema,
  phase: z.enum(['PREPARING', 'JOB_ASSIGNED', 'CLEAN_STOP']),
  revision: z.number().int().positive().max(1_000_000),
  previousDigest: z.string().regex(SHA256).nullable(),
  jobRoot: RootProcessSchema.nullable(),
  observedActiveProcesses: z.number().int().nonnegative().max(65535).nullable(),
  recordedAt: z.iso.datetime({ offset: true })
}).strict()

export type QaOwnerJournalRecord = z.infer<typeof RecordSchema>

const EnvelopeSchema = z.object({
  payload: RecordSchema,
  digestSha256: z.string().regex(SHA256)
}).strict()

type ReadResult =
  | { readonly state: 'MISSING' }
  | { readonly state: 'CORRUPT_OR_UNREADABLE' }
  | {
      readonly state: 'QA_RECORD_UNATTESTED'
      readonly record: QaOwnerJournalRecord
      readonly digestSha256: string
    }

function digestRecord(record: QaOwnerJournalRecord): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex')
}

function validateShape(record: QaOwnerJournalRecord): QaOwnerJournalRecord {
  const validated = RecordSchema.parse(record)
  if (validated.phase === 'PREPARING') {
    if (validated.jobRoot !== null || validated.observedActiveProcesses !== null) {
      throw new Error('GATE9C3E_PREPARING_MUST_HAVE_NO_JOB')
    }
  } else {
    if (validated.jobRoot === null || validated.observedActiveProcesses === null) {
      throw new Error('GATE9C3E_JOB_PROOF_REQUIRED')
    }
    if (validated.phase === 'CLEAN_STOP' && validated.observedActiveProcesses !== 0) {
      throw new Error('GATE9C3E_CLEAN_STOP_REQUIRES_ZERO_PROCESSES')
    }
  }
  return validated
}

function assertQaRoot(root: string): string {
  if (process.platform !== 'win32' ||
      process.env.ORCA_GATE9C3E_TEST_ONLY !== '1' ||
      basename(process.cwd()).toLowerCase() !== 'orca' ||
      basename(dirname(process.cwd())).toLowerCase() !== 'orcastrator-desktop-qa') {
    throw new Error('GATE9C3E_ISOLATED_WINDOWS_QA_ONLY')
  }
  if (!isAbsolute(root) || !basename(root).toLowerCase().startsWith('orca-gate9c3e-owner-')) {
    throw new Error('GATE9C3E_ROOT_NOT_DISPOSABLE')
  }
  const metadata = lstatSync(root)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('GATE9C3E_ROOT_NOT_PRIVATE_DIRECTORY')
  }
  const actualRoot = realpathSync(root)
  if (dirname(actualRoot).toLowerCase() !== realpathSync(tmpdir()).toLowerCase()) {
    throw new Error('GATE9C3E_ROOT_OUTSIDE_TEMP')
  }
  if (!restrictWindowsPathSync(actualRoot, true)) {
    throw new Error('GATE9C3E_ROOT_ACL_UNVERIFIED')
  }
  return join(actualRoot, GATE9C3E_QA_JOURNAL_NAME)
}

function readJournalAt(path: string): ReadResult {
  try {
    const bytes = readPrivateWindowsFile(path, MAX_BYTES)
    if (bytes === null) return { state: 'MISSING' }
    const raw: unknown = JSON.parse(bytes.toString('utf8'))
    const envelope = EnvelopeSchema.parse(raw)
    validateShape(envelope.payload)
    if (digestRecord(envelope.payload) !== envelope.digestSha256) {
      return { state: 'CORRUPT_OR_UNREADABLE' }
    }
    return {
      state: 'QA_RECORD_UNATTESTED',
      record: envelope.payload,
      digestSha256: envelope.digestSha256
    }
  } catch {
    // Never collapse arbitrary errors to "missing"/"clean". An unknown
    // physical state means the operational recovery remains blocked.
    return { state: 'CORRUPT_OR_UNREADABLE' }
  }
}

/**
 * Read a synthetic QA record. A valid hash is an UNATTESTED observation,
 * NOT proof of previous owner or eligibility for operational recovery.
 */
export function readQaPreviousOwnerJournal(root: string): ReadResult {
  return readJournalAt(assertQaRoot(root))
}

/**
 * Durable QA-only publication. No file path escapes the isolated temp root.
 * This function has no authority to certify a clean shutdown, even when the
 * synthetic input says CLEAN_STOP.
 */
export function publishQaPreviousOwnerJournal(root: string, input: QaOwnerJournalRecord): {
  readonly state: 'QA_PERSISTED_UNATTESTED'
  readonly revision: number
} {
  const path = assertQaRoot(root)
  const record = validateShape(input)
  const earlier = readJournalAt(path)
  if (earlier.state === 'CORRUPT_OR_UNREADABLE') {
    throw new Error('GATE9C3E_EXISTING_JOURNAL_UNVERIFIABLE')
  }
  if (earlier.state === 'MISSING') {
    if (record.phase !== 'PREPARING' || record.revision !== 1 ||
        record.previousDigest !== null) {
      throw new Error('GATE9C3E_FIRST_RECORD_MUST_PREPARE')
    }
  } else {
    const prior = earlier.record
    if (record.motorIdentitySha256 !== prior.motorIdentitySha256 ||
        record.generationId !== prior.generationId ||
        record.owner.pid !== prior.owner.pid ||
        record.owner.creationTimeTicks !== prior.owner.creationTimeTicks) {
      throw new Error('GATE9C3E_PREVIOUS_OWNER_MISMATCH')
    }
    if (record.revision !== prior.revision + 1 ||
        record.previousDigest !== earlier.digestSha256) {
      throw new Error('GATE9C3E_REVISION_CHAIN_UNVERIFIED')
    }
    const allowed =
      (prior.phase === 'PREPARING' && record.phase === 'JOB_ASSIGNED') ||
      (prior.phase === 'JOB_ASSIGNED' && record.phase === 'CLEAN_STOP')
    if (!allowed) {
      throw new Error('GATE9C3E_PHASE_TRANSITION_DENIED')
    }
    if (prior.jobRoot !== null &&
        (record.jobRoot?.pid !== prior.jobRoot.pid ||
         record.jobRoot.creationTimeTicks !== prior.jobRoot.creationTimeTicks)) {
      throw new Error('GATE9C3E_JOB_ROOT_IDENTITY_CHANGED')
    }
  }

  const envelope = { payload: record, digestSha256: digestRecord(record) }
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > MAX_BYTES) {
    throw new Error('GATE9C3E_JOURNAL_OVERSIZE')
  }
  if (!writeDurableSecureJsonFile(path, envelope)) {
    throw new Error('GATE9C3E_JOURNAL_DACL_NOT_CONFIRMED')
  }
  // Deliberate "unattested" state. Do NOT feed this directly to C3-D.
  return { state: 'QA_PERSISTED_UNATTESTED', revision: record.revision }
}
