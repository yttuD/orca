---
name: architecture-documentation
description: Use for verified architecture docs, requirements, ADRs, API contracts and UML/C4/ERD diagrams.
---
# Documentación y arquitectura de software
1. Leer primero los esquemas, migraciones, contratos API, código y documentación existente. Separar el diseño deseado del comportamiento implementado.
2. Construir requisitos RF/RNF con identificadores estables, aceptación y trazabilidad; documentar ADR para decisiones arquitectónicas.
3. En DB diagramas incluir todas las entidades reales, PK, FK, cardinalidades, restricciones e índices relevantes; no inventar tablas ni claves.
4. Generar diagramas fuente-editables de contexto/contenedor C4, casos de uso por rol, secuencias, estados y componentes; etiquetar cada diagrama con fuente y fecha.
5. Validar sintaxis y renderizado Mermaid/PlantUML/DBML si existen herramientas. Sin render, informar NOT_RUN.
6. Verificar políticas de seguridad, límites de confianza, privacidad, recuperación de errores y rutas críticas. Aplicar verification-before-completion.