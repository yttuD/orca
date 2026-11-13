---
name: orca-agent-workflow
description: Use for Orcastrator orchestration design, multi-agent task delegation, Planner-Coder-Tester-Verificator-Judge evidence and agent skill governance.
---
# Orcastrator: flujo multiagente verificable
1. Mantener responsabilidades: Planner define contrato y aceptación; Coder implementa; Tester reproduce; Verificator verifica independientemente; Juez aprueba/rechaza según evidencia.
2. No afirmar que una tarea fue aceptada solo por el reporte del Coder; exigir logs, comandos de prueba, salida, revisión del diff y pruebas de regresión.
3. Ejecutar agentes en worktrees/ramas aisladas cuando sea posible y nunca modificar archivos de otro agente sin coordinación.
4. Registrar transferencias, bloqueos, entradas/salidas y pruebas en GitHub o RESULT_PACKET durable; no fingir que Codex puede enviar mensajes a este chat directamente.
5. Medir intentos, coste/token, duración si hay telemetría real, ratio de completitud y reintentos; no inventar métricas.
6. Diseñar Skills reutilizables con pruebas de activación, no duplicar instrucciones globales y conservar compatibilidad Windows/Android.
7. Respetar la arquitectura del repositorio y el flujo nativo de Orca. Esta Skill no añade un nuevo motor ni cambia colas.