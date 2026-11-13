# Investigación y selección de Skills — 12/11/2026

## Objetivo
Curar Skills reales para siete proyectos: TransAI, UMBRAL, Rendo, catálogo con Google Sheets, Orcastrator, Aromatizantes y Mi Ciclo. **Una Skill aporta procedimientos; no instala por sí sola herramientas, dependencias, credenciales o runtime.** Las Skills en `.agents/skills/` se cargan en Codex y Antigravity cuando corresponda; no incrementan el inventario de Skills de ChatGPT.

## Ya incorporadas en ramas de integración
- `obra/superpowers:verification-before-completion` (licencia MIT; versión copiada).
- `obra/superpowers:systematic-debugging` (MIT; guía y tres documentos de referencia copiados).
- `mattpocock/skills:codebase-design` (MIT).
- Propias del ecosistema: `architecture-documentation` (requisitos, ADR, UML/C4/ERD); `product-brand-and-sales`; Skills de QA individuales por proyecto.
Todas las integraciones se prepararon mediante PR. **Sin merges automáticos** para no disparar despliegues involuntarios.

## Candidatas complementarias — selección razonada

| Categoría | Skill exacta y fuente | Para qué | Condición |
| --- | --- | --- | --- |
| Arquitectura | `domain-modeling`, `improve-codebase-architecture`, `tdd` — [mattpocock/skills](https://github.com/mattpocock/skills) | Domain model, límites y tests | Revisar vocabulario/criterios del proyecto |
| Planificación | `writing-plans`, `using-git-worktrees` — [obra/superpowers](https://github.com/obra/superpowers) | Worktrees y tareas verificables | Encajar en flujo Planner→Juez |
| Documentación | `doc-coauthoring` — [anthropics/skills](https://github.com/anthropics/skills) | Specs, propuestas, revisión del lector | Subagentes de prueba no siempre disponibles |
| Especificaciones | `to-spec`, `to-tickets` — [mattpocock/skills](https://github.com/mattpocock/skills) | De conversación a especificación y tickets | Requiere issue tracker y glosario |
| Diagramas | `uml-and-software-architecture-visualization` — [openai/plugins](https://github.com/openai/plugins) | UML, C4, ERD, Mermaid, PlantUML, DBML | Algunas referencias son compartidas con plugin; comprobar compatibilidad de instalación aislada |
| Diagramas | `node-link-and-diagram-layout` — [openai/plugins](https://github.com/openai/plugins) | Reducir cruces, mejorar layouts de grafos | Complementaria, no renderer |
| Seguridad | `security-threat-model` — [openai/skills](https://github.com/openai/skills) | Modelo de amenazas anclado al repositorio | No equivale a pentest |
| Pruebas | `agent-browser` — [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | Recorridos de navegador y capturas | Requiere CLI/navegador funcionales |
| UI/UX | `frontend-design` — [anthropics/skills](https://github.com/anthropics/skills) | Diseño expresivo, no genérico | Comprobar licencia y referencias del proyecto |
| UI/UX | `ui-ux-pro-max` — [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Paletas, patrones, sistemas visuales y UX | Paquete grande, fuentes y scripts auxiliares |
| Arte 2D | `sprite-pipeline` — [openai/plugins](https://github.com/openai/plugins) | Sprite atlas consistente desde frame aprobado | No crea calidad artística por sí solo |
| Videojuegos | `game-ui-frontend`, `game-playtest` — [openai/plugins](https://github.com/openai/plugins) | HUD, interacción y QA jugable | Requiere juego/capturas reales |
| Branding | `brand-identity` — [rampstackco/claude-skills](https://github.com/rampstackco/claude-skills) | Logos, color, tipografía, imaginería y motion | Exige dirección de marca aprobada |
| Branding avanzado | `brand`, `brand-strategy`, `creative-direction`, `logo-design` — [zstvns/design-skills](https://github.com/zstvns/design-skills) | Flujo completo, contexto persistente | Dependencias entre skills; revisar auditorías |
| Marketing base | `product-marketing`, `customer-research` — [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | ICP, segmentación y mensajes validados | Leer fuentes de voz del cliente |
| Ventas | `copywriting`, `sales-enablement`, `pricing-strategy` — [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | Landings, objeciones, pitches y pricing | No inventar datos ni promesas |
| Captación | `launch-strategy`, `page-cro` — [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | Go-to-market y optimización de conversión | Necesita público, objetivo y medición reales |
| Metaskills | `skill-creator` — [anthropics/skills](https://github.com/anthropics/skills) | Crear/evaluar Skills propias | Algunas pruebas requieren entorno Claude |

## Mapa de aplicación
- **TransAI:** modelos de dominio, diagramas IEEE, pipeline IA, amenaza de roles, diagnóstico de colas, QA end-to-end.
- **UMBRAL:** pixel-art, HUD, animaciones y proyectiles, sprite atlases, QA Android y consistencia de marca.
- **Rendo:** permisos RLS/multitenancy, pruebas negativas, moderación, threat modeling, onboarding/monetización.
- **Catálogo:** integridad Sheets, stock y portada, UI/UX, copy comercial y CRO.
- **Orcastrator:** specs medibles, agentes aislados por worktree, evaluación de resultados, Skills propias.
- **Aromatizantes:** sincronización offline, conflictos e idempotencia, pruebas Windows/Android, propuesta de valor B2B.
- **Mi Ciclo:** UX coherente, accesibilidad, app/panel y datos protegidos, documentación y QA móvil.

## Seguridad y criterios de descarte
1. Solo instalar de repositorios concretos revisados. Preferir fuente original; **no instalar forks homónimos solo porque la Skill tiene el mismo nombre**.
2. Se detectó un fork `matpocock/skills` (sin la segunda 't') con instrucciones para emitir un beacon local y solicitar permisos fuera del sandbox. **No confundirlo con `mattpocock/skills`**, fuente seleccionada.
3. `anthropics/skills:brand-guidelines` fija la marca de Anthropic. No aplicarla como guía para marcas propias.
4. `openai/plugins:threat-model` depende de archivos internos del plugin; preferir `openai/skills:security-threat-model` para instalación autónoma.
5. Revisar archivos de scripts de cada Skill, licencias, versión, dependencias, permisos y llamadas de red. La auditoría en Skills.sh no garantiza seguridad.
6. No cargar secretos ni información sensible en packs públicos: los enlaces de packs son no listados, no privados.
7. Las Skills opcionales **no se han ejecutado ni instalado** por el hecho de estar en el script; ejecutar manualmente en cada repo si se aprueba el origen.

## Comandos útiles
```powershell
# Desde la raíz del repositorio, revisar el archivo antes de ejecutarlo
Get-Content scripts/install-agent-skills.ps1
# Una vez revisado
powershell -ExecutionPolicy Bypass -File scripts/install-agent-skills.ps1
npx skills list
```

Documentación oficial: https://skills.sh/docs ; agentes/rutas: https://github.com/vercel-labs/skills/blob/main/docs/agents.md
