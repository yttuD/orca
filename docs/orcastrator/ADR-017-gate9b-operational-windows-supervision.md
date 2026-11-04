# ADR-017 — Gate 9B: contención del motor operativo en Windows

Fecha: 2026-11-04
Estado: GATE 9B-A PASS; 9B-B PASS; 9B-C1 PASS (3/3 WINDOWS); 9B-C2 CONTRATO PASS (44/44), LEASE NATIVO QA PASS (4/4), C3 CONTRATO PASS (28/28), C3 SENSOR PENDIENTE; MOTOR OPERATIVO BLOQUEADO
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
  dos, sin tocar puertos ni WCB. **PASS (2/2) en Windows 2026-11-04**.

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
- 9B-B compilar N-API y prueba real padre/hijo: **PASS (2/2 WINDOWS)**.
- 9B-C falla inesperada de padre nativo, lease exclusivo y escenarios
  de contención: **PENDIENTE / NOT_RUN**.
- 9B-D habilitación real: **NO AUTORIZADA**.


## Confirmación Windows Gate 9B-B (2026-11-04)

El operador informó `tc:node` PASS en 19.597 archivos (15,29 s), `node-gyp 12.3.0` con Node 22.23.4 y VS2026/MSBuild compiló `managed-job-process.cc` y produjo `orca_windows_security.node` (`gyp info ok`), y Vitest `managed-job-native-windows.test.ts`: **2 passed (2)** en 727 ms. Confirmado `GATE 9B NATIVE JOB CONTAINMENT QA: PASS`. Vite advirtió sobre ESM/CommonJS, sin errores.

Este PASS es de `job.close()` explícito sobre procesos QA sintéticos. **No es todavía prueba de caída del dueño, lease de instancia única ni aprobación de arranque operativo.**

## Gate 9B-C1 — Caída de propietario del Job Object (WINDOWS PASS 2026-11-04)

En el fork Orca se agregaron `tests/fixtures/orca-gate9c-job-owner.cjs` y
`src/main/ipc/managed-job-owner-crash-windows.test.ts`.
El test ejecuta exclusivamente procesos Node temporales con entorno
mínimo y vencimiento propio. Un proceso propietario lanza un proceso
contenedor en el Job Object; este lanza otro descendiente.
El test fuerza la caída del propietario a través de su propio handle
`ChildProcess` **sin llamar a `job.close()`** y espera que ambos
procesos contenidos terminen. Simultáneamente comprueba que otro
proceso sintético independiente, con el mismo ejecutable, permanece
vivo. Nunca mata por PID ni descubre servicios del host.

**Evidencia Windows:** `tc:node` PASS (19.598 archivos, 12,30 s), Vitest de `managed-job-native-windows.test.ts` y `managed-job-owner-crash-windows.test.ts` **3/3 PASS** en dos archivos (812 ms), mensaje `GATE 9B-C1 WINDOWS QA: PASS`. Las advertencias de Vite fueron no bloqueantes. El test no toca FastAPI, WCB, los puertos 8765/8768/8769 ni secretos del motor.

Una aprobación 9B-C1 no certificará lease exclusivo, no adopción de
incumbentes, integridad de instalación, aprobación local ni disposición
para iniciar el motor operativo. Se desarrollarán en fases posteriores
del Gate 9B-C.

## Gate 9B-C2 — Protección contra doble instancia (pendiente)

Diseño requerido: exclusión entre procesos Windows, con recurso exclusivo cuyo ciclo de vida esté asociado al proceso propietario y se libere si éste desaparece inesperadamente. La primera validación debe ser íntegramente sintética en los clones QA: dos procesos compitiendo, rechazo del segundo, liberación al cierre del primero, liberación tras caída y rechazo si la titularidad es incierta. En producción no bastará la exclusión: el arranque también exige preflight de procesos incumbentes, identidad de instalación y perfil, autorización local en Electron main, raíz de datos aislada y verificación de puertos ajenos. Hasta entonces no habilitar arranque del motor operativo.

## Gate 9B-C2 — Contrato comprobable de lease específico del motor (2026-11-04)

**Situación:** el contrato puro y tests están implementados en rama; la adquisición nativa real continúa bloqueada y NO IMPLEMENTADA. Nunca conectar el contrato a un IPC o flujo de arranque operativo.

### Reutilización de mecanismos existentes y límites

- `src/main/startup/single-instance-lock.ts`: Electron `requestSingleInstanceLock()` previene duplicados dentro de un perfil visual, pero perfiles separados no comparten necesariamente la exclusión del mismo motor.
- `src/main/startup/desktop-profile-instance-lock.ts` y `src/main/orcad/orcad-instance-lock.ts`: `orcad.lock` protege el acceso concurrente a la raíz de datos de Orca. No constituye por sí mismo la propiedad de un *motor Orcastrator* identificado por instalación y servicio. Además, el startup Desktop trata otros errores como `unavailable` y conserva el arranque heredado, lo que no puede reutilizarse como política de admisión del motor.
- `src/main/managed-server/activation/orcad-activation-lock.ts`: el fencing remoto de `orcad` tiene otra responsabilidad; no sustituye exclusión local del servidor Python.

### Criterios del lease que deberá proporcionar el componente nativo

1. Debe cubrir **todas las instancias y perfiles que puedan alcanzar el mismo motor Windows**, incluso sesiones de inicio de sesión distintas. El alcance de una única sesión o perfil es insuficiente.
2. Identidad canónica de motor: combinación estable de instalación, identificador de motor y destino de servicio; derivar un SHA-256 sin incluir rutas secretas ni identificadores personales en logs.
3. Exclusión atómica, acceso restringido al propietario autorizado, **handle de titularidad** mantenido abierto desde antes de iniciar el proceso hasta confirmar su retiro. No usar `process.pid` como prueba suficiente.
4. La prueba de dueño incluye generación, creación de proceso Windows en ticks de 100 ns (string), identidad Win32 verificable y vínculo con el Job Object que contiene al motor.
5. `HELD_BY_OTHER` bloquea sin intentar terminar, adoptar o inspeccionar secretos del competidor. `UNKNOWN` y errores de permisos también bloquean.
6. `ABANDONED` **no equivale a libre**: requiere reconciliación independiente del listener, Job Object y procesos remanentes, con veredicto explícito y nueva generación antes de iniciar. Microsoft documenta que el recurso protegido por un mutex abandonado queda en estado potencialmente indeterminado.
7. Bajo el lease recién adquirido se vuelve a realizar un **censo posterior de procesos/puerto**; un servicio anterior, aunque sea propio, obliga a detener la admisión y escalar a recuperación controlada. El snapshot anterior al lease no basta por la carrera TOCTOU.
8. Un cierre intencional solo libera la titularidad al terminar el árbol propio; un cierre abrupto debe causar liberación del objeto nativo pero **nunca habilitar arranque automático sin reconciliación**.
9. Prohibido usar `orcad.lock` como sustituto, forzar liberaciones por nombre de proceso/PID o tocar WCB y otras instalaciones. No hay permisos de arranque de producción en esta fase.

Microsoft: `CreateMutexExW` advierte sobre el riesgo de apropiación previa del nombre; `Mutex Objects` explica el resultado `WAIT_ABANDONED` y el estado indeterminado del recurso. Referencias:
https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-createmutexexw
https://learn.microsoft.com/en-us/windows/win32/sync/mutex-objects

### Artefactos de contrato seguros publicados

- `src/main/ipc/managed-engine-lease-qualification.ts`: política **pura**, sin adquisición de mutex/archivo, sin procesos, IPC o acceso a puertos. Rechaza fuentes Electron/`orcad.lock`/filesystem, alcance solo sesión, competencia, abandono, titularidad/ACL/identidad no verificadas, falta de Job Object o censo posterior desconocido. El máximo resultado posible `READY_FOR_ISOLATED_NATIVE_QA` es informativo para pruebas, NO autorización de despliegue ni de inicio del motor.
- `src/main/ipc/managed-engine-lease-qualification.test.ts`: escenarios de rechazo y candidato sintético completo. Todas las declaraciones del test son ficticias: no comprueban exclusividad real entre procesos. Pruebas **PASS en Windows (26/26 casos del contrato, 2026-11-04)**. El conjunto con las 18 pruebas de admisión previas tuvo **44/44 PASS**.

### Pruebas posteriores antes de instalar implementación nativa

- Dos procesos **distintos** deben competir por la misma identidad de motor: uno obtiene titularidad, otro es rechazado; repetir en perfiles Orca diferentes.
- Cambiar la identidad canónica permite titulares de motores distintos, sin colisiones ni invasión de sesiones.
- Liberación tras cierre normal y tras caída forzada del proceso poseedor. Ante abandono se requiere reconciliación, sin promoción automática a `READY`.
- Probar mutex creado previamente por tercero, ACL insuficiente, propietario imposible de identificar, PID reciclado, proceso con mismo ejecutable pero otro Job Object y servicio con puerto ocupado.
- Cierre inesperado mientras FastAPI queda en fase transitoria y abandono entre adquisición del lease y asociación del Job Object; nunca arrancar dos instancias.
- Registrar evidencia de que WCB y cualquier motor previo siguen vivos e inalterados.

**Gate 9B-C2 = CONTRATO Y SUS TESTS PASS / LEASE NATIVO NO IMPLEMENTADO / PRUEBAS DE EXCLUSIVIDAD REAL NOT_RUN.** Mantener ambos PR DRAFT y el arranque operativo deshabilitado.
### Evidencia Windows Gate 9B-C2 — contrato aprobado (2026-11-04)

El operador ejecutó desde el clon QA `tc:node`: 19.600 archivos sin errores de tipos (12,67 s). Vitest reunió `managed-engine-operational-admission.test.ts` y `managed-engine-lease-qualification.test.ts`: **2 archivos PASS, 44 pruebas PASS (44)**, duración 480 ms, marcador `GATE 9B-C2 LEASE CONTRACT QA: PASS`.

Las advertencias Vite sobre futura carga ESM/CommonJS mediante `configLoader: native` fueron no bloqueantes.

Esta evidencia **solo valida decisiones puras sobre datos sintéticos**, no mutexes, locks ni exclusión entre procesos reales. El mecanismo nativo y la verificación Windows multiproceso permanecen pendientes; está prohibido interpretar `READY_FOR_ISOLATED_NATIVE_QA` como permiso de arranque de FastAPI operativo.
## Gate 9B-C2-N — Candidato nativo Windows de exclusividad (2026-11-04)

**Estado: IMPLEMENTADO EN RAMA / COMPILACIÓN MSVC NOT_RUN / PRUEBAS NATIVAS NOT_RUN.** El resultado anterior del contrato puro (44/44 PASS) se mantiene independiente.

La versión QA de `native/windows-security` incorpora:

- `src/managed-motor-lease.h/.cc`: `acquireManagedMotorLease(sha256LowercaseHex)` crea **atómicamente** un mutex denominado `Global\Orcastrator.Gate9B.C2.QA.<digest>` con `CreateMutexExW` y `CREATE_MUTEX_INITIAL_OWNER`. La identidad debe ser hexadecimal en minúsculas, exactamente 64 caracteres. La fuente confiable de identidad canónica de producción sigue pendiente.
- El descriptor de seguridad se construye con el SID del usuario actual, SYSTEM y administradores, sin herencia de handle, se aplica a la creación y se relee la DACL para comparar su contenido antes de dar por adquirido el recurso. Fallos de seguridad, permisos o nombre ajeno: **fail-closed**. La prueba QA no presupone que otras cuentas puedan adquirir el recurso; es un alcance global de nombre, con acceso limitado intencionalmente.
- Si el nombre ya existe, incluso si fue creado por otro proceso, devuelve `HELD_BY_OTHER`. No espera, no abre su Job Object, no se apropia ni termina procesos. Una creación nueva devuelve **solo** `ACQUIRED_REQUIRES_RECONCILIATION` y un handle opaco con `snapshot()`/`close()`. La exclusividad nativa no es prueba de que no queda un servidor anterior.
- El wrapper mantiene la titularidad en el hilo principal de Node/N-API (los mutex Windows son *thread-affine*); `close()` libera su propia adquisición mediante `ReleaseMutex` y cierra el handle. La terminación inesperada del proceso hace que Windows libere su handle. La creación/abandonos en procesos ajenos jamás habilitan automáticamente un nuevo motor.
- `binding.gyp`, `addon.cc`, `index.js`, `index.d.ts`, `src/shared/windows-security-addon.ts` y dos mocks de tests adaptados. **No existe ningún IPC de arranque operativo ni invocación desde el renderer.**
- `tests/fixtures/orca-gate9c2-lease-worker.cjs` y `src/main/ipc/managed-motor-lease-windows.test.ts`: escenarios con procesos Node reales en Windows, sin puertos ni credenciales. Comprueban competencia por una identidad desde perfiles sintéticos distintos, liberación normal, caída del propietario y adquisición nueva con reconciliación obligatoria, y ausencia de colisión para identidades distintas. Un segundo intento dentro del mismo proceso se rechaza; todas las pruebas usan recursos creados por ellas y expiran en un máximo de 20 segundos.

**Garantías que NO están probadas ni resueltas:** exclusividad entre usuarios de Windows distintos (la DACL restringida niega su adquisición y podría manifestarse `ACCESS_DENIED`); servicios de varios usuarios bajo el mismo motor; titularidad asociada a instalación confiable y generación de motor; persistencia de una marca de fallo entre muertes del proceso; mitigación de mutex pre-creado por otro proceso bajo la misma cuenta (debe rechazarse, no adoptarse); manejo de cambios de hilo y proceso durante actualización; integración con Job Object y pruebas de ausencia de listeners/propietarios previos. En particular, un mutex recién creado después de una muerte anterior no demuestra estado limpio: la reconciliación independiente **sigue siendo obligatoria**.

Validación requerida en Windows QA: `pnpm.cmd run tc:node`, `pnpm.cmd exec node-gyp rebuild --directory native/windows-security`, Vitest de `managed-engine-operational-admission.test.ts`, `managed-engine-lease-qualification.test.ts` y `managed-motor-lease-windows.test.ts`. Se esperan 44 casos del contrato y 4 nativos adicionales si todo funciona. Cualquier error bloquea el Gate, sin relajar aserciones.

No usar GitHub Actions, no fusionar los PR, no tocar WCB, el puerto 8765 ni el motor productivo. La activación real permanece expresamente **NO AUTORIZADA**.

## Evidencia operadora 9B-C2-N — PASS real Windows (2026-11-04)

El operador ejecutó `pnpm run tc:node`: **19.601 archivos sin errores de tipos** (13,26 s). `node-gyp 12.3.0`, Node 22.23.4 Windows x64, Python 3.13.5 y VS2026/MSBuild compilaron `managed-motor-lease.cc` y generaron `orca_windows_security.node`; el resultado concluyó `gyp info ok`. Vitest ejecutó **3 archivos, 48/48 tests PASS**, 1,35 s, con marcador `GATE 9B-C2 NATIVE INTERPROCESS QA: PASS`. Warnings Vite ESM/CJS informativos.

Clasificación: **9B-C2-N PASS para competencia entre procesos Node sintéticos de la misma sesión Windows**; incluye rechazo del competidor bajo otra etiqueta de perfil, cierre normal, liberación tras caída, exclusividad entre identidades diferentes y comprobaciones de parámetros. No existe evidencia de coordinación entre distintas sesiones/usuarios Windows, ni de exclusividad ligada a una instancia de motor real, ni de compatibilidad con ACL de un servicio operativo. Aun adquiriendo un mutex, debe ejecutarse un censo independiente del motor/puertos y verificarse identidad, proceso y Job Object antes de arrancar. **Activación operativa NO AUTORIZADA**.

## Gate 9B-C3 — Reconciliación posterior al lease (contrato en QA)

Estado: **política y tests PASS (28/28 Windows); sensor nativo de procesos/puertos NOT_IMPLEMENTED**. La aprobación C2-N obtenida en Windows (48/48) no prueba que no exista un proceso FastAPI anterior.

El módulo puro `src/main/ipc/managed-engine-reconciliation.ts` evalúa exclusivamente evidencias *que en una versión futura deberán estar firmadas por el main/native confiable*, jamás por renderer o variables de entorno sin validación. Requiere instalación y ejecutable verificados, checkout/data-root staging privados, identidad/generación y handle lease presentes, puerto efímero staging, censo posterior al lease, ningún listener (incluido uno propio anterior), ausencia de procesos y Job Objects residuales, y preservación de WCB.

El máximo veredicto `READY_FOR_DISPOSABLE_STAGING_QA` es informativo: **no arranca ni autoriza la ejecución operativa**. Los métodos C3 no hacen IO, no abren sockets, no recorren procesos ni consumen credenciales.

`src/main/ipc/managed-engine-reconciliation.test.ts` incluye **28 escenarios** sobre declaraciones sintéticas: candidato ideal, 26 rechazos y pureza. Rechaza explícitamente perfil NORMAL, puerto reservado operacional, censo hecho antes del lease (carrera TOCTOU), servicio extranjero o propio aún activo, árbol huérfano o desconocido, estado Job Object dudoso y aislamiento de WCB no probado. Pruebas de contrato en Windows **28/28 PASS, 2026-11-04** (Vitest 448 ms).

Gate C3 REAL aún necesita desarrollar un *sensor* Windows de lectura que asocie puerto y servicio con PID+fecha de creación e identidad del ejecutable, además de una garantía de que el intento de bind ocurra mientras el lease siga retenido. Nunca adoptar o terminar un proceso por PID/puerto; si la identidad es dudosa, bloquear. La evidencia del sensor y su coherencia no pueden ser reemplazadas por el PASS de una política pura.

Se mantiene C2-N aprobado en QA sintético, ambos PR DRAFT, sin GitHub Actions ni modificaciones a WCB.

### Evidencia C3 recibida del operador — 2026-11-04

`git pull --ff-only` avanzó a `8fdbfc5c2c`. El comando `pnpm run tc:node` terminó **sin errores de TypeScript en 19.603 archivos** (11,91 s). La prueba `managed-engine-reconciliation.test.ts` obtuvo **1 archivo / 28 pruebas PASS**, 448 ms y marcador `GATE 9B-C3 RECONCILIATION CONTRACT: PASS`. Las advertencias ESM/CJS de Vite fueron no bloqueantes.

Alcance del PASS: contrato puro sobre evidencia sintética, no inspección Windows real de listeners/procesos. El sensor real es el siguiente requisito, sin habilitar arranque.

## Gate 9B-C3-B — Sensor Win32 TCP en modo lectura (CANDIDATO, NOT_RUN)

Tras la confirmación **C3-A contrato 28/28 PASS** y `tc:node` sin errores en **19.603 archivos**, el fork de Orca contiene una nueva capacidad de *observación*, sin autorización de arranque:

- `native/windows-security/src/managed-listener-census.h/.cc`: `inspectManagedQaTcpListeners(port)` consulta las dos familias `AF_INET` y `AF_INET6` con `GetExtendedTcpTable(TCP_TABLE_OWNER_PID_LISTENER)`. Busca únicamente el puerto solicitado; requiere estados `MIB_TCP_STATE_LISTEN`. Si no puede completar cualquiera de las dos tablas, devuelve `UNKNOWN` y nunca `NO_LISTENER`. Las tablas se reintentan con límites de memoria y cantidad de filas.
- Para cada listener, captura PID, creación del proceso (`GetProcessTimes`: FILETIME como string) y ruta del ejecutable (`QueryFullProcessImageNameW`) cuando Windows permite `PROCESS_QUERY_LIMITED_INFORMATION`. Un permiso insuficiente deja `identityVerified=false`, pero **sigue considerándose listener existente**. La ruta queda únicamente en el addon principal; no publicarla al renderer, a telemetría ni al usuario.
- La API se limita a puertos de QA 1024..65535 y rechaza específicamente 8765, 8768, 8769 y 18765. No abre sockets, ni asigna puertos, ni crea, mata o adopta procesos. Los resultados son *snapshots* y no un candado atómico.
- `binding.gyp` enlaza `iphlpapi.lib` y `ws2_32.lib`, `addon.cc` registra la exportación y el paquete TypeScript la ofrece en `index.d.ts` y `src/shared/windows-security-addon.ts`. Los mocks antiguos de Windows rechazan explícitamente su invocación.
- `tests/fixtures/orca-gate9c3-tcp-owner.cjs` y `src/main/ipc/managed-listener-census-windows.test.ts` usan únicamente listeners efímeros `127.0.0.1:0` (puerto asignado por el kernel), verifican PID/FILETIME/ejecutable de un proceso propio y otro sintético, ausencia de listener tras cerrar ambos, rechazo de puertos reservados y supervivencia durante observación. Los procesos de prueba externos expiran en 20 s.

**Estado: COMPILACIÓN C++ NOT_RUN, TYPECHECK NOT_RUN, PRUEBAS SENSOR WINDOWS NOT_RUN.** Se esperan tres nuevos tests nativos; no adjudicar PASS hasta evidencia original del operador. Referencias oficiales de Microsoft: `GetExtendedTcpTable` y sus tablas IPv4/IPv6 (https://learn.microsoft.com/en-us/windows/win32/api/iphlpapi/nf-iphlpapi-getextendedtcptable), `GetProcessTimes` (https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes).

**Límites de seguridad:** un puerto sin listener no demuestra ausencia de un servidor anterior que aún no hizo bind, ni de un árbol huérfano, ni de un Job Object previo. Tampoco impide una carrera entre snapshot y bind. La integración real requerirá mantener el lease nativo durante la observación, verificar por separado existencia de motor anterior y Job Object, verificar que el bind efectivo coincida con la identidad esperada y conservar bloqueo ante cualquier `UNKNOWN`. Prohibido ejecutar motor operativo o tocar WCB.
