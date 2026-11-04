/**
 * ORCA-D02 Gate 9B-C4-B2-A — read-only Win32 *current own QA process*
 * observation, NEVER an old-motor recovery qualification.
 *
 * Trusted inputs must be retained opaque handles created by this process:
 * a native mutex lease and a Node net.Server already listening on an
 * ephemeral 127.0.0.1 port. This function never creates a socket, mutex,
 * process or filesystem entry. It only queries native Windows ownership,
 * the current test PID+FILETIME and the listener owned by that SAME PID.
 *
 * Absence of an old motor/tree/Job Object is NOT measured. Even a successful
 * probe returns BLOCKED, startupAllowed:false and historicalProof:false.
 * No IPC/renderer wiring. Absolute executable paths returned by the native
 * addon are deliberately never exposed in this report.
 */
import { Server } from 'node:net'
import { basename, dirname } from 'node:path'
import { loadWindowsSecurity } from '../../shared/windows-security-addon'
import type { ManagedMotorLeaseHandle } from '../../../native/windows-security'

const HASH = /^[a-f0-9]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RESERVED = new Set([8765, 8768, 8769, 18765])

export type QaNativeSelfObservationReason =
  | 'QA_ENVIRONMENT_NOT_ALLOWED'
  | 'INVALID_QA_IDENTITY'
  | 'QA_LISTENER_NOT_OWNED_OR_NOT_LOOPBACK'
  | 'NATIVE_SENSOR_UNAVAILABLE'
  | 'NATIVE_LEASE_NOT_VERIFIED'
  | 'NATIVE_OWNER_PID_MISMATCH'
  | 'NATIVE_LISTENER_UNVERIFIED_OR_MISMATCH'
  | 'NATIVE_RECORDED_PROCESS_UNVERIFIED'

export type QaNativeSelfObservation =
  | {
      readonly status: 'BLOCKED'
      readonly startupAllowed: false
      readonly historicalProof: false
      readonly observationKind: 'UNKNOWN'
      readonly reason: QaNativeSelfObservationReason
    }
  | {
      readonly status: 'BLOCKED'
      readonly startupAllowed: false
      readonly historicalProof: false
      readonly observationKind: 'CURRENT_QA_PROCESS_ONLY'
      readonly observationRecordedAtMs: number
      readonly lease: 'LIVE_NATIVE_HANDLE_OBSERVED'
      readonly listener: 'OWN_LOOPBACK_LISTENER_PRESENT'
      readonly recordedProcess: 'OWN_PROCESS_MATCH_RUNNING'
      readonly owner: {
        readonly generationId: string
        readonly pid: number
        /** Exact Win32 FILETIME ticks, not a JS number. */
        readonly creationTimeTicks: string
      }
      readonly port: number
    }

function denied(reason: QaNativeSelfObservationReason): QaNativeSelfObservation {
  return {
    status: 'BLOCKED',
    startupAllowed: false,
    historicalProof: false,
    observationKind: 'UNKNOWN',
    reason
  }
}

/**
 * Inputs with forged JS fields are never sufficient to authorize anything.
 * The native addon validates the opaque mutex's real tagged HANDLE; each
 * process and TCP read is made AFTER that owner verification, synchronously.
 * As with all live checks, a process can change state after this snapshot.
 */
export function inspectCurrentQaProcessUnderNativeLease(
  lease: ManagedMotorLeaseHandle,
  motorIdentitySha256: string,
  generationId: string,
  ownServer: Server
): QaNativeSelfObservation {
  if (process.platform !== 'win32' ||
      process.env.ORCA_GATE9C4B2_TEST_ONLY !== '1' ||
      basename(process.cwd()).toLowerCase() !== 'orca' ||
      basename(dirname(process.cwd())).toLowerCase() !== 'orcastrator-desktop-qa') {
    return denied('QA_ENVIRONMENT_NOT_ALLOWED')
  }
  if (!HASH.test(motorIdentitySha256) || !UUID.test(generationId)) {
    return denied('INVALID_QA_IDENTITY')
  }
  // Accept ONLY a live, already-owned Node loopback listener. Never accept
  // an arbitrary port passed from renderer, config, environment or journal.
  if (!(ownServer instanceof Server) || !ownServer.listening) {
    return denied('QA_LISTENER_NOT_OWNED_OR_NOT_LOOPBACK')
  }
  const address = ownServer.address()
  if (!address || typeof address === 'string' ||
      address.address !== '127.0.0.1' || address.family !== 'IPv4' ||
      !Number.isInteger(address.port) || address.port < 1024 ||
      RESERVED.has(address.port)) {
    return denied('QA_LISTENER_NOT_OWNED_OR_NOT_LOOPBACK')
  }

  const loaded = loadWindowsSecurity()
  if ('error' in loaded ||
      !loaded.addon.hasNativeExport('verifyManagedMotorLeaseOwnerForQa') ||
      !loaded.addon.hasNativeExport('inspectManagedQaTcpListeners') ||
      !loaded.addon.hasNativeExport('inspectManagedQaRecordedProcess')) {
    return denied('NATIVE_SENSOR_UNAVAILABLE')
  }
  const addon = loaded.addon
  try {
    const proof = addon.verifyManagedMotorLeaseOwnerForQa(lease, motorIdentitySha256)
    if (!proof.verified) return denied('NATIVE_LEASE_NOT_VERIFIED')
    if (proof.ownerPid !== process.pid) return denied('NATIVE_OWNER_PID_MISMATCH')

    // Actual kernel-provided TCP listener PID and creation FILETIME.
    const tcp = addon.inspectManagedQaTcpListeners(address.port)
    if (tcp.status !== 'LISTENER_PRESENT' || tcp.listeners.length !== 1) {
      return denied('NATIVE_LISTENER_UNVERIFIED_OR_MISMATCH')
    }
    const listener = tcp.listeners[0]
    if (listener.pid !== proof.ownerPid || !listener.identityVerified ||
        listener.creationTimeTicks !== proof.ownerCreationTimeTicks) {
      return denied('NATIVE_LISTENER_UNVERIFIED_OR_MISMATCH')
    }

    // Inspect ONLY our OWN process PID, bound to creation FILETIME obtained
    // from a native opaque lease, not a journal, remote payload or renderer.
    const observed = addon.inspectManagedQaRecordedProcess(
      proof.ownerPid, proof.ownerCreationTimeTicks
    )
    if (observed.status !== 'MATCH_RUNNING' ||
        observed.actualCreationTimeTicks !== proof.ownerCreationTimeTicks) {
      return denied('NATIVE_RECORDED_PROCESS_UNVERIFIED')
    }
    // Re-check ownership after all observations, still within one
    // synchronous JS call. Never claim historic provenance from this.
    const post = addon.verifyManagedMotorLeaseOwnerForQa(lease, motorIdentitySha256)
    if (!post.verified || post.ownerPid !== proof.ownerPid ||
        post.ownerCreationTimeTicks !== proof.ownerCreationTimeTicks) {
      return denied('NATIVE_LEASE_NOT_VERIFIED')
    }
    return {
      status: 'BLOCKED',
      startupAllowed: false,
      historicalProof: false,
      observationKind: 'CURRENT_QA_PROCESS_ONLY',
      observationRecordedAtMs: Date.now(),
      lease: 'LIVE_NATIVE_HANDLE_OBSERVED',
      listener: 'OWN_LOOPBACK_LISTENER_PRESENT',
      recordedProcess: 'OWN_PROCESS_MATCH_RUNNING',
      owner: {
        generationId,
        pid: proof.ownerPid,
        creationTimeTicks: proof.ownerCreationTimeTicks
      },
      port: address.port
    }
  } catch {
    // Missing native privileges, short-lived port races or other kernel
    // errors are UNKNOWN, never proof of no previous motor.
    return denied('NATIVE_SENSOR_UNAVAILABLE')
  }
}
