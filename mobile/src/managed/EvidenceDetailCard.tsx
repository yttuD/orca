import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import type { ManagedEvidenceDTO, ManagedTaskDTO } from './types'
import { styles } from './ManagedCenterView.styles'

type Props = {
  readonly selectedTask: ManagedTaskDTO
  readonly evidence: ManagedEvidenceDTO | null
  readonly onRequestPause?: (taskId: string) => void
  readonly onRequestStop?: (taskId: string) => void
}

export function EvidenceDetailCard({
  selectedTask,
  evidence,
  onRequestPause,
  onRequestStop
}: Props): React.JSX.Element {
  const renderPill = (txt: string, ok: boolean, warn: boolean) => (
    <View style={[styles.pill, { backgroundColor: ok ? '#064e3b' : warn ? '#78350f' : '#881337' }]}>
      <Text style={[styles.pillText, { color: ok ? '#34d399' : warn ? '#fbbf24' : '#fb7185' }]}>
        {txt}
      </Text>
    </View>
  )

  return (
    <View style={styles.detailCard}>
      <Text style={styles.detailCardTitle}>Detalle y Verificación</Text>
      <Text style={styles.detailCardSubtitle}>
        Tarea: {selectedTask.id} • Intento: {evidence?.attempt_id ?? 'ATT-001'}
      </Text>

      {evidence && (
        <View style={styles.badgesRow}>
          <View style={[styles.badge, styles.badgeAvailable]}>
            <Text style={styles.badgeText}>{evidence.evidence_status}</Text>
          </View>
          <View
            style={[
              styles.badge,
              evidence.provenance === 'AUTHENTIC'
                ? styles.badgeAuthentic
                : evidence.provenance === 'SYNTHETIC'
                  ? styles.badgeSynthetic
                  : styles.badgeUnverified
            ]}
          >
            <Text style={styles.badgeText}>{evidence.provenance}</Text>
          </View>
          <View
            style={[
              styles.badge,
              evidence.hash_status === 'VERIFIED' ? styles.badgeHashOk : styles.badgeHashFail
            ]}
          >
            <Text style={styles.badgeText}>
              {evidence.hash_status === 'VERIFIED' ? 'HASH OK' : 'HASH MISMATCH'}
            </Text>
          </View>
          {renderPill(
            evidence.certification_status,
            evidence.certification_status === 'CERTIFIED',
            evidence.certification_status === 'UNCERTIFIED'
          )}
        </View>
      )}

      {evidence && evidence.checks_summary.failed > 0 && (
        <View style={styles.failureCallout}>
          <Text style={styles.failureText}>
            Fallo de verificación: {evidence.checks_summary.failed} prueba(s) reportaron FAIL.
          </Text>
        </View>
      )}

      {evidence && evidence.checks.length > 0 ? (
        <View style={styles.checksContainer}>
          <Text style={styles.checksHeader}>
            Comprobaciones ({evidence.checks_summary.passed}/{evidence.checks_summary.total} PASS)
          </Text>
          {evidence.checks.map((c) => (
            <View key={c.name} style={styles.checkRow}>
              <Text style={styles.checkName}>{c.name}</Text>
              <Text
                style={[
                  styles.checkStatus,
                  c.status === 'PASS'
                    ? styles.checkPass
                    : c.status === 'FAIL'
                      ? styles.checkFail
                      : styles.checkOther
                ]}
              >
                {c.status}
                {c.exit_code !== null && c.exit_code !== undefined ? ` (${c.exit_code})` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.zeroChecksCallout}>
          <Text style={styles.zeroChecksText}>
            Sin comprobaciones registradas (Cero checks ejecutados).
          </Text>
        </View>
      )}

      {evidence && (
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Telemetría de Memoria:</Text>
          <Text style={styles.telemetryValue}>
            {evidence.memory_telemetry.status === 'MEASURED' &&
            evidence.memory_telemetry.peak_rss_bytes
              ? `${Math.round(evidence.memory_telemetry.peak_rss_bytes / 1024 / 1024)} MiB (Pico)`
              : 'NOT_MEASURED'}
          </Text>
        </View>
      )}

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtnPause, styles.actionBtnDisabled]}
          disabled={true}
          onPress={() => onRequestPause?.(selectedTask.id)}
        >
          <Text style={styles.actionBtnTextDisabled}>Pausa (Auditoría Pendiente)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtnStop, styles.actionBtnDisabled]}
          disabled={true}
          onPress={() => onRequestStop?.(selectedTask.id)}
        >
          <Text style={styles.actionBtnTextDisabled}>Detención (Auditoría Pendiente)</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
