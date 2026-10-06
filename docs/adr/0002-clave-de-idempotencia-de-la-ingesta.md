# 2. La clave de idempotencia de la ingesta es reunión + texto del ítem

- **Fecha**: 2026-08-12
- **Estado**: Aceptada
- **Origen**: el adaptador de ingesta (ingesta con linaje e idempotencia), sobre la incógnita B-1
  del spike de ingesta.
- **Léete también**: `docs/spikes/2026-08-12-spike-de-ingesta.md` (incógnita B-1, y las fixtures
  `06-idempotencia-primera-pasada.json` y `07-idempotencia-segunda-pasada.json`, hechas para este caso).

## Contexto

La spec fija la idempotencia de la ingesta en «clave: herramienta + id de origen». El problema es que
**el id que da Fireflies es del transcript, no del ítem**: una reunión con cuatro acciones tiene un
único id. Y sus resúmenes **se pueden regenerar** —cambiando de plantilla, refinando, o simplemente
al corregir la etiqueta de un hablante—, así que una segunda pasada puede traer un texto distinto
bajo el mismo id.

Además, Fireflies **no ofrece ningún filtro por fecha de modificación** ni webhook de «resumen
regenerado»: la única forma de enterarse de un cambio es volver a leer la reunión en una ventana que
la incluya.

## Opciones

1. **Clave = herramienta + id de transcript.** La letra de la spec. Simple, y la unidad de ingesta
   pasa a ser la reunión entera: o entran las cuatro acciones o ninguna. **Pierde para siempre**
   cualquier acción que aparezca en una regeneración posterior, sin dejar rastro de la pérdida.
2. **Clave = herramienta + id de transcript + posición del ítem en la lista.** Distingue ítems dentro
   de una reunión. Pero si la lista se reordena al regenerarse, la acción 3 pasa a ser otra cosa **en
   silencio**: se pisaría una acción con el texto de otra.
3. **Clave = herramienta + id de transcript + hash del texto normalizado del ítem.** Recoge lo nuevo
   de una regeneración, pero una reescritura menor («antes del viernes» añadido al final) entra como
   una acción más, y las dos versiones conviven en el inbox.

## Decisión

**La clave es herramienta + id de origen + hash del texto normalizado del ítem** (opción 3).

La normalización es deliberadamente ligera —NFC, espacios colapsados, minúsculas— para que un salto
de línea o una mayúscula no pasen por un cambio, y para que un cambio de verdad sí lo sea.

El criterio que decide es **hacia qué lado equivocarse**:

- La opción 3 se equivoca hacia el **duplicado visible**, y la spec ya manda resolver eso a mano: el
  triage tiene la salida `duplicada` justo para esto, y la dedup automática es un No-Go explícito.
- Las opciones 1 y 2 se equivocan hacia el **fallo invisible**: una acción que nunca llega, o una que
  se sustituye por otra sin que nadie se entere. Un fallo invisible es peor que un duplicado visible,
  porque el duplicado tiene dueño y camino de salida, y la pérdida no tiene ni una ni otro.

Nada se pisa y nada se pierde: la ingesta solo añade.

## Consecuencias

- **Un resumen regenerado infla el inbox.** Con la fixture `07-`, la reunión regenerada aporta dos
  acciones nuevas —la reescrita y una realmente nueva— mientras la versión vieja del texto sigue en
  el inbox. Son tres donde un humano vería dos. La historia 11 quiere un inbox que no se degrade a
  ruido, así que **esto es deuda real** y hay que vigilarla en un despliegue real: si las regeneraciones son
  frecuentes, la opción 1 vuelve a la mesa con datos encima.
- **La clave la garantiza la base de datos**, con un índice único sobre
  `(source_tool, source_id, source_item_hash)` (migración 8). SQLite cuenta los NULL como distintos
  en un índice único, así que las acciones manuales —las tres columnas a null— nunca chocan.
- **El hash se deriva del texto en el mismo `insert` que lo guarda** (`ingestKey`, en
  `src/core/actions.ts`), para que la clave almacenada no pueda discrepar del texto almacenado.
- **La ingesta promete capturar reuniones nuevas, no correcciones tardías.** Como Fireflies solo
  filtra por fecha de creación, un resumen regenerado tres semanas después ya no cae en la ventana
  reciente y no entra. La clave fina no arregla eso; solo evita perder lo que sí vuelve a leerse.

## Bajo qué evidencia habría que reconsiderar

1. **Las regeneraciones resultan frecuentes** y el inbox se llena de pares casi idénticos, medido
   sobre datos reales de un despliegue. Sería el argumento para volver a la opción 1.
2. **Fireflies publica un id por ítem** o extiende `LiveActionItem` (`{ name, action_item }`) a las
   reuniones ya terminadas. Entonces la clave es el id del ítem y esta decisión sobra entera.
3. **Fireflies publica un filtro por fecha de modificación** o un webhook de resumen regenerado. No
   cambia la clave, pero sí cambia lo que la ingesta puede prometer.
