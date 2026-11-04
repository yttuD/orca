# ADR-017 — Gate 9B: contención del motor operativo en Windows

Fecha: 2026-11-04
Estado: GATE 9B-A POLICY PASS (18/18 WINDOWS); GATE 9B-B NATIVE CANDIDATO NOT_RUN; ACTIVACIÓN OPERATIVA BLOQUEADA
Requiere: Gate 9A PASS (confirmado 2026-11-04), Gate 8 host NOT_READY (sin listener 8765)

## Resultado anterior certificado

El operador presentó evidencia Windows: E2E Gate 9A
`tests/e2e/orcastrator-managed-qa-engine-lifecycle.spec.ts`
**1 passed (1.2m)**, caso 24,5 segundos, build Electron
19,02 segundos, CLI sin errores en 3.532 archivos, y limpieza del
repositorio temporal. Se verificaron arranque de Python QA desde
Electron, UI, recuperación de caída y stop del proceso propio.

Gate 9A **no demuestra** contención de procesos descendientes,
persistencia de autoridad ni reinicio de motor operativo. El control
actual usa `ChildProcess.kill()` sobre el proceso QA. No es un
mecanismo de Job Object completo.

## Análisis de implementación disponible

- `src/main/ipc/managed-qa-engine-supervisor.ts`: controla la
  instancia desechable propia, pero no es el supervisor del servidor
  de producción.
- `src/main/windows-process-tree-kill.ts`: usa `taskkill /T /F`;
  no es un mecanismo aceptable como autoridad principal de contención
  del motor por carrera de PID y riesgo de matar procesos no propios.
- `src/main/startup/windows-isolated-spawner.ts` y
  `src/shared/windows-security-addon.ts`: implementan aislamiento
  de herencia de handles de procesos detached; la interfaz disponible
  no demuestra las operaciones necesarias para un Job Object exclusivo
  del motor (spawn suspendido + attach a Job Object + resume).
- En el motor Python,
  `src/adapters/process_supervisor.py` sí usa Win32 Job Objects
  para *ejecutores de tareas*; no supervisa el *proceso servidor* padre.
  No se debe confundir el dueño de una tarea con el dueño de FastAPI.

## Decisión y diseño

**No conectar un botón de start/stop operativo** ni habilitar
autoarranque en Desktop hasta validar y desplegar una autoridad nativa
de procesos que pertenezca a Electron y garantice:

1. Verificación de instalación y ejecutable por ruta canónica
   firmada/confiable, más perfil `STAGING_LOCAL` antes de `NORMAL`.
2. Confirmación real del operador en main (native dialog o equivalente
   de confianza), nunca `renderer.authenticated=true` ni bandera
   inyectada en preload como autorización.
3. Raíz de datos staging separada de `ORQUESTADOR-MASTER/data`,
   WCB, tokens y grants.
4. Preflight de listener/procesos existentes; si hay servicio ajeno,
   estado incierto o posible proceso huérfano, bloquear, no adoptar
   ni finalizar por PID, nombre o puerto.
5. Lease exclusivo de arranque contra dos instancias de Electron.
6. Crear proceso inicialmente suspendido, agregarlo a Job Object
   exclusivo de ese motor y solo después reanudar. Establecer
   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; revalidar handle, creación
   y descendientes antes de considerar ONLINE.
7. Fijar identidad PID + fecha Win32 de creación + generación de
   lease; nunca basar decisiones únicamente en PID.
8. Crash/recovery con límite de intentos, backoff y aislamiento de
   orcad, WCB, Electron, otros motores y procesos externos.
9. Mantener el modo operativo deshabilitado ante ausencia de addon,
   permisos insuficientes, entorno no Windows, conflictos de perfil
   o errores de liberación.
10. Validar Windows en pruebas sintéticas: duplicidad de arranque,
    caída del padre, cierre de Job Object, descendientes,
    PID reciclado, puerto ocupado, process lease, crash/recovery,
    pausa del motor y supervivencia de WCB.
11. Preservar autorización de inferencia y despacho independiente:
    arrancar FastAPI nunca implica autorizar trabajo real.

## Contrato inicial (fail-closed, sin efectos secundarios)

`src/main/ipc/managed-engine-operational-admission.ts` implementa una
decisión **pura** a partir de evidencias previamente verificadas
por main/native: bloqueo por Windows/perfil/aprobación/ejecutable/data
root/procesos existentes/lease/Job Object/descendientes/creación Win32
/aislamiento WCB/recuperación.

Incluso con todas las afirmaciones verdaderas solo devuelve
`READY_FOR_WINDOWS_QUALIFICATION`: **no da autorización para iniciar
producción ni abre un proceso**. Nadie debe conectar la función a un
IPC de start hasta obtener pruebas independientes de cada afirmación
y una nueva revisión técnica.

Las pruebas
`src/main/ipc/managed-engine-operational-admission.test.ts`
**PASARON EN WINDOWS el 2026-11-04 (18/18)**. También se confirmó
`tc:node` PASS sin errores de tipos en 19.596 archivos (12,15 s).
Las advertencias de Vite sobre carga ESM/CommonJS fueron no bloqueantes.
Esto NO prueba contención del árbol de procesos nativo.

## Estado de puertas

- Gate 9A: PASS (Windows).
- Gate 9B-A: contrato de admisión y unit test, creado en rama.
- Gate 9B-B: servicio Win32 Job Object y lease, NO IMPLEMENTADO.
- Gate 9B-C: verificación Windows de crash / descendants / WCB,
  NOT_RUN.
- Gate 9B-D: activación operativa, NO AUTORIZADA.

Sin merges ni GitHub Actions. Ambos PR permanecen DRAFT.


## Gate 9B-B — Implementación nativa inicial, todavía sin validar (2026-11-04)

En `native/windows-security` se añadió un primitivo **no conectado al
inicio del motor operativo**:

- `src/managed-job-process.cc/.h`: `spawnManagedJobContained(file, commandLine, cwd, environmentBlock)`.
- El primitivo crea un Job Object Windows sin nombre ni handles
  heredables, configura y relee `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`,
  inicia el ejecutable con `CREATE_SUSPENDED` y
  `bInheritHandles=FALSE`, lo asocia al Job Object y recién entonces
  reanuda el hilo principal. Si falla cualquiera de los pasos,
  termina el proceso mediante **su propio HANDLE**, sin buscar ni
  reutilizar PID ajenos.
- El retorno es un objeto opaco nativo `ManagedJobContainedProcess`
  con `snapshot()` y `close()`, retiene el único Job HANDLE y lo
  libera en cierre/GC/caída del proceso padre. `snapshot` ofrece
  PID y **fecha Win32 de creación en ticks como string** para evitar
  errores de precisión de números JS, y el conteo de procesos
  activos asociados; esos valores NO se envían al renderer.
- El binding `native/windows-security/binding.gyp` agrega el nuevo
  archivo C++; `index.js`/`index.d.ts` y
  `src/shared/windows-security-addon.ts` exponen el adaptador tipado.
- La prueba Windows
  `src/main/ipc/managed-job-native-windows.test.ts` solo usa
  un Node sintético temporal que lanza un descendiente. Comprueba
  la contención de ambos y que el cierre del Job Object termina los
  dos, sin tocar puertos ni WCB. Está **NOT_RUN**.

La implementación nativa no equivale a una solución operativa completa.
Todavía faltan *lease* exclusivo contra doble inicio, reconocimiento
de instancias existentes, integridad de la instalación, verificación
de permisos, aceptación del operador, integración del arranque/stop
del FastAPI operativo, comprobación de escenarios de crash del padre
y evaluación de incompatibilidad de Job Objects anidados. El fallo
de cualquiera de esas condiciones mantiene la admisión bloqueada.

Microsoft documenta que los hijos creados con `CreateProcess`
se asocian al job del padre por defecto y que el límite
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` termina los procesos del job al
cerrar el último handle:
https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects

**Resultados de aceptación separados**:
- 9B-A policy: **18 PASS / Windows**.
- 9B-B compilar N-API y prueba real padre/hijo: **NOT_RUN**.
- 9B-C ciclo operativo y falla inesperada del proceso principal:
  **NOT_IMPLEMENTED / NOT_RUN**.
- 9B-D habilitación real: **NO AUTORIZADA**.
