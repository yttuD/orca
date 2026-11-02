import React, { useState, useEffect } from 'react'
import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import type {
  ManagedEvidenceDTO,
  ManagedProjectDTO,
  ManagedTaskDTO,
  MobileConnectionStatus,
  ManagedDataProvider
} from './types'
import {
  SYNTHETIC_MANAGED_PROJECTS,
  SYNTHETIC_MANAGED_TASKS,
  SYNTHETIC_MANAGED_EVIDENCE
} from './fixtures'
import { styles } from './ManagedCenterView.styles'
import { EvidenceDetailCard } from './EvidenceDetailCard'

type Props = {
  readonly connectionStatus?: MobileConnectionStatus
  readonly deviceName?: string
  readonly deviceId?: string
  readonly dataProvider?: ManagedDataProvider
  readonly isDemo?: boolean
  readonly onBack?: () => void
  readonly onPairPress?: () => void
  readonly onRequestPause?: (taskId: string) => void
  readonly onRequestStop?: (taskId: string) => void
}

export function ManagedCenterView({
  connectionStatus = 'UNPAIRED',
  deviceName = 'Pixel 8 Pro (Simulado)',
  deviceId = 'dev-android-8921',
  dataProvider,
  isDemo = false,
  onBack,
  onPairPress,
  onRequestPause,
  onRequestStop
}: Props): React.JSX.Element {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [selectedTaskId, setSelectedTaskId] = useState<string>('')
  const [projects, setProjects] = useState<readonly ManagedProjectDTO[]>([])
  const [tasks, setTasks] = useState<readonly ManagedTaskDTO[]>([])
  const [evidence, setEvidence] = useState<ManagedEvidenceDTO | null>(null)
  const [errorState, setErrorState] = useState<string | null>(null)

  useEffect(() => {
    if (connectionStatus !== 'ONLINE') {
      setProjects([])
      setTasks([])
      setEvidence(null)
      setSelectedProjectId('')
      setSelectedTaskId('')
      if (connectionStatus === 'PENDING_APPROVAL') {
        setErrorState('Esperando autorización del operador en Windows...')
      } else {
        setErrorState(`Conexión no disponible: ${connectionStatus}`)
      }
      return
    }

    if (!dataProvider) {
      if (isDemo) {
        setProjects(SYNTHETIC_MANAGED_PROJECTS)
        setSelectedProjectId(SYNTHETIC_MANAGED_PROJECTS[0]?.id ?? '')
        setErrorState(null)
      } else {
        setProjects([])
        setSelectedProjectId('')
        setErrorState('Sin proveedor de datos configurado')
      }
      return
    }

    let active = true
    dataProvider
      .listProjects()
      .then((p) => {
        if (!active) {
          return
        }
        setProjects(p)
        setErrorState(null)
        if (p[0]) {
          setSelectedProjectId(p[0].id)
        }
      })
      .catch((e) => {
        if (!active) {
          return
        }
        setProjects([])
        setTasks([])
        setEvidence(null)
        setErrorState(String(e?.message || e))
      })
    return () => {
      active = false
    }
  }, [dataProvider, connectionStatus, isDemo])

  useEffect(() => {
    if (connectionStatus !== 'ONLINE' || !selectedProjectId) {
      setTasks([])
      setSelectedTaskId('')
      return
    }

    if (!dataProvider) {
      if (isDemo) {
        const syn = SYNTHETIC_MANAGED_TASKS[selectedProjectId] ?? []
        setTasks(syn)
        setSelectedTaskId(syn[0]?.id ?? '')
      } else {
        setTasks([])
        setSelectedTaskId('')
      }
      return
    }

    let active = true
    dataProvider
      .listTasks(selectedProjectId)
      .then((t) => {
        if (active) {
          setTasks(t)
          if (t[0]) {
            setSelectedTaskId(t[0].id)
          }
        }
      })
      .catch(() => {
        if (active) {
          setTasks([])
        }
      })
    return () => {
      active = false
    }
  }, [dataProvider, connectionStatus, selectedProjectId, isDemo])

  useEffect(() => {
    if (connectionStatus !== 'ONLINE' || !selectedTaskId) {
      setEvidence(null)
      return
    }

    if (!dataProvider) {
      if (isDemo) {
        setEvidence(SYNTHETIC_MANAGED_EVIDENCE[selectedTaskId] ?? null)
      } else {
        setEvidence(null)
      }
      return
    }

    let active = true
    dataProvider
      .getEvidence(selectedProjectId, selectedTaskId)
      .then((ev) => {
        if (active) {
          setEvidence(ev)
        }
      })
      .catch(() => {
        if (active) {
          setEvidence(null)
        }
      })
    return () => {
      active = false
    }
  }, [dataProvider, connectionStatus, selectedProjectId, selectedTaskId, isDemo])

  const selectedTask = tasks.find((t) => t.id === selectedTaskId)
  const isSynthetic = isDemo || !dataProvider || evidence?.is_synthetic

  const renderPill = (txt: string, ok: boolean, warn: boolean) => (
    <View style={[styles.pill, { backgroundColor: ok ? '#064e3b' : warn ? '#78350f' : '#881337' }]}>
      <Text style={[styles.pillText, { color: ok ? '#34d399' : warn ? '#fbbf24' : '#fb7185' }]}>
        {txt}
      </Text>
    </View>
  )

  return (
    <ScrollView style={styles.container}>
      <View style={[styles.syntheticBanner, !isSynthetic && { backgroundColor: '#064e3b' }]}>
        <Text style={[styles.syntheticBannerText, !isSynthetic && { color: '#34d399' }]}>
          {isSynthetic
            ? 'DEMO / DATOS SINTÉTICOS — Modo Simulación Android'
            : 'SESIÓN AUTÉNTICA — Conectado a Host'}
        </Text>
      </View>

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
          {renderPill(
            connectionStatus,
            connectionStatus === 'ONLINE',
            connectionStatus === 'UNPAIRED' || connectionStatus === 'AUTH_REQUIRED'
          )}
          <Text style={styles.roleLabel}>Solo Lectura</Text>
        </View>
      </View>

      {connectionStatus !== 'ONLINE' && (
        <View style={styles.alertBanner}>
          <Text style={styles.alertText}>
            {errorState ?? 'Dispositivo no emparejado o sin autorización activa del host.'}
          </Text>
          {onPairPress && (
            <TouchableOpacity style={styles.pairButton} onPress={onPairPress}>
              <Text style={styles.pairButtonText}>Iniciar Pairing LAN Seguro</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Text style={styles.sectionHeader}>Proyectos Registrados ({projects.length})</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
        {projects.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={[styles.chip, p.id === selectedProjectId && styles.chipSelected]}
            onPress={() => setSelectedProjectId(p.id)}
          >
            <Text style={[styles.chipText, p.id === selectedProjectId && styles.chipTextSelected]}>
              {p.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.sectionHeader}>Tareas ({tasks.length})</Text>
      <View style={styles.taskList}>
        {tasks.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.taskCard, t.id === selectedTaskId && styles.taskCardSelected]}
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
        ))}
      </View>

      {selectedTask && (
        <EvidenceDetailCard
          selectedTask={selectedTask}
          evidence={evidence}
          onRequestPause={onRequestPause}
          onRequestStop={onRequestStop}
        />
      )}
    </ScrollView>
  )
}
