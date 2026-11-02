import React, { useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import type {
  ManagedEvidenceDTO,
  ManagedExecutionDTO,
  ManagedCertificationStatus,
  MobileConnectionStatus
} from './types'
import {
  SYNTHETIC_MANAGED_PROJECTS,
  SYNTHETIC_MANAGED_TASKS,
  SYNTHETIC_MANAGED_EXECUTIONS,
  SYNTHETIC_MANAGED_EVIDENCE
} from './fixtures'
import { styles } from './ManagedCenterView.styles'

type Props = {
  readonly connectionStatus?: MobileConnectionStatus
  readonly deviceName?: string
  readonly deviceId?: string
  readonly onBack?: () => void
  readonly onPairPress?: () => void
  readonly onRequestPause?: (taskId: string) => void
  readonly onRequestStop?: (taskId: string) => void
}

export function ManagedCenterView({
  connectionStatus = 'UNPAIRED',
  deviceName = 'Pixel 8 Pro (Simulado)',
  deviceId = 'dev-android-8921',
  onBack,
  onPairPress,
  onRequestPause,
  onRequestStop
}: Props): React.JSX.Element {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    SYNTHETIC_MANAGED_PROJECTS[0]?.id ?? ''
  )
  const [selectedTaskId, setSelectedTaskId] = useState<string>(
    SYNTHETIC_MANAGED_TASKS[selectedProjectId]?.[0]?.id ?? ''
  )

  const projects = SYNTHETIC_MANAGED_PROJECTS
  const tasks = SYNTHETIC_MANAGED_TASKS[selectedProjectId] ?? []
  const selectedTask = tasks.find((t) => t.id === selectedTaskId)
  const execution: ManagedExecutionDTO | undefined = selectedTaskId
    ? SYNTHETIC_MANAGED_EXECUTIONS[selectedTaskId]
    : undefined
  const evidence: ManagedEvidenceDTO | undefined = selectedTaskId
    ? SYNTHETIC_MANAGED_EVIDENCE[selectedTaskId]
    : undefined

  const renderStatusPill = (status: MobileConnectionStatus) => {
    let bg = '#27272a'
    let text = '#a1a1aa'
    if (status === 'ONLINE') {
      bg = '#064e3b'
      text = '#34d399'
    } else if (status === 'UNPAIRED' || status === 'AUTH_REQUIRED') {
      bg = '#78350f'
      text = '#fbbf24'
    } else if (status === 'OFFLINE' || status === 'REVOKED') {
      bg = '#881337'
      text = '#fb7185'
    }
    return (
      <View style={[styles.pill, { backgroundColor: bg }]}>
        <Text style={[styles.pillText, { color: text }]}>{status}</Text>
      </View>
    )
  }

  const renderCertPill = (cert: ManagedCertificationStatus) => {
    let bg = '#27272a'
    let text = '#a1a1aa'
    if (cert === 'CERTIFIED') {
      bg = '#064e3b'
      text = '#34d399'
    } else if (cert === 'REJECTED') {
      bg = '#881337'
      text = '#fb7185'
    } else {
      bg = '#451a03'
      text = '#f59e0b'
    }
    return (
      <View style={[styles.pill, { backgroundColor: bg }]}>
        <Text style={[styles.pillText, { color: text }]}>{cert}</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container}>
      {/* Permanent Synthetic / Demo Fixtures Banner */}
      <View style={styles.syntheticBanner}>
        <Text style={styles.syntheticBannerText}>
          DEMO / DATOS SINTÉTICOS — Modo Simulación Android
        </Text>
      </View>

      {/* Header bar */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {onBack && (
            <TouchableOpacity style={styles.backButton} onPress={onBack}>
              <Text style={styles.backButtonText}>← Volver</Text>
            </TouchableOpacity>
          )}
          <View>
            <Text style={styles.title}>Centro Managed (Android)</Text>
            <Text style={styles.subtitle}>
              {deviceName} • {deviceId}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {renderStatusPill(connectionStatus)}
          <Text style={styles.roleLabel}>Solo Lectura</Text>
        </View>
      </View>

      {/* Unpaired or auth banner */}
      {connectionStatus !== 'ONLINE' && (
        <View style={styles.alertBanner}>
          <Text style={styles.alertText}>
            Dispositivo no emparejado o sin autorización activa del host.
          </Text>
          {onPairPress && (
            <TouchableOpacity style={styles.pairButton} onPress={onPairPress}>
              <Text style={styles.pairButtonText}>Iniciar Pairing LAN Seguro</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Projects Horizontal Chip List */}
      <Text style={styles.sectionHeader}>Proyectos Registrados</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
        {projects.map((p) => {
          const isSelected = p.id === selectedProjectId
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.chip, isSelected && styles.chipSelected]}
              onPress={() => {
                setSelectedProjectId(p.id)
                const firstTask = SYNTHETIC_MANAGED_TASKS[p.id]?.[0]?.id
                if (firstTask) {
                  setSelectedTaskId(firstTask)
                }
              }}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{p.name}</Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* Tasks List */}
      <Text style={styles.sectionHeader}>Tareas ({tasks.length})</Text>
      <View style={styles.taskList}>
        {tasks.map((t) => {
          const isSelected = t.id === selectedTaskId
          return (
            <TouchableOpacity
              key={t.id}
              style={[styles.taskCard, isSelected && styles.taskCardSelected]}
              onPress={() => setSelectedTaskId(t.id)}
            >
              <View style={styles.taskCardHeader}>
                <Text style={styles.taskTitle}>{t.title}</Text>
                <Text style={styles.taskStatus}>{t.status}</Text>
              </View>
              <Text style={styles.taskExecutor}>
                {t.id} • {t.executor}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Task Details & Evidence Card */}
      {selectedTask && (
        <View style={styles.detailCard}>
          <Text style={styles.detailCardTitle}>Detalle y Verificación</Text>
          <Text style={styles.detailCardSubtitle}>
            Tarea: {selectedTask.id} • Intento: {execution?.attempt_id ?? 'ATT-001'}
          </Text>

          {/* Badges row */}
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
              {renderCertPill(evidence.certification_status)}
            </View>
          )}

          {/* Alert Callout */}
          {evidence && evidence.checks_summary.failed > 0 && (
            <View style={styles.failureCallout}>
              <Text style={styles.failureText}>
                Fallo de verificación: {evidence.checks_summary.failed} prueba(s) reportaron FAIL.
              </Text>
            </View>
          )}

          {/* Checks list */}
          {evidence && evidence.checks.length > 0 ? (
            <View style={styles.checksContainer}>
              <Text style={styles.checksHeader}>
                Comprobaciones ({evidence.checks_summary.passed}/{evidence.checks_summary.total}{' '}
                PASS)
              </Text>
              {evidence.checks.map((c, i) => (
                <View key={i} style={styles.checkRow}>
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

          {/* Telemetry info */}
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

          {/* Action buttons (Requests disabled pending independent audit) */}
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
      )}
    </ScrollView>
  )
}
