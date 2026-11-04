# ORCA-D02 Gate 9B-C4 — Límite de confianza y política de recuperación del motor

**Fecha:** 2026-11-04
**Estado:** DECISIÓN CONFIRMADA POR EL OPERADOR (2026-11-04) / integración y pruebas C4-A pendientes; no hay recuperación real habilitada.

## Evidencias ya obtenidas

Gate 9B-C3-E-E: **Windows 6 archivos / 38 tests PASS**, 2,41 s, marcador `GATE 9B-C3E-E HISTORICAL JOURNAL QUARANTINE QA: PASS` (11:35:00 local, 2026-11-04). Corresponde a pruebas de archivos y Job Objects sintéticos, no a una puesta en producción ni a prueba real de arranque/reinicio de motor después de crash.

Resumen incremental de controles aprobados en QA: C3-B TCP 31/31; C3-C PID+FILETIME 34/34; C3-D política pura 38/38; C3-E-A journal sintético 12/12; C3-E-B lease y journal 18/18; C3-E-C cierre vacío de Job Object 23/23; C3-E-D Job/lease/journal 29/29; C3-E-E cuarentena histórica 38/38. Estos valores corresponden a suites con alcance superpuesto, no a un total aditivo de tests únicos.

## Análisis del límite

1. **Job Objects de Windows.** El Job Object actual es privado, sin nombre y con `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Microsoft documenta que solo los Jobs con nombre pueden abrirse mediante `OpenJobObject`. El cierre de su último HANDLE bajo KILL_ON_JOB_CLOSE termina sus miembros. Sin embargo, desde una instancia posterior no se puede reconstruir su estado histórico solo con un PID desaparecido. En una interrupción abrupta el mecanismo está diseñado para terminar miembros asociados, pero el diagnóstico de la nueva instancia debe comprobar sus propios límites de observación. Fuente: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects .
2. **SHA-256 y ACL no autentican históricamente.** El journal actual puede ser reemplazado íntegramente, junto con checksum, por un proceso que comparte permisos de escritura. El caso de E-E demostró explícitamente que un falso CLEAN_STOP con hash coherente sigue siendo UNATTESTED.
3. **DPAPI de usuario no crea una identidad independiente.** Microsoft documenta que `CryptProtectData`/`CryptUnprotectData` suelen proteger y recuperar datos con las credenciales del mismo usuario. No garantiza separación frente a otro proceso que opera bajo esas credenciales. Fuente: https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata .
4. **Un servicio con SID/identidad propia es una alternativa más sólida, pero requiere modelo de permisos.** Separar cuentas y aplicar ACL sobre la raíz de evidencias permitiría estudiar un autor distinto de la interfaz, con revisión de privilegios de administradores, servicio, instalación, actualizaciones y seguridad local. Un service SID por sí solo no demuestra resistencia a privilegios administrativos. Referencia: https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_sid_info .

## Decisión provisional C4 (para desarrollo del MVP)

**D-C4-01: recuperación supervisada, nunca automática después de crash.** Mantener `BLOCKED` para journal `PREPARING`, `JOB_ASSIGNED`, `CORRUPT`, `MISSING`, `UNKNOWN` y también `CLEAN_STOP` histórico de origen UNATTESTED. Prohibir la promoción de cualquier campo de archivos JSON a `journalIntegrity='ATTESTED'`. No conectar una respuesta `READY_FOR_ADDITIONAL_ISOLATED_QA` con un `spawn` real.

**D-C4-02: visor de diagnóstico, no control operativo.** Antes de introducir acciones en UI, diseñar un resultado read-only que informe la generación anterior (si la hubo), salud del lease, owner PID+FILETIME, estado de listener, y causa precisa de bloqueo. Los valores desconocidos se muestran explícitamente como `UNKNOWN`, jamás como 'libre'. La UI no ofrece 'forzar arranque', 'matar PID' o 'borrar lock'.

**D-C4-03: aislamiento de QA y puente.** Todos los experimentos deben usar el clon `D:\Programacion-Cosas\ORCASTRATOR-DESKTOP-QA\orca`, rutas `%TEMP%` y procesos Node sintéticos; excluir `D:\Programacion-Cosas\ORQUESTADOR-WCB`, `D:\Programacion-Cosas\ORQUESTADOR-MASTER`, puertos reales 8765 y demás servicios. El motor de producción permanece bloqueado.

**D-C4-04: futuro servicio Windows separado bajo decisión explícita.** No crear, registrar, instalar ni iniciar servicios del sistema desde este PR. Si en una fase futura se exige restart automático sin intervención, evaluar un supervisor instalado con identidad de servicio diferente, estado monotónico protegido contra replay y evidencia de seguridad a través de distintas sesiones, no solo mutex por nombre. Ese cambio implica privilegios y mantenimiento y necesita aprobación del operador.

## Secuencia técnica siguiente y criterios

- **C4-A (preparar):** contrato de observabilidad sin efectos laterales (no `spawn`, no IPC operativo, sin mostrar ruta completa del ejecutable al renderer) + pruebas que comprueben que un journal sintético leído continúa `BLOCKED`. No repetir los tests E-E como si fueran una nueva prueba de autenticación.
- **C4-B (pendiente):** validación de confianza del origen de datos, aislamiento de directorio, integridad de instalación y censo de procesos residentes con PID+FILETIME bajo lease; los estados desconocidos bloquean. No afirmar ausencia global basada solo en un censo de puertos o en la inexistencia del PID raíz.
- **C4-C (sujeto a evidencia):** flujo supervisado con intervención humana y reglas de seguridad para iniciar únicamente una nueva generación aislada, si y solo si todas las condiciones se verifican de manera independiente. No implementar botones de reinicio ni matar procesos hasta tener evidencias reproducibles.
- **C4-D (opcional, no autorizado):** análisis de supervisor Windows con identidad distinta y ancla duradera anti-rollback, si el usuario decide que el reinicio automático es un requisito.

## No objetivos

No instalar servicios, no cambiar WCB, no iniciar ni parar motores operativos, no habilitar GitHub Actions, no hacer merges y no tratar la falta de evidencias como un PASS. Ambos PRs continúan DRAFT.

## Confirmación explícita del operador — D-C4-01 (2026-11-04)

**DECISIÓN APROBADA: RECUPERACIÓN SUPERVISADA PARA EL MVP.** El operador confirmó «Vamos con recuperación supervisada entonces». Se adopta D-C4-01 como decisión definitiva para el MVP: ante caídas o incertidumbre, mostrar diagnóstico y bloquear reinicios automáticos. El humano podrá revisar la evidencia y supervisar la reconciliación, pero su intervención **no sustituye** comprobaciones técnicas ni permite forzar el arranque. El servicio Windows separado/arranque automático queda **fuera del alcance del MVP**, sin permiso de instalación o implementación.

## Gate C4-A — Proyección de diagnóstico supervisado de solo lectura (candidato)

**Implementación preparada; 22 tests NOT_RUN (2026-11-04).** La decisión D-C4-01 está confirmada, pero C4-A todavía requiere validación y **no se conectó a UI, IPC ni a un motor operativo**.

- `src/main/ipc/managed-supervised-recovery-diagnostic.ts`: recibe un valor `unknown` y hora inyectada; proyecta exclusivamente un DTO de diagnóstico limitado, sin I/O ni invocaciones a Win32, red, filesystem, mutex o proceso. El retorno incluye siempre `status: BLOCKED`, `startupAllowed: false`, `reviewRequired: true`, `diagnosticOnly: true` y `evidenceAuthentication: UNATTESTED`.
- Estados del journal: `MISSING`, `CORRUPT`, `PREPARING`, `JOB_ASSIGNED`, `CLEAN_STOP`, `UNKNOWN`. Un `CLEAN_STOP` histórico también permanece bloqueado, y el DTO sólo contiene campos explícitamente permitidos (no rutas completas, tokens, contraseñas ni variables de entorno).
- El lease, listener y proceso registrado se presentan únicamente como **observaciones declaradas**. Si falta marca temporal, es futura, no finita o tiene más de 15 s, esos campos se muestran `UNKNOWN`, nunca como ausencia confirmada. El límite de 15 s sirve solo para visualización, **no certifica origen ni autoriza arranque**.
- PID del propietario y FILETIME son indivisibles: si alguno es inválido, ambos se ocultan. Se valida además un identificador de generación UUID. La identidad mostrada no implica autoría confiable. La fuente `MAIN_NATIVE_CLAIM` también es una declaración del llamador y nunca confiere permisos.
- `src/main/ipc/managed-supervised-recovery-diagnostic.test.ts`: **22 pruebas puras preparadas, NOT_RUN**, incluidos estados favorables que deben seguir bloqueados, falsificación de fuente, datos vencidos/futuros, campos adicionales secretos, PID reutilizado, id mal formado, entradas inválidas y determinismo. Se ejecutan sin tocar el host.

Próximo QA: `pnpm.cmd run tc:node` y `pnpm.cmd exec vitest run --config config/vitest.config.ts src/main/ipc/managed-supervised-recovery-diagnostic.test.ts` en el clon Windows QA limpio. Criterio solo si supera la prueba: **1 archivo / 22 tests PASS**. No se requiere rebuild nativo. No afirmar C4-A PASS antes de tener evidencia.

## Gate C4-A — Evidencia Windows PASS (2026-11-04)

El operador presentó Vitest 5.0.5 en clon QA: **1 archivo/22 pruebas PASS**, duración **479 ms**, inicio 11:53:07 local, marcador `GATE 9B-C4A SUPERVISED RECOVERY DIAGNOSTIC QA: PASS`. Se aprueba la función de proyección pura C4-A: nunca autoriza arranque y normaliza observaciones sintéticas. La salida compartida no contiene la transcripción independiente del typecheck; no ampliar el PASS más allá de Vitest.

## Gate C4-B1 — Consistencia de procedencia y orden de sensores sintéticos (CANDIDATO)

**22 pruebas preparadas, NOT_RUN.** La fase B1 es preparación del modelo de observaciones, **no un nuevo sensor real ni un atestado de procedencia**. En particular, que un JSON diga `MAIN_NATIVE_CLAIM` no prueba que fue producido por Win32 o Electron main.

- `src/main/ipc/managed-supervised-recovery-provenance.ts` valida un bundle de claims con identificador de captura UUID, huella de instalación/motor SHA-256 sintética, generación de lease UUID, y tres observaciones: lease, listener y proceso registrado. Exige campos de identidad consistentes entre sensores, tiempo finito/reciente (máximo 15 segundos para presentación), y que el censo de listener/proceso **no preceda** a la observación del lease. Múltiples observaciones no pueden combinarse de distintas generaciones para aparentar un sistema libre.
- Un claim inválido, ausente, vencido, futuro, previo al lease, aportado desde renderer o que usa un valor de estado desconocido degrada todos los campos actuales a `UNKNOWN` en la proyección C4-A. No inventa permisos positivos. La consistencia lógica devuelve `CONSISTENT_CLAIMS_NOT_PROOF` y `observationAuthority: UNATTESTED_CLAIMS_ONLY`, con `status: BLOCKED` y `startupAllowed:false` **siempre**, incluso ante todas las etiquetas favorables.
- `src/main/ipc/managed-supervised-recovery-provenance.test.ts`: **22 tests sintéticos NOT_RUN** para identidad cruzada, orden temporal, captura extraña, generación distinta, origen renderer/file, observaciones antiguas/futuras, estado de listener presente, PID reutilizado, campos secretos y determinismo.
- **Brecha explícita:** B1 no abre un mutex, no verifica directorio de instalación, no consulta procesos reales, ni calcula procedencia de una observación nativa; son solo claims. C4-B2 requerirá instrumentar sensores reales de solo lectura en un worktree de QA con garantías de aislamiento. Los resultados de B1 jamás se conectan a spawn de motor ni a UI operativa.

**Siguiente validación:** `pnpm.cmd run tc:node` y Vitest de `managed-supervised-recovery-diagnostic.test.ts` + `managed-supervised-recovery-provenance.test.ts` en el clon QA limpio. Se esperan **2 archivos / 44 pruebas** sólo si aprueban; sin rebuild C++. No modificar WCB, motor operativo, port 8765, GitHub Actions ni merges.

## Evidencia Windows Gate 9B-C4-B1 — PASS (2026-11-04)

El operador aportó Vitest 5.0.5: **2 archivos / 44 pruebas PASS**, duración **514 ms**, inicio 11:59:30 (hora local), marcador `GATE 9B-C4B1 SUPERVISED RECOVERY PROVENANCE QA: PASS`. El alcance es la proyección y coherencia de **declaraciones sintéticas** de fuente, generación, captura y secuencia temporal; no es una validación de sensores operativos, identificación histórica del Job Object ni autorización de reinicio. La salida presentada no transcribe por separado el typecheck.

**C4-B1 PASS en QA**. Siguiente etapa C4-B2: recolección nativa de solo lectura exclusivamente para procesos propios sintéticos, con procedencia ligada a handle real y sin arranque de motor operativo. Ambos PRs DRAFT, WCB intacto, sin GitHub Actions ni merges.

## Gate C4-B2-A — Sensor nativo de proceso propio en clon QA (candidato, NOT_RUN)

**Alcance:** continuar la recuperación supervisada confirmada sin usar datos del motor operativo. Primera etapa B2: comprobar observaciones **actuales y propias** con interfaces ya existentes del addon Windows. No se implementa censo histórico ni el inicio del motor.

- `src/main/ipc/managed-qa-native-self-observation.ts`: función **sin efectos de escritura ni binds propios** que solo se ejecuta en Windows, desde `ORCASTRATOR-DESKTOP-QA/orca`, con `ORCA_GATE9C4B2_TEST_ONLY=1`. El llamador de pruebas debe conservar un lease nativo propio con huella de motor sintética y un `net.Server` ya escuchando en `127.0.0.1` con puerto efímero. No se acepta un número de puerto arbitrario desde archivos, entorno o renderer. Se prohíben puertos operativos reservados.
- Confirma `verifyManagedMotorLeaseOwnerForQa` sobre el ObjectWrap real; exige PID del dueño igual al del proceso actual. Lee exclusivamente **la identidad de ese mismo PID** con `inspectManagedQaRecordedProcess`, y la tabla TCP filtrada por el puerto del servidor propio con `inspectManagedQaTcpListeners`. Exige coincidencia de PID y FILETIME, y que exista exactamente un listener de ese proceso. Revalida el lease al final. No obtiene ni muestra rutas de ejecutables devueltas por Windows.
- Incluso con sensores reales y favorables, la salida es `status:BLOCKED`, `startupAllowed:false`, `historicalProof:false`, `observationKind:CURRENT_QA_PROCESS_ONLY`. La salida positiva solo confirma que el addon pudo observar **esta instancia**; no dice que no hay procesos viejos, ni autoriza reinicio.
- Toda discrepancia, lease liberado, identidad falsa, sensor sin permisos, puerto ausente o ejecución fuera del clon QA retorna `observationKind:UNKNOWN` y bloqueo. No se consultan PIDs arbitrarios ni se modifican procesos. Los listeners loopback son creados/cerrados **únicamente por los tests**, no por el recolector.
- `src/main/ipc/managed-qa-native-self-observation-windows.test.ts`: **8 pruebas nativas Windows PREPARADAS, NOT_RUN** sobre listener efímero propio, lease falso con prototipo copiado, lease cerrado, hash ajeno, identidad mal formada, opt-in ausente, listener ya cerrado y salida sin datos históricos/secretos. Las pruebas crean/cierran sus propios servidores locales y mutex sintéticos; no hay FastAPI, WCB ni motor real.

**QA próximo:** C4-A (22), C4-B1 (22) y C4-B2-A (8) juntos: **3 archivos / 52 pruebas**, solo si ejecutan y pasan en Windows. `pnpm.cmd run tc:node` seguido de Vitest de las tres suites. Se reutiliza el binario nativo existente, sin nuevo build de C++; éste es un candidato, no un PASS.

**Brecha restante C4-B2-B:** recolector confiable de datos de un motor anterior, verificación de instalación/raíz privada y un censo completo confiable del Job Object previo. El Job Object es anónimo; no afirmar que ya existe esa capacidad. Un sensor que observe el proceso actual jamás puede probar ausencia global de huérfanos. En el MVP la recuperación seguirá supervisada y fail-closed.

## Validación real Windows 9B-C4-B2-A — PASS (2026-11-04)

El operador compartió Vitest v5.0.5 del clon `D:/Programacion-Cosas/ORCASTRATOR-DESKTOP-QA/orca`: **3 archivos / 52 pruebas PASS**, duración **607 ms**, inicio 12:09:38 hora local, marcador exacto `GATE 9B-C4B2A NATIVE OWN-QA OBSERVATION: PASS`. Quedan certificados los escenarios de QA para los sensores Win32 sobre PID/FILETIME, lease y listener **del proceso de prueba actual**. El fragmento aportado muestra Vitest y no la transcripción independiente de MSVC/typecheck.

**C4-B2-A PASS SOLO EN QA**. La existencia y salud del proceso actual no acreditan ni permiten afirmar que un motor anterior o sus descendientes históricos ya no existan. Los resultados permanecen `BLOCKED`, `startupAllowed:false`, `historicalProof:false`; motor operativo y WCB no se modifican.

## Gate C4-B2-A — Windows PASS (2026-11-04)

El operador entregó Vitest v5.0.5: **3 archivos / 52 pruebas PASS**, duración **607 ms**, inicio 12:09:38 local, marcador `GATE 9B-C4B2A NATIVE OWN-QA OBSERVATION: PASS`. Se valida la observación nativa del **proceso actual de QA** con lease, PID+FILETIME y listener local efímero. No valida ningún dato sobre procesos anteriores. El mensaje contiene Vitest, no una transcripción independiente de TypeScript.

## Gate C4-B2-B — Paquete de revisión supervisada y cuarentena histórica (CANDIDATO)

Se prepararon (sin ejecutar aún) `src/main/ipc/managed-qa-supervised-review-packet.ts` y `src/main/ipc/managed-qa-supervised-review-packet-windows.test.ts` (**8 pruebas nuevas NOT_RUN**).

- El componente reutiliza directamente el sensor nativo B2-A del PID propio y el lector C3-E-E del journal ubicado en un directorio temporal QA comprobado. No importa paths arbitrarios al renderer ni recibe un PID o un puerto libre desde archivos.
- Separa explícitamente `currentInstance.state = CURRENT_QA_PROCESS_ONLY | UNKNOWN` de `previousOwner.state = UNVERIFIED`; el primero solo expresa observación del proceso del test, **nunca ausencia de procesos o descendientes previos**.
- Cuando existe `CLEAN_STOP` con SHA-256 válido, la razón histórica sigue siendo `CLEAN_STOP_HISTORY_UNATTESTED`; con PREPARING, journal faltante, truncado o raíz rechazada continúa bloqueado. Un fallo de lectura de raíz QA se registra `JOURNAL_READER_REJECTED`, no se interpreta como instalación nueva.
- El paquete expone únicamente PID y FILETIME del **proceso actual de QA**, razones tipadas y ausencia de evidencias. No incluye rutas, hash del motor, contraseña, comando ejecutable ni acciones. El resultado es SIEMPRE `state='BLOCKED'`, `startupAllowed=false`, `supervisorReviewRequired=true`; su `missingEvidence` declara falta de autoría histórica, censo del Job Object anterior y validez del journal.
- Las 8 pruebas Windows NOT_RUN abarcan raíz ausente, PREPARING, CLEAN_STOP válido, archivo truncado, falso lease con prototipo copiado, falta de opt-in, raíz fuera de TEMP y filtrado de rutas/datos de ejecución. Los tests usan únicamente sus propios listeners 127.0.0.1, mutex nativo y archivos temporales.

**Importante:** Esta es una etapa de *ensamblado de diagnóstico* para revisión humana, NO un sensor de propietario anterior ni una solución a la brecha C4-B2-B de obtención de atestación histórica. No se integra aún al IPC/renderer real. La imposibilidad de reabrir un Job Object privado anónimo después de la caída sigue sin resolverse.

Próximo QA: ejecutar TypeScript y las cuatro suites C4-A (22), B1 (22), B2-A (8), B2-B (8) en Windows QA limpio. **Esperado únicamente si pasan: 4 archivos / 60 pruebas PASS.** No requiere rebuild C++ ni toca WCB, motor operativo, puerto 8765, GitHub Actions o merges.
