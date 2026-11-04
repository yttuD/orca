/**
 * ORCA-D02 Gate 9B-C4-C-A — presentation-only DTO for supervised recovery.
 *
 * An Electron renderer cannot authenticate a historical journal, live mutex,
 * Job Object, process, or a host-provided message. This parser intentionally
 * has NO authorization path and exposes no user-provided values, paths or
 * process IDs. Only fixed Spanish labels from explicit allowlists survive.
 */
type JsonObject = Record<string, unknown>
const object = (v: unknown): JsonObject | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? v as JsonObject
    : null

const HISTORICAL_REASON_LABELS = {
  HISTORICAL_JOURNAL_MISSING: 'Sin registro histórico verificable',
  HISTORICAL_JOURNAL_UNVERIFIABLE: 'Registro histórico inválido o inaccesible',
  PREVIOUS_OWNER_INTERRUPTED_OR_UNVERIFIED: 'Ejecución anterior interrumpida o sin verificar',
  CLEAN_STOP_HISTORY_UNATTESTED: 'Cierre previo declarado, sin autenticación histórica',
  JOURNAL_READER_REJECTED: 'No fue posible comprobar el directorio de diagnóstico'
} as const

const CURRENT_REASON_LABELS = {
  QA_ENVIRONMENT_NOT_ALLOWED: 'Entorno de pruebas no autorizado',
  INVALID_QA_IDENTITY: 'Identidad del proceso de pruebas inválida',
  QA_LISTENER_NOT_OWNED_OR_NOT_LOOPBACK: 'Listener local no verificado',
  NATIVE_SENSOR_UNAVAILABLE: 'Sensor nativo no disponible',
  NATIVE_LEASE_NOT_VERIFIED: 'Lease nativo no verificado',
  NATIVE_OWNER_PID_MISMATCH: 'Identidad del propietario no coincidente',
  NATIVE_LISTENER_UNVERIFIED_OR_MISMATCH: 'Listener e identidad no coinciden',
  NATIVE_RECORDED_PROCESS_UNVERIFIED: 'Proceso actual no verificado'
} as const

const MISSING_LABELS = {
  PREVIOUS_OWNER_AUTHENTICITY_NOT_ESTABLISHED: 'Autoría del propietario anterior',
  PREVIOUS_JOB_OBJECT_DESCENDANTS_NOT_CENSUSED: 'Descendientes del Job Object anterior',
  PREVIOUS_OWNER_JOURNAL_NOT_TRUSTED: 'Autenticidad del journal histórico',
  CURRENT_QA_OBSERVATION_UNKNOWN: 'Observación del proceso QA actual'
} as const

export type RecoveryPresentationModel = {
  readonly status: 'BLOCKED'
  readonly startupAllowed: false
  readonly heading: 'Recuperación supervisada'
  readonly source: 'NO_QA_PACKET' | 'QA_PACKET_UNATTESTED'
  readonly current: string
  readonly previous: string
  readonly missing: readonly string[]
  readonly footnote: string
}

function allowedLabel(
  source: unknown,
  lookup: Readonly<Record<string, string>>,
  fallback: string
): string {
  if (typeof source !== 'string' ||
      !Object.prototype.hasOwnProperty.call(lookup, source)) return fallback
  return lookup[source] ?? fallback
}

const DEFAULT_MISSING = [
  MISSING_LABELS.PREVIOUS_OWNER_AUTHENTICITY_NOT_ESTABLISHED,
  MISSING_LABELS.PREVIOUS_JOB_OBJECT_DESCENDANTS_NOT_CENSUSED,
  MISSING_LABELS.PREVIOUS_OWNER_JOURNAL_NOT_TRUSTED
] as const

/**
 * Even a forged packet with startupAllowed=true can never change the
 * BLOQUEADO label or expose paths/secrets to the UI.
 * A valid QA packet remains an UNATTESTED presentation claim.
 */
export function describeSupervisedRecoveryForRenderer(raw: unknown): RecoveryPresentationModel {
  const value = object(raw)
  const current = object(value?.currentInstance)
  const previous = object(value?.previousOwner)
  const valid =
    value?.state === 'BLOCKED' &&
    value.startupAllowed === false &&
    value.supervisorReviewRequired === true &&
    value.diagnosticsOnly === true &&
    previous?.state === 'UNVERIFIED' &&
    (current?.state === 'CURRENT_QA_PROCESS_ONLY' || current?.state === 'UNKNOWN')

  if (!valid) {
    return {
      status: 'BLOCKED',
      startupAllowed: false,
      heading: 'Recuperación supervisada',
      source: 'NO_QA_PACKET',
      current: 'Sin diagnóstico QA conectado',
      previous: 'Sin evidencia histórica autenticada',
      missing: DEFAULT_MISSING,
      footnote: 'Sin acceso a sensores reales. No hay autorización para reiniciar.'
    }
  }

  const live = current.state === 'CURRENT_QA_PROCESS_ONLY'
  const currentLabel = live
    ? 'Proceso QA actual observado; no demuestra ausencia de motores anteriores'
    : allowedLabel(
      current.reason,
      CURRENT_REASON_LABELS,
      'Observación del proceso QA no verificada'
    )
  const previousLabel = allowedLabel(
    previous.reason,
    HISTORICAL_REASON_LABELS,
    'Propietario histórico sin verificar'
  )

  // Every historic item remains missing. Optional fourth label is shown
  // only when the *current QA* process could not be observed.
  return {
    status: 'BLOCKED',
    startupAllowed: false,
    heading: 'Recuperación supervisada',
    source: 'QA_PACKET_UNATTESTED',
    current: currentLabel,
    previous: previousLabel,
    missing: live
      ? DEFAULT_MISSING
      : [...DEFAULT_MISSING, MISSING_LABELS.CURRENT_QA_OBSERVATION_UNKNOWN],
    footnote: 'Diagnóstico de pruebas sin atestación histórica. Requiere revisión técnica; no permite iniciar ni terminar motores.'
  }
}
