# Revisión multi-lente del discovery — Gaps consolidados

**Documento revisado:** `discovery-prioritizer-2026-08-11.md`
**Fecha:** 2026-08-11
**Método:** 5 revisores independientes (coherencia, factibilidad, producto/estrategia, scope, adversarial) · ~65 hallazgos brutos → 10 temas consolidados. Se listan por severidad combinada y nº de lentes que convergen.

---

## Temas críticos (bloquean el paso a la planificación)

### G1. La aritmética del appetite está rota — desbordamiento de 3-5x, no "ligeramente por encima"
**Convergen: factibilidad, scope, adversarial, coherencia (4/5)**

6,5 semanas-persona son ~260 h. Con una dedicación parcial (p. ej. 8-12 h/semana) eso son **17-33 semanas de calendario (4-7 meses)**, no 3-6 semanas. La frase "ligeramente por encima del appetite" es la que permite que todo el scope sobreviva sin escrutinio; y la mitigación declarada ("secuenciar en dos hitos") reparte el esfuerzo pero no lo reduce. Además, la estimación no incluye el "impuesto de infraestructura" (hosting, auth, onboarding del MCP en cada máquina): +0,5-1 semana-persona.

**Resolución:** declarar las horas/semana reales disponibles, expresar todo en horas, y fijar el appetite como techo duro (~60 h ≈ 1,5 semanas-persona para la v1). El scope se recorta hasta caber (ver G4).

### G2. Se construye antes de validar lo que puede matar el producto — el concierge debe ir DELANTE, no "en paralelo"
**Convergen: producto, adversarial, scope, factibilidad (4/5)**

El propio documento declara que el mayor riesgo es conductual ("se valida con personas, no con más código") y que el kill criteria es organizativo — pero la secuencia gasta todo el presupuesto en código antes de poder evaluar esa condición de parada, y arranca sin un solo usuario comprometido. El piloto está como prerrequisito del Hito 2; debe serlo del Hito 1.

**Resolución — Hito 0 (una semana + dos, cero código), en este orden:**
1. **Nombrar a la autoridad (15 min):** preguntar por separado a 5-6 stakeholders "si A y B compiten por el mismo dev, ¿quién decide? Escribe un nombre". 3+ nombres distintos = supuesto falsado, no construir.
2. **Exportar los action items reales de 2 semanas (unas horas):** vía CSV/API de Granola o MCP de Fireflies. Contar ítems/día, % accionables, % duplicados, % con responsable resoluble. Decide si el triage son 5 o 45 min/día.
3. **Clasificar una semana real de 3 devs por origen del trabajo (una tarde):** si las acciones de reunión son <30% de su tiempo, la jerarquía no puede llamarse "global" (ver G5).
4. **Wizard-of-Oz de 2 semanas:** hoja de cálculo o markdown en git, un facilitador hace de concierge, Marta consolida. Medir minutos/día y —el dato que es todo el producto— **si sigue consolidando en la semana 2 cuando nadie se lo recuerda**.

### G3. El supuesto crítico de autoridad es circular y no tiene mecanismo en el scope
**Convergen: adversarial, coherencia, producto (3/5)**

El doc marca "existe UNA persona con autoridad real" como supuesto crítico con evidencia *none*… y define la persona Marta por esa misma propiedad. Nunca se decide **quién puede consolidar ni qué pasa si no hay acuerdo** (¿Marta decide sola escuchando, o la consolidación requiere aprobación? — dos productos distintos). Y el único mecanismo de consenso del scope ("comentarios sobre el draft") es Should "si sobra tiempo": un Must (jerarquía draft) depende funcionalmente de un Should para cumplir su propósito. Si la autoridad no existe, el producto no elimina la negociación: la reubica en el draft, donde se atasca — y con el diseño bloqueante, un fallo blando (el dev improvisa) se convierte en duro (el trabajo se para).

**Resolución:** para v1, regla explícita: *el consenso es un ritual humano fuera de la herramienta; Marta consolida unilateralmente tras escuchar; la herramienta publica, fecha y firma el resultado*. Comentarios pasan de Should a **Won't v1**. Precondición de piloto (no feature): una autoridad nombrada por escrito.

### G4. El documento ya eligió el enfoque A y no lo reconoce — y el Hito 1 deja sin interfaz justo a la persona cuya disciplina se quiere validar
**Convergen: coherencia, factibilidad, scope, producto (4/5)**

Tres afirmaciones incompatibles: §4 rechaza A como v1; §5 dice que el Hito 1 "equivale al enfoque A"; §6 recomienda validar antes de construir el Hito 2. Además la vista web de Marta está contada una vez pero se necesita dos (¿con qué interfaz triagea y consolida en el Hito 1?), el "inbox de triage" y la "vista web (triage…)" se solapan, y el MoSCoW no decide nada (6 de 7 Must; se pidieron 2-3 capacidades núcleo y se marcaron 4).

**Resolución — walking skeleton de ~1,5 semanas-persona como v1 real:**
- Almacén de acciones con 4 campos (texto, iniciativa, linaje, estado).
- **Una** pantalla web: lista ordenable + sección "sin priorizar" + botón Consolidar (snapshot inmutable fechado y firmado). Sin inbox separado — es un filtro/estado de la misma lista.
- MCP con `get_priorities()` (+ parámetro `as_of` para el historial) y conteo de sin-priorizar; **logging de invocaciones incluido** (los criterios de éxito dependen de él).
- El historial no se construye: se **deriva** de consolidaciones inmutables append-only.
- Ingesta automática: **fuera de v1, condicionada** al resultado del piloto y al conteo del spike (G2.2). Sin capa de adaptadores multi-fuente hasta que exista la segunda integración comprometida; cero deduplicación en v1.

### G5. Segunda fuente de verdad que compite con Jira + nadie cierra nunca una acción
**Convergen: adversarial, factibilidad (2/5, pero es la premisa más portante)**

Dos roturas: (a) el día de Juan no son solo acciones de reunión — tickets de sprint, bugs, incidencias; una jerarquía que ordena solo el subconjunto de reuniones no puede responder "¿qué ataco primero?", que es el JTBD literal; (b) sin sync (No-Go correcto), la acción sigue "pendiente" semanas después de cerrarse el ticket: la obsolescencia de **estado** mata el sistema antes que la de prioridad, y no hay ciclo de vida definido (¿quién marca "hecha" y por qué superficie? ¿el MCP es read-only o read-write?).

**Alternativa nunca evaluada:** Prioritizer como **capa de ranking sobre el tracker** (la acción se casa con un issue al aceptarse en triage; el producto solo posee el orden global + historial + MCP; Jira es el estado). Elimina la segunda fuente de verdad y reduce el build.

**Resolución:** correr el experimento G2.3; decidir explícitamente almacén-paralelo vs capa-sobre-tracker y el ciclo de vida completo de la acción **antes** de planificar.

---

## Temas importantes (resolver en la próxima iteración del doc)

### G6. Orden total vs alternativas más baratas (adversarial)
Un orden estricto 1-N cuesta caro de mantener (cada entrada nueva invalida todo lo de abajo, cada urgencia fuerza re-consolidación versionada), decide posiciones 7-vs-8 que no valen nada, e ignora el tamaño de las acciones. Alternativas no consideradas: **bandas/tiers** (~90% del valor por ~10% del coste), top-3 por dev, límites de WIP, asignación de capacidad. **Resolución:** en el Wizard-of-Oz (G2.4), probar orden total y bandas en paralelo, cronometrar y medir rotación a los 3 días.

### G7. Incentivos y poder, no fricción (adversarial, producto)
Marta paga un coste diario cierto por un beneficio difuso; Juan cobra gratis — los sistemas con esa asimetría colapsan por el lado que paga, y la mitigación actual trata incentivos como fricción. La "presión social" de la señal sin-priorizar apunta contra la única persona imprescindible. El bypass por Slack no tiene coste y quien lo usa es quien evalúa al dev; si dirección lee el historial, el escudo del dev se convierte en vigilancia y el incentivo se invierte. **Resolución:** definir qué gana Marta egoístamente al consolidar (p. ej. el artefacto con el que responder "por qué lo tuyo es el 7"); decidir por escrito quién puede leer el historial; mecanismo de absorción de urgencias (registrar el desvío a posteriori con autor) en vez de solo lista canónica; "bloqueada" → "visible con excepción registrable" (nadie se queda parado).

### G8. Decisiones de arquitectura-producto sin tomar (factibilidad, coherencia)
Un implementador no puede empezar mañana sin decidir: **identidad/auth del MCP** (stdio local + tokens manuales + tabla de alias persona↔transcript es lo coherente con el appetite; sin SSO), **unidad de alcance de la jerarquía** (una lista global filtrada por responsable — decidirlo y escribirlo), **asignación de responsable** (¿en el triage? ¿qué pasa sin responsable?), **despliegue** (dónde vive, de quién es el dato durante el piloto), **contrato MCP de caminos no-felices** (vacío ≠ nunca-consolidado ≠ error; incluir `consolidated_at` para que el agente avise de obsolescencia — sin esto, el agente "inventa prioridad", el fallo exacto que el producto existe para evitar), **estados de salida del triage** (nueva / rechazada / aplazada / duplicada — hoy todas caen en "sin priorizar" y la señal se degrada a ruido en una semana), y **política ante ausencia del consolidador** (bus factor: vacaciones de Marta disparan hoy el kill criteria por la razón equivocada; regla de degradación explícita + una línea de "razón" obligatoria por consolidación).

### G9. Métricas que miden actividad, no valor — y no instrumentables (producto, scope, factibilidad, adversarial)
Criterio 4 (cobertura ≥80%) es inmedible por construcción (el denominador es lo que la herramienta no ve) → sustituir por auditoría muestreada de 3 reuniones. Porcentajes sobre n≈5 devs → conteos absolutos con nombres. Ventanas inconsistentes (1 mes vs 3-4 semanas) → unificar en 4. Sin línea base (minutos/mañana decidiendo, reprioritizaciones por DM/semana — capturarla en el Hito 0). Añadir un outcome real: % de la semana-dev en ítems del top-N vigente. Definir el **criterio de salida del concierge** (semana 3: el facilitador deja de consolidar; si la frescura cae, no es viable). Los criterios 1-3 hoy no distinguen "el sistema funciona" de "el facilitador trabaja mucho".

### G10. El baseline real y el buy-vs-build (producto, adversarial)
El do-nothing honesto no es "Confluence + chats": es **el agente que ya usan + un prompt sobre los MCP existentes** (Fireflies, Granola, Atlassian) — eso cubre consolidación y consulta; lo único que no está a un prompt de distancia es la **autoridad humana acordada**, justo la parte sin evidencia. Tampoco se evaluó Notion/Airtable + su MCP (cubriría ~4 de 6 Musts en días). **Resolución:** experimento de la skill de 20 líneas con un dev una semana; sección "Alternativas no-build" en el doc justificando el build contra ellas — o adoptando una como v1.

---

## Menores
- **Vocabulario:** fijar glosario (acción / action item / ticket; **iniciativa** como unidad; eliminar "tarea", "proyecto", "producto" como sinónimos) y cerrar el "(a explorar)" de §1.
- **Trazabilidad como Must:** sin demanda evidenciada (nadie la pidió); se mantiene solo porque es gratis si las consolidaciones son snapshots inmutables — no dedicarle UI propia.
- **Anti-user "equipos sin agente" vs criterio "fin de la disputa":** no se puede zanjar una disputa señalando una lista que la mitad de los disputantes no puede ver → publicar el consolidado como URL/página de solo lectura (coste casi nulo).
- **No-Go autoexcluyente:** "una UI de consulta para devs podría llegar después" → convertir en No-Go duro: si el canal MCP no se usa, es señal de kill, no de construir otra interfaz.
- **Registrar el porqué:** el historial guarda qué/cuándo/quién pero nunca el porqué — una línea de razón obligatoria por consolidación lo resuelve.
- **Idioma de action items:** declararlo fuera de alcance explícitamente (no-problema, no gastar spike en ello).

## Lo que las cinco lentes coinciden en NO tocar
- Los **No-Gos** de §4 (sin IA propia de extracción, sin sync bidireccional, sin priorización automática): cada uno evita un subproducto entero.
- El **kill criteria** en su formulación (mide comportamiento y nombra la causa organizativa) — solo hay que hacerlo evaluable antes (G2) y robusto a vacaciones (G8).
- La **memoria organizacional diferida a v2** con linaje barato desde v1 (guardar referencia herramienta+id+fecha es un campo, no una arquitectura). Guardarraíl: v2 no puede añadir requisitos a v1.
- El **diagnóstico** "el mayor riesgo es de comportamiento, no técnico" — es correcto; el problema es que hitos y tabla de features no lo obedecen.
- Secuenciar la ingesta la última por ser la de menor confianza (aunque el spike de datos debe ser el día 1: es gratis).

---

## Secuencia recomendada
1. **Esta semana (cero código):** los 3 experimentos cortos de G2 (autoridad, conteo de action items, origen del trabajo de los devs) + skill-prompt de G10.
2. **Semanas 1-2:** Wizard-of-Oz con bandas vs orden total (G2.4, G6), capturando baseline (G9).
3. **Gate go/kill.** Si sobrevive: actualizar el discovery con las decisiones de G3, G5 y G8, recortar la tabla de features al walking skeleton (G4) y entonces sí, planificar.
