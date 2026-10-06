# Product Discovery: Prioritizer

**Date:** 2026-08-11
**Status:** Discovery Complete

---

## 1. Vision & Context

- **Vision:** Una fuente centralizada donde las acciones surgidas de reuniones (capturadas por cualquier herramienta de transcripción) se consolidan y priorizan globalmente por producto, consultable por los agentes de IA de los desarrolladores cada mañana, con trazabilidad completa de cambios de prioridad.
- **Trigger:** Un dolor muy extendido en organizaciones de software de cualquier tamaño: las reuniones se transcriben con herramientas dispares (Fireflies, Granola, captura vía Teams…) y generan acciones por iniciativa, que acaban dispersas en Confluence, en chats de Teams o Slack, en boards de Jira, etcétera. Un desarrollador implicado en varias iniciativas no tiene una prioridad **global** entre las acciones de los distintos proyectos, y cada PM/PO/stakeholder tiende a afirmar que "lo suyo es lo más prioritario".
- **Ambición:** Empezar con un despliegue acotado en una organización que tenga este problema, validar el flujo con un par de equipos y, si funciona, evolucionarla hacia un producto más amplio.
- **Existing Context:** Es un patrón que reconocen con facilidad, en conversaciones informales, desarrolladores y gente de producto que trabajan en varias iniciativas a la vez. Sin notas estructuradas ni investigación formal todavía: el dolor está por validar con entrevistas (ver las preguntas sugeridas en §2).
- **Constraints:**
  - Esfuerzo acotado (unas pocas semanas de trabajo para la v1, ver Appetite en §4).
  - Debe integrarse con lo existente (Fireflies, Granola, Teams, sistemas de tickets, agentes IA como Claude Code) — no reemplazarlas.
  - Presupuesto limitado (coste de infraestructura/APIs mínimo).

### Elementos clave de la idea original

- Ingesta de transcripciones **o directamente de acciones** desde múltiples herramientas.
- Centralización en una única fuente donde la persona de producto prioriza y asigna orden de ejecución global.
- Consulta por el desarrollador al inicio de la jornada **a través de su agente de IA** (p. ej. Claude Code), probablemente vía un protocolo tipo MCP.
- El agente debe **levantar la mano** cuando existan acciones sin priorizar (p. ej. prioridad fijada el 20/07 pero acciones nuevas del 31/07 sin ranking relativo) en lugar de inventar una prioridad.
- **Historial de modificaciones** de prioridades: trazabilidad y ownership ("ejecuté la tarea 4 del proyecto A antes que la 2 del B porque así estaba marcado a fecha X").
- Posible representación de acciones como tickets (a explorar).

---

## 2. Target Users

**Decisión de foco:** ambos usuarios por igual — es un producto de dos caras: sin priorización fresca no hay valor para el dev, y sin devs consultando no hay incentivo para priorizar. Ambos flujos se diseñan desde el día 1.

### Flujo actual (día a día típico)

En la mayoría de organizaciones no hay flujo definido. De las reuniones surgen acciones que se reflejan de forma dispar: unos las apuntan en Confluence, otros en un chat de Teams o un thread de Slack. Se *asume* que el desarrollador (o el encargado) creará un ticket en el board de Jira del equipo y que a partir de ahí se prioriza internamente. El problema: las acciones llegan desde **múltiples direcciones** a la vez, y no se sabe qué tiene mayor prioridad global. Se rompe tanto en la consolidación como en la priorización.

### Persona: Juan — Desarrollador multi-iniciativa
**Role:** Desarrollador de software implicado en 3-4 iniciativas simultáneas
**Goal:** Empezar cada jornada sabiendo qué acción atacar primero, a nivel global, sin negociar con cada stakeholder
**Frustration:** Cada PM/PO/stakeholder afirma que lo suyo es lo más prioritario; las acciones le llegan por Confluence, Teams, Slack y Jira sin orden global
**Current Tools:** Jira (boards por equipo), Confluence, Teams/Slack, agente IA (p. ej. Claude Code)
**Tech Savviness:** Power user — vive en el terminal y usa agentes IA a diario

#### Jobs to Be Done
- Cuando Juan empieza su jornada estando implicado en varias iniciativas, quiere conocer el orden global de ejecución de sus acciones pendientes —consensuado y establecido por producto en una fuente única de verdad—, para trabajar en lo correcto sin tener que negociar prioridades con cada stakeholder.

#### Assumptions to Validate
- [ ] Los devs consultarían la prioridad vía su agente IA cada mañana (no una UI) — Evidence: weak (conversaciones informales)
- [ ] Los devs confiarían en la prioridad global si está firmada por producto y fechada — Evidence: none
- [ ] El dev acepta que acciones "sin priorizar" queden bloqueadas hasta que producto las ordene — Evidence: none

#### Suggested Interview Questions
1. "¿Cómo decidiste esta mañana qué tarea atacar primero? ¿Cuánto tardaste en decidirlo?"
2. "Si tu agente te dijera 'hay 3 acciones nuevas sin prioridad asignada', ¿qué harías?"

### Persona: Marta — Responsable de producto
**Role:** Product manager / product owner con autoridad para ordenar el trabajo entre iniciativas
**Goal:** Que exista UNA lista global priorizada que los stakeholders acepten como fuente de verdad, sin tener que perseguir acciones por Confluence, chats y boards
**Frustration:** Las acciones se dispersan en cuanto acaba la reunión; alinear a los stakeholders sobre prioridades es una negociación repetida e invisible
**Current Tools:** Fireflies/Granola/Teams (transcripción), Confluence, Jira
**Tech Savviness:** Media-alta — cómoda con SaaS, no necesariamente con terminal

#### Jobs to Be Done
- Cuando llegan acciones nuevas desde varias reuniones e iniciativas, Marta quiere consolidarlas en un único sitio y fijar (con acuerdo de los stakeholders) su orden global de ejecución, para que el equipo trabaje sobre una fuente de verdad y las prioridades dejen de disputarse por canales paralelos.

#### Assumptions to Validate
- [ ] Existe un conjunto pequeño de personas con autoridad real para consolidar la prioridad global (rol consolidador, ver §3) y los stakeholders aceptan sus consolidaciones firmadas — Evidence: none — **supuesto crítico**
- [ ] Marta mantendrá la priorización fresca (revisión al menos diaria/semanal) si el coste es bajo — Evidence: none
- [ ] Los stakeholders aceptarán ver "su" acción por debajo de las de otros en una lista pública — Evidence: none

#### Suggested Interview Questions
1. "¿Quién tiene hoy la última palabra cuando dos iniciativas compiten por el mismo dev? ¿Cómo se resuelve?"
2. "¿Cuánto tiempo podrías dedicar al día a ordenar acciones nuevas si llegaran ya consolidadas?"

### Anti-Users
- Desarrolladores de un solo proyecto (ya tienen prioridad clara dentro de su iniciativa).
- Equipos sin agentes IA (el canal rico de consulta en v1 es el agente; no habrá UI completa de consulta para ellos — pero **sí pueden leer** la vista de solo lectura que se publica al consolidar, ver §3).
- Gestión de tareas personales (no es un todo-app: solo acciones de trabajo surgidas de iniciativas del equipo).
- (Matiz) Dirección/ejecutivos no fueron excluidos explícitamente — posible consumidor secundario de la trazabilidad.

---

## 3. Problem Space

- **Problem Statement:** Los desarrolladores implicados en varias iniciativas (y las personas de producto que los dirigen) sufren porque las acciones surgidas de reuniones se dispersan por Confluence, chats de Teams/Slack y boards de Jira sin consolidarse nunca, y porque nadie ejerce (ni tiene el espacio material para ejercer) la priorización global entre iniciativas. Por eso el dolor suele ser severo (5/5): es habitual que iniciativas clave se retrasen porque los devs atacan lo equivocado, y que la prioridad se dispute entre stakeholders ("lo mío es lo más prioritario") en lugar de decidirse en un sitio común. Hoy se palía con apaños ad hoc por canal, que fragmentan aún más. Sin intervención, empeora: más transcriptores, más iniciativas paralelas y más acciones generadas por IA agravan la dispersión año a año.
- **Current Alternatives:** Sin flujo definido — Confluence + chats (Teams/Slack) + creación manual de tickets en Jira por convención tácita. Priorización solo intra-proyecto.
- **Pain Severity:** 5 — Crítico. Cuando las acciones viven dispersas y nadie ordena entre iniciativas, el trabajo importante tiende a bloquearse, los retrasos se vuelven sistemáticos y la prioridad acaba decidiéndose por quién presiona más, no por un acuerdo explícito.
- **Root Cause:** Doble — (a) las acciones nunca están consolidadas en un sitio único (imposibilidad material de verlas juntas), y (b) no existe el rol/ritual de priorización global entre iniciativas. La herramienta debe resolver la consolidación **y** crear el espacio de priorización.
- **Impact of Inaction:** Empeora con el tiempo — la proliferación de herramientas de transcripción y de acciones auto-generadas por IA multiplica la dispersión.

### Mecanismo de consenso (decisión de diseño clave)

Dos niveles de jerarquía:
1. **Jerarquía draft:** donde los stakeholders discuten/negocian dentro de la herramienta (propuestas, comentarios) hasta ponerse de acuerdo.
2. **Jerarquía consolidada:** el resultado publicado del acuerdo — la ÚNICA que consultan los agentes de los devs. Cada consolidación queda fechada y versionada (→ historial de trazabilidad). En la siguiente consulta, el dev conoce la nueva jerarquía.

**Regla de gobernanza de la consolidación (v1):**
- Existe un conjunto de personas con **rol consolidador** (varios, no una sola). El acuerdo se alcanza como ritual humano (discusión sobre el draft, reunión, chat); la herramienta **no** impone flujo de aprobaciones: cualquier consolidador puede consolidar unilateralmente una vez escuchadas las partes.
- Cada consolidación queda **firmada**: quién consolidó, cuándo, y una **línea de "razón" obligatoria** (el porqué del orden). El historial responde así no solo "qué cambió y cuándo" sino "por qué".
- Que haya varios consolidadores mitiga además el bus factor: la ausencia de una persona no congela el sistema.

**Regla de ausencia / degradación:** si hay acciones aceptadas sin consolidar durante más de 48-72 h laborables, la vista de producto y la señal del MCP lo hacen visible ("jerarquía desactualizada desde el día X"). Las vacaciones o ausencia de un consolidador no deben confundirse con el fallo del modelo: con varios consolidadores, la suplencia es implícita; si aun así nadie consolida, eso sí es señal de kill criteria.

**Publicación universal:** al consolidar, la jerarquía se publica también como **vista de solo lectura (URL)** accesible a cualquiera de la organización, tenga o no agente IA. Una disputa se zanja señalando esa página; además sirve de modo degradado legible si el servicio MCP no está disponible.

Las acciones nuevas que aún no han pasado por consolidación aparecen explícitamente como "sin priorizar" ante el agente del dev.

### Ciclo de vida de la acción

```
registrada ──triage──▶ aceptada ──consolidación──▶ priorizada ──dev──▶ completada
                │
                ├──▶ rechazada   (no relevante; desaparece de las señales)
                ├──▶ aplazada    ("no ahora"; no genera avisos, revisable después)
                └──▶ duplicada   (fusionada con otra acción existente)
```

- **Estados de salida del triage:** el triage de producto no solo acepta — también **rechaza**, **aplaza** o marca como **duplicada**. Esto es clave para que la señal "sin priorizar" no se degrade a ruido: solo cuentan como "sin priorizar" las acciones *registradas* (pendientes de triage) y *aceptadas* (pendientes de consolidación). Las rechazadas y duplicadas desaparecen de las señales; las aplazadas no generan avisos.
- **Completar es cosa del dev:** un desarrollador puede marcar una acción como completada, adjuntando evidencia opcional — un comentario, un link al ticket (Jira/Linear), un link a la PR, etc. Esto puede hacerse desde su agente (el MCP es por tanto de lectura **y escritura**) o desde la vista web.
- Las acciones completadas salen de la jerarquía activa (no vuelven a aparecer en la consulta matinal) pero permanecen en el historial con su evidencia, fecha y autor — refuerza la trazabilidad ("ejecuté X antes que Y, aquí está la PR").
- El cierre no sincroniza estados con Jira (se mantiene el No-Go): el link es evidencia, no integración.

### Contrato del MCP: caminos no felices (principio "levantar la mano")

El principio fundacional — el agente avisa en vez de inventar prioridad — se aterriza en el contrato de respuesta:

- Toda respuesta de `get_priorities` incluye **`consolidated_at` y `consolidated_by`** (fecha, autor y razón de la última consolidación), para que el agente pueda avisar de obsolescencia ("la jerarquía vigente es del día X").
- La respuesta distingue explícitamente tres casos que jamás se confunden: **"no tienes nada pendiente"** (vacío legítimo), **"nunca se ha consolidado nada"** (sistema sin arrancar) y **"tienes acciones pero N están sin priorizar"** (bloque separado con el conteo).
- Un **error** (BD caída, timeout) se devuelve como error, nunca como lista vacía — una lista vacía por fallo haría que el agente invente la prioridad, exactamente el fallo que el producto existe para evitar.
- El MCP registra un **log de invocaciones por usuario** (necesario para los criterios de éxito y kill).

---

## 4. Solution Space

- **Appetite:** Medio — 3-6 semanas de esfuerzo para una v1 sólida con el flujo completo.
- **Selected Approach:** **B — Flujo completo.** Ingesta automática desde UNA fuente (la herramienta de transcripción más extendida entre los equipos objetivo) + registro manual, inbox de triage para producto, jerarquía draft con discusión ligera, consolidación versionada, MCP server para devs (consulta + cierre de acciones con evidencia), vista web mínima para Marta.
- **Capacidades núcleo ("no puedo volver a lo de antes"):** las cuatro — consulta vía agente (MCP), draft→consolidada, ingesta automática, historial/trazabilidad. La ingesta se acota a 1 fuente en v1 para respetar el appetite.
- **Rabbit Holes:** permisos corporativos de la Teams Graph API (puede bloquear meses); deduplicación de acciones repetidas entre fuentes; parseo de transcripts crudos.
- **No-Gos (v1):**
  - Extraer acciones con IA propia desde transcripts crudos — usamos los action items que las herramientas ya generan.
  - Sync bidireccional con Jira — las acciones pueden *enlazar* a tickets, sin sincronizar estados.
  - Priorización automática por IA — la prioridad la deciden humanos (la IA como mucho sugiere); es el corazón del producto.
  - (No excluido: una UI de consulta para devs podría llegar después; en v1 el canal es el agente/MCP.)

### Solution Candidates Considered
1. **A — Núcleo manual (≈2 semanas):** sin integraciones; todo el valor en la jerarquía + MCP. Rechazado como v1: no elimina la fricción de entrada, aunque es un buen hito intermedio de construcción.
2. **B — Flujo completo (≈4-6 semanas):** **elegido** — valida el flujo de punta a punta con una integración real sin desbordar el appetite.
3. **C — Plataforma completa (2-3 meses):** rechazado — mucho que construir antes de validar la hipótesis central; riesgo de permisos corporativos (Teams).

---

## 5. Prioritized Features

Alcance estimado, como supuesto ilustrativo de un piloto típico de un par de equipos: p. ej. ~20 usuarios (en general entre 15 y 30 personas: devs multi-iniciativa + PMs/POs/stakeholders). Impacto, confianza y esfuerzo son estimaciones iniciales del discovery (no validadas).

| Feature | MoSCoW | Reach | Impact | Confidence | Effort | RICE |
|---|---|---|---|---|---|---|
| Cierre de acciones por el dev (completar + evidencia: comentario, link a ticket/PR) | Must | 15/mo | 3 | 90% | 0.5w | 81 |
| Registro manual de acciones + inbox de triage | Must | 20/mo | 2 | 100% | 0.5w | 80 |
| Historial / trazabilidad de consolidaciones | Must | 20/mo | 2 | 80% | 0.5w | 64 |
| Jerarquía draft + consolidación versionada | Must | 20/mo | 3 | 90% | 1.5w | 36 |
| MCP server de consulta (prioridad global + señal "sin priorizar") | Must | 15/mo | 3 | 80% | 1w | 36 |
| Ingesta automática desde 1 fuente (Fireflies/Granola) | Must | 20/mo | 2 | 60% | 1.5w | 16 |
| Vista web mínima para producto (triage + ordenar + consolidar) | Must | 5/mo | 3 | 80% | 1.5w | 8 |
| Comentarios/discusión ligera sobre el draft | Should | 8/mo | 1 | 60% | 1w | 5 |
| Memoria organizacional de transcripts (base de conocimiento consultable) | Won't (v1) → candidata v2 | — | — | — | — | — |

Notas:
- La vista web de producto puntúa bajo en RICE por su reach pequeño (solo PMs), pero es **habilitadora**: sin ella la priorización no se mantiene fresca. Se mantiene Must.
- La ingesta automática tiene la confianza más baja (incógnitas de API); es el Must que conviene construir en último lugar.
- El cierre de acciones convierte el MCP en lectura + escritura (`get_priorities` + `complete_action`); su esfuerzo asume que reutiliza la auth/identidad del propio MCP.
- La publicación de la vista de solo lectura (URL) al consolidar y el log de invocaciones MCP van incluidos dentro de las features de jerarquía y MCP respectivamente (coste marginal, no filas propias).
- Esfuerzo total Must: **7 semanas-persona** — por encima del appetite (3-6 sem). Mitigación: secuenciar en dos hitos. *(La revisión multi-lente — ver `review-gaps-2026-08-11.md` G1 — señala que, con dedicación parcial, esto son varios meses de calendario; pendiente de decisión.)*

### MVP Definition

- **Hito 1 — Núcleo (semanas 1-3):** registro manual + inbox, jerarquía draft→consolidada versionada, historial, MCP server de consulta **y cierre** (el dev completa acciones con evidencia desde su agente). *(Equivale al enfoque A: ya utilizable y valida las hipótesis centrales.)*
- **Hito 2 — Flujo completo (semanas 4-6):** vista web de producto pulida + ingesta automática desde la fuente más usada por los equipos del piloto. Comentarios sobre el draft solo si sobra tiempo (Should).
- **Success Criteria** (ventana única de evaluación: **4 semanas** de piloto; los umbrales concretos suponen, a modo ilustrativo, un piloto pequeño con unos ~6 devs; con tan pocos devs los porcentajes no son fiables, así que se miden **conteos absolutos con nombre**):
  1. **Hábito de consulta dev:** al menos 4 de los ~6 devs del piloto consultan la jerarquía vía su agente ≥3 días/semana. *Instrumentación: log de invocaciones MCP por usuario (incluido en la feature MCP).*
  2. **Priorización fresca:** tiempo medio entre "acción aceptada en triage" y "acción consolidada con prioridad" < 2 días laborables. *Instrumentación: timestamps de estado, gratis con el modelo de datos.*
  3. **Fin de la disputa:** en la retro del piloto, la mayoría de los stakeholders (p. ej. ≥4 de 6 encuestados) declara haber resuelto al menos un conflicto de prioridad señalando la fuente central en vez de imponerlo por canal paralelo.
  4. **Cobertura (auditoría muestreada):** se auditan manualmente **3 reuniones** del piloto contra la herramienta; ≥80% de sus action items relevantes aparecen registrados. *(La cobertura total es inmedible por construcción: el denominador es justo lo que la herramienta no ve.)*
- **Kill Criteria** (misma ventana de 4 semanas): si la jerarquía consolidada caduca sistemáticamente (>1 semana con acciones aceptadas sin consolidar) pese a haber reducido la fricción de la UI **y sin que se explique por ausencia puntual de los consolidadores** (ver regla de ausencia en §3), o los devs consultan <1 vez/semana, parar y replantear: el problema sería organizativo (autoridad/disciplina), y más software no lo arregla.

---

## 6. Risk Assessment

| Risk Type | Level | Evidence | Mitigation |
|---|---|---|---|
| Value | Medio | El dolor es un patrón muy extendido y típicamente crítico (5/5), pero ningún equipo ha comprometido uso diario ni hay piloto acordado | Antes de construir el Hito 2, acordar un piloto con 1-2 equipos y una persona de producto comprometida |
| Usability | **Alto** | El punto de fallo previsto es que producto no mantenga el ritmo de consolidación → jerarquía obsoleta → los devs dejan de confiar | Hacer la consolidación trivial (minutos, no horas); señal explícita de "sin priorizar" que presiona socialmente; medir frescura desde el día 1 |
| Feasibility | Medio | El núcleo (CRUD + versionado + MCP) es terreno conocido; la incógnita es la calidad de los action items de las APIs de Fireflies/Granola (duplicados, responsable, idioma) | Spike temprano contra la API real antes de comprometer el diseño de la ingesta; por eso la ingesta es el último Must en construirse |
| Viability | Bajo | Se despliega dentro de la propia organización que lo adopta; los datos de reuniones permanecen en herramientas ya aprobadas (v1 solo almacena acciones, no transcripts) | Mantener v1 sin almacenar transcripts crudos; revisar si la memoria organizacional (v2) requiere aprobación de seguridad |

- **Biggest Unknown:** **Disciplina de producto** — que Marta y los stakeholders mantengan viva la priorización. Si la jerarquía caduca, los devs dejan de confiar y todo el sistema muere, aunque la tecnología funcione perfectamente.
- **Recommended MVP Type:** **Single-Feature/Balanced con componente Concierge.** Construir el Hito 1 (núcleo manual + MCP) y, en paralelo, ejercer de facilitador humano del ritual de consolidación durante el piloto (concierge) para validar la disciplina de producto ANTES de invertir en la ingesta automática del Hito 2. El mayor riesgo es de comportamiento, no técnico — se valida con personas, no con más código.

---

## 7. Competitive Landscape

| Competitor | Strengths | Weaknesses | Our Angle |
|---|---|---|---|
| Statu quo (Confluence + chats + Jira ad hoc) | Cero fricción de adopción; hábitos ya instalados | Dispersión total, sin prioridad global, conflictos entre stakeholders | El rival real es la inercia: la barrera es el cambio de hábito, no otra herramienta. Atacarlo reduciendo la fricción de entrada (ingesta automática) y de consulta (el agente que ya usan) |
| Linear Triage / Jira Triage Agent | Inbox de triage maduro, nativo del tracker | Solo ve SU tracker; sin prioridad cross-proyecto ni trazabilidad de prioridades | Consolidamos cross-fuente y cross-proyecto, por encima de los trackers |
| Akiflow / Motion / Sunsama | Consolidación multi-fuente pulida | Priorización **personal**: cada individuo se ordena a sí mismo; sin autoridad de producto ni fuente de verdad compartida | Nuestra prioridad es de equipo/producto, acordada y con autoridad, no personal |
| Integraciones nativas Fireflies/Otter → Asana/Jira | Ingesta reunión→tarea resuelta y madura | Punto-a-punto: fragmentan por proyecto/herramienta, agravando el problema | Somos la capa de convergencia que esas integraciones no tienen |

- **Positioning:** A diferencia de los consolidadores personales (Akiflow, Motion) y del triage de un solo tracker (Linear, Jira), Prioritizer consolida las acciones de reuniones de cualquier fuente y les da UNA prioridad global acordada con autoridad de producto — versionada, trazable y consultable por los agentes de IA de los devs.

---

## 8. Oportunidad futura (v2): memoria organizacional de transcripts

Añadido al cierre del discovery: almacenar los transcripts completos para construir una base de conocimiento de toda la organización, consultable posteriormente como memoria (p. ej. "¿qué se decidió sobre X y por qué?").

- **Por qué no en v1:** dispara la sensibilidad de datos (la viabilidad es "baja" precisamente porque v1 no almacena transcripts, solo acciones); es un producto en sí mismo (RAG organizacional) y desbordaría el appetite.
- **Puerta abierta desde v1:** cada acción guarda la **referencia** a su transcript/reunión de origen (herramienta + id + fecha). Ese linaje es barato hoy y es la semilla de la memoria organizacional mañana.
- **Sinergia:** la trazabilidad de prioridades + el linaje de acciones ya forman una "memoria de decisiones de ejecución"; los transcripts añadirían la memoria del *contexto* de esas decisiones.

---

## Appendix: Research Notes (mercado 2025-2026)

### Qué existe hoy
1. **Transcriptores con envío de action items a task managers:** Fireflies (tareas automáticas en Asana/Jira/Linear), Otter ("My Action Items" personal + agentes hacia Asana/ClickUp), Fathom y tl;dv (vía Zapier/n8n), Fellow (sync bidireccional con Jira/Asana), Teams/Copilot (Intelligent Recap → Planner).
2. **Consolidadores multi-fuente:** Akiflow, Morgen, Sunsama, Motion — todos de priorización **personal/diaria**, no de producto/equipo.
3. **Plataformas de priorización de producto:** Productboard, airfocus — priorizan *features/feedback*, no action items de reuniones.
4. **Triage nativo en trackers:** Linear Triage (inbox por equipo), Jira Triage Agent — solo dentro de su propio tracker.

### Gaps identificados (validan la oportunidad)
1. Nadie consolida action items de **múltiples transcriptores** en una vista única priorizada globalmente; las integraciones existentes son punto-a-punto y fragmentan por proyecto/herramienta.
2. Ningún producto ofrece **historial/auditoría de cambios de prioridad** como ciudadano de primera clase (Jira solo tiene history genérico por issue).
3. La señal de **"sin priorizar"** solo existe dentro de un tracker (Linear Triage); no hay inbox global cross-fuente para producto.
4. Existen MCP servers por herramienta (Linear, Jira/Atlassian GA feb-2026, Asana v2, Fireflies, Granola), pero **no un MCP que responda "¿qué es lo más prioritario hoy a nivel global?"** combinando fuentes — exactamente la intersección de este producto.

### APIs/integraciones disponibles para ingesta
- **Fireflies:** API GraphQL + MCP server remoto oficial (api.fireflies.ai/mcp, OAuth) con transcripts, summaries y action items.
- **Granola:** API REST pública (GET /v1/notes), export CSV, MCP server oficial (feb-2026) que expone action items estructurados.
- **Teams/Copilot:** Microsoft Graph Meeting AI Insights API (GA v1.0 nov-2025): `GET /copilot/users/{id}/onlineMeetings/{meetingId}/aiInsights` — devuelve action items en JSON; requiere permiso `OnlineMeetingAiInsight.Read.All` + application access policy.
- **Otter:** API pública + webhooks + Zapier. **Fathom/tl;dv:** webhooks y MCP vía Zapier.

### Fuentes
- Fireflies MCP: https://docs.fireflies.ai/getting-started/mcp-configuration · Granola MCP: https://docs.granola.ai/help-center/sharing/integrations/mcp
- Graph Meeting AI Insights: https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/meeting-transcripts/meeting-insights
- Otter API: https://help.otter.ai/hc/en-us/articles/36130822688279-Otter-ai-Public-API
- Atlassian MCP GA: https://www.mindstudio.ai/blog/atlassian-mcp-server-ga-claude-reads-writes-jira-confluence-compass-oauth · Asana MCP: https://developers.asana.com/docs/using-asanas-mcp-server
- Linear Triage: https://linear.app/docs/triage · Comparativas consolidadores: https://blog.rivva.app/p/motion-vs-sunsama-vs-akiflow
