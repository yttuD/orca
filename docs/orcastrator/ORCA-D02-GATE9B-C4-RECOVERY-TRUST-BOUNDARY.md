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
