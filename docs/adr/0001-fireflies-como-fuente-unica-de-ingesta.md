# 1. Fireflies como fuente única de ingesta en v1

- **Fecha**: 2026-08-12
- **Estado**: Aceptada. La elección se apoya en adopción, encaje y coste; el **encaje técnico** está
  decidido sobre documentación pública, **sin validar contra datos reales**
- **Origen**: el spike de ingesta. Condiciona el adaptador de ingesta y los alias persona↔transcript.
- **Léete también**: `docs/spikes/2026-08-12-spike-de-ingesta.md` — el esquema campo a campo, las
  incógnitas de la API ordenadas por impacto y lo que el adaptador de ingesta se encontrará en el
  núcleo. Y `test/fixtures/ingest/`, las fixtures **sintéticas** que salieron de este spike.

## Contexto

La spec v1 pide ingerir los action items **ya estructurados** de UNA herramienta de transcripción,
nunca transcripts crudos, y deja la elección concreta —Fireflies o Granola— a este spike. La spec
también restringe la infraestructura a «un único servicio desplegable con persistencia sencilla, sin
dependencias de pago más allá de lo imprescindible».

El spike se ha hecho **contra la documentación publicada de ambas APIs**, no contra las APIs en vivo:
no se ha usado ninguna credencial ni datos de reuniones reales. Lo que sigue es una decisión de encaje
técnico, no una decisión validada con reuniones reales.

## Opciones

### Fireflies

API GraphQL en `https://api.fireflies.ai/graphql`, autenticación `Authorization: Bearer <api_key>`.

- Tiene un campo **dedicado** a las acciones: `Summary.action_items`.
- La clave de API está **disponible en todos los planes, incluido el gratuito**.
- Límites por plan: 50 peticiones/día en Free, 500/día en Pro, 60/minuto en Business y Enterprise.
- Paginación de la query `transcripts`: `limit` (máximo 50) y `skip`, con ventana `fromDate`/`toDate`.
- Webhook `Transcription complete`, firmado con HMAC SHA-256 en la cabecera `x-hub-signature`.
- Id de reunión estable y unificado: su documentación dice que «MeetingId and TranscriptId are used
  interchangeably for the Fireflies.ai Platform».

### Granola

API REST en `https://public-api.granola.ai/v1`, OpenAPI 3.1, autenticación `Bearer` con claves `grn_`.

- **No tiene ningún campo de action items.** El esquema completo de `Note` es `id`, `object`, `title`,
  `owner`, `created_at`, `updated_at`, `web_url`, `calendar_event`, `attendees`, `folder_membership`,
  `summary_text`, `summary_markdown`, `transcript`. Las acciones existen solo como prosa dentro de
  `summary_markdown`, y solo si la plantilla de notas del usuario incluye una sección así — las
  plantillas son personalizables, con lo que ni el nombre de la sección está garantizado.
- El acceso a la API está **detrás del plan Business, 14 $/usuario/mes**.
- Límites holgados: ráfagas de 25 peticiones/5 s y 5 peticiones/s sostenidas (300/min).
- Paginación por cursor con `page_size`, y filtro **`updated_after`**.
- Webhooks `note.generated` y `note.edited`, firmados con HMAC SHA-256 (Standard Webhooks).
- Ids estables `not_[a-zA-Z0-9]{14}`.

## Decisión

**Fireflies es la fuente única de ingesta de v1.**

Tres razones, por orden de peso:

0. **Es la de menor fricción de adopción.** La spec pide la herramienta más usada por los equipos
   objetivo. Fireflies es de las más extendidas entre equipos de producto y desarrollo, da clave de
   API en todos los planes (también el gratuito) y publica su esquema, así que un equipo que ya la
   usa puede conectar la ingesta sin cambiar de plan ni de herramienta. Si la organización que
   adopta Prioritizer usa otra mayoritariamente, esta razón se cae (ver «Bajo qué evidencia habría
   que reconsiderar»); las dos que siguen se sostienen solo sobre capacidades técnicas y coste.
1. **Es la única de las dos que genera algo que se pueda consumir.** La spec marca como No-Go extraer
   acciones de transcripts crudos: hay que consumir lo que la herramienta ya produce. Granola no
   produce nada: obliga a buscar una sección de markdown que puede llamarse de cualquier forma o no
   existir, lo que es exactamente el No-Go con otro nombre. Fireflies expone un campo que se llama
   `action_items`, que Fireflies mismo genera y agrupa por hablante.
2. **Coste.** Granola exige plan Business para tocar la API: 14 $ por usuario y mes solo por poder
   ingerir, un coste que crece con cada asiento del equipo que se incorpora. Fireflies da clave de
   API en todos los planes. La spec pide no añadir dependencias de pago que no sean
   imprescindibles, y esta no lo es.

**Con toda honestidad, la ventaja del punto 1 es de grado y no de naturaleza**: `action_items` está
tipado como `String` nullable, no como una lista. Aunque su descripción en el esquema es «A list of
action items», y aunque esa misma tabla sí tipa `topics_discussed` como `[String]` cuando quiere decir
lista, lo que llega es un bloque de texto y el adaptador va a tener que partirlo igual. La
diferencia real es que en Fireflies ese texto es un campo dedicado, siempre presente por nombre y
agrupado por hablante, y en Granola es una sección opcional dentro de un documento libre.

## Qué se pierde al descartar Granola

No es una opción mala; se pierden cosas concretas:

- **`updated_after`**. Es el filtro que hace natural una sincronización incremental. Fireflies solo
  documenta ventanas por **fecha de creación del transcript** (`fromDate`/`toDate`), no por fecha de
  modificación: si un resumen se regenera tres semanas después conserva su fecha de creación y ninguna
  consulta por ventana reciente lo delata.
- **El webhook `note.edited`**. Granola avisa cuando un resumen cambia. Fireflies solo avisa cuando la
  transcripción termina, así que las regeneraciones posteriores son invisibles.
- **Límites de tasa mucho mejores** y paginación por cursor en vez de `skip` (que se descuadra cuando
  entra material nuevo entre dos páginas).
- **Un OpenAPI legible por máquina**, frente a una documentación de esquema que en varios puntos no
  precisa la opcionalidad de los campos.

## Consecuencias

- El adaptador de ingesta incluye, quiera o no, **un parser de texto libre**. Es el riesgo principal de
  la ingesta y hay que tratarlo como tal: tolerante, con traza de lo que no supo interpretar, y sin
  acoplarse a un único formato. El formato exacto de la cadena **no está documentado**.
- La idempotencia de la spec (clave herramienta + id de origen) se puede cumplir, porque el id de
  transcript es estable. Pero es un id **por reunión, no por acción**: ver la nota de incógnitas.
  Cómo se resolvió está en `docs/adr/0002-clave-de-idempotencia-de-la-ingesta.md`.
- No hace falta ningún cliente de GraphQL: la query se manda con un `POST` y `fetch`, coherente con la
  restricción de no meter infraestructura.
- Las fixtures del spike (`test/fixtures/ingest/`) son **sintéticas**, construidas contra el esquema
  publicado. Hay que volver a grabarlas contra datos reales antes de confiar en el parser.

## Bajo qué evidencia habría que reconsiderar

Esta decisión se tomó sin datos reales. Se reabre si aparece cualquiera de estas:

1. **La organización que lo adopta no usa mayoritariamente Fireflies.** Es la evidencia que más pesa:
   la razón 0 de la decisión desaparece y conviene ingerir de la herramienta que sí se usa.
2. **La organización que lo adopta ya paga Granola Business.** El argumento del coste desaparece, y
   entonces `updated_after` y `note.edited` inclinan la balanza al otro lado.
3. **El parser no alcanza precisión aceptable** sobre la cadena real de `action_items`, medido sobre las
   dos semanas de datos que este spike no pudo medir.
4. **La clave de API no ve las reuniones de todo el equipo**, solo las propias. Sería un fallo de
   requisito, no un inconveniente: ver la nota de incógnitas.
5. **Fireflies expone acciones estructuradas para reuniones terminadas.** Ya tiene el tipo
   `LiveActionItem` (`{ name: String, action_item: String! }`) para reuniones **en curso**; si eso
   llega a las reuniones ya procesadas, el parser sobra.

## Fuentes

Consultadas el 2026-08-12.

- Esquema `Summary` (donde `action_items` figura como `String`): https://docs.fireflies.ai/schema/summary
- Esquema `Transcript`: https://docs.fireflies.ai/schema/transcript
- Esquema `MeetingAttendee`: https://docs.fireflies.ai/schema/meeting-attendee
- Query `transcripts`, argumentos y `limit` máximo 50: https://docs.fireflies.ai/graphql-api/query/transcripts
- Query `live_action_items` (estructurada, solo reuniones en vivo): https://docs.fireflies.ai/graphql-api/query/live_action_items
- Límites por plan: https://docs.fireflies.ai/fundamentals/limits
- Códigos de error: https://docs.fireflies.ai/miscellaneous/error-codes
- Webhooks y equivalencia meetingId/transcriptId: https://docs.fireflies.ai/graphql-api/webhooks
- Acceso a la API en todos los planes: https://guide.fireflies.ai/articles/3737786777-fireflies-api-overview-get-api-key
- Granola, introducción, autenticación y límites: https://docs.granola.ai/introduction
- Granola, esquema `Note` (OpenAPI): https://docs.granola.ai/api-reference/openapi.json
- Granola, webhooks: https://docs.granola.ai/webhooks
- Granola, plantillas personalizables: https://docs.granola.ai/help-center/taking-notes/customise-notes-with-templates.md
- Granola, precios: https://www.granola.ai/pricing
