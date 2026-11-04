# ADR-016 — Gate 9A: supervisor de FastAPI propiedad del Desktop (solo QA)

Fecha: 2026-11-04
Estado: GATE 9A PASS EN WINDOWS (2026-11-04); GATE 9B NO IMPLEMENTADO

## Contexto

Gate 6 (7/7 PASS) validó el Managed RPC FastAPI con SQLite temporal.
Gate 7 (1/1 PASS) validó el circuito Electron → IPC → HTTP → FastAPI real,
pero el motor era lanzado por Playwright y no por Electron. Gate 8 dio
10/10 pruebas unitarias PASS; el motor operativo en 8765 no tenía listener
en el momento de la inspección. No existe autorización para iniciar,
reemplazar o usar credenciales de un motor operativo arbitrario.

## Decisión

Agregar `ManagedQaEngineSupervisor` en `src/main/ipc/`, de propiedad
**exclusiva del proceso principal Electron**, con autoarranque restringido
a pruebas Windows ocultas y opt-in explícito:

- `ORCA_E2E_HEADLESS=1`
- `ORCA_MANAGED_QA_AUTOSTART=1`
- Checkout `ORCASTRATOR-DESKTOP-QA/orca` y `motor` hermano
- Python fijo `.venv-motor-qa/Scripts/python.exe` y script conocido
  `tests/support/gate7_fastapi_server.py`
- Rutas absolutas `ORCA_QA_MOTOR_REPO_DIR`/`ORCA_QA_PYTHON`
  con coincidencia exacta con las esperadas

El Python lanzado recibe variables de entorno mínimas, marca QA,
credencial temporal generada criptográficamente, SQLite/Ed25519
desechables bajo TEMP y solo el listener 127.0.0.1:0 que informa su
puerto al padre tras `/api/health`. La activación de `MANAGED_PORT`
y `MANAGED_BRIDGE_TOKEN` en Electron ocurre **después** de health OK.

Estados: `DISABLED, STOPPED, STARTING, ONLINE, DEGRADED, RECOVERING,
ERROR, STOPPING`. Un cierre inesperado activa hasta dos reinicios
acotados dentro del mismo entorno QA; un cierre solicitado impide
reinicios posteriores.

Al cerrar Electron o desmontar sus handlers, solo se termina el
`ChildProcess` guardado de ese `spawn`. Está prohibido matar por
nombre del proceso, PID encontrado en el sistema, puerto, ruta o
enumeración de procesos. No hay permisos para ejecutar tareas reales.

### Regla de aislamiento crítica

La resolución `managed-resolver` en Electron headless E2E
**nunca** recorre archivos `.active_profile`, tokens o carpetas
del host, incluso antes de que el motor QA esté listo. Puerto 0 =
fallo cerrado; no hace fallback al puerto operativo 8765.

## Superficies y controles

- Main IPC `managed:qaEngineLifecycle`: solo escritorio de confianza,
  devuelve phase/owner/port/restarts/error_code, sin tokens ni PID.
- `managed:qaCrashEngine`: inyección de falla solo en QA E2E; mata
  únicamente al proceso hijo propiedad de Electron.
- `managed:qaStopEngine`: cierre explícito solo en QA E2E.
- Preload ManagedBridgeApi: tipos concretos, sin secreto.
- UI Managed: etiqueta identificada como `Motor QA administrado`,
  sin confundir el motor desechable con el operativo.
- No se habilita ningún start/stop en sesiones visibles ni en
  producción; el arranque operativo se pospone a un Gate 9B con
  validación de instalación, identidad y cierre de procesos hijo.

## Pruebas

- Unidades `src/main/ipc/managed-qa-engine-supervisor.test.ts`:
  plataforma, opt-in, entorno oculto, checkout y estado `DISABLED`.
- E2E `tests/e2e/orcastrator-managed-qa-engine-lifecycle.spec.ts`:
  Electron inicia FastAPI, GUI ONLINE con proyectos, caída simulada
  del proceso hijo propio, recuperación autónoma, cierre y ausencia de
  reinicio posterior. La prueba exige Windows y QA checkout local.

**Evidencia Gate 9A PASS (Windows, 2026-11-04):** el operador ejecutó
`tests/e2e/orcastrator-managed-qa-engine-lifecycle.spec.ts` en
`electron-headless` con `1 passed (1.2m)`, caso 24,5 segundos, build
Electron 19,02 segundos y CLI sin errores de tipos en 3.532 archivos.
La prueba aprobó arranque de Python QA desde Electron, UI con proyecto
sintético, caída inyectada, recuperación automática, stop controlado y
sin reinicio posterior. El repositorio temporal E2E fue limpiado.

Esto **no** demuestra seguridad del Job Object del árbol de procesos
ni autoriza arranque operativo. Ninguna GitHub Action; PR DRAFT.

## Limitaciones

La terminación de proceso usa el handle propio de Node `ChildProcess`.
Para distribuir un motor operativo se necesita un supervisor Win32
Job Object que cubra también descendientes y cierre inesperado del
host; reutilizar el supervisor de *tareas* Python como administrador del
*servidor* sería mezclar responsabilidades y no está autorizado.
