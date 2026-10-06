# 3. Los alias se comparan por mayúsculas y espacios, y por nada más

- **Fecha**: 2026-08-12
- **Estado**: Aceptada
- **Origen**: los alias persona↔transcript, sobre las incógnitas D-5 y D-6 del spike de ingesta.
- **Léete también**: `docs/spikes/2026-08-12-spike-de-ingesta.md` (D-5: los nombres de hablante se
  pueden corregir a posteriori; D-6: un asistente puede no ser una persona) y la fixture
  `test/fixtures/ingest/02-problematic-assignees.json`, que trae los casos hostiles.

## Contexto

La ingesta recibe de cada acción un **nombre atribuido** —lo que la herramienta de transcripción
puso como hablante— y tiene que decidir si eso es una persona del sistema. La spec resuelve esa
correspondencia con «una tabla de alias persona↔nombre-en-transcript», administrada a mano.

Lo que llega por ese campo, según la fixture `02-`, es de todo: «Marta Ruiz», «Speaker 2»,
«juan.perez@ejemplo.es», «Lucía», «Equipo de Plataforma», «Todos» y personas de fuera de la
organización. No trae email, no trae identificador y **no es estable**: Fireflies deja renombrar a
un hablante después de la reunión.

La pregunta de diseño es **cuánto normalizar** antes de comparar el nombre atribuido con los alias
de la tabla.

## Opciones

1. **Comparación exacta, byte a byte.** Ningún falso positivo. Pero «Juan Pérez» y «Juan  Pérez»
   —dos espacios— son personas distintas, y una «é» compuesta y una descompuesta se ven idénticas en
   pantalla y no casan. El operador daría de alta alias que aparentemente no funcionan, sin poder ver
   por qué.
2. **Mayúsculas, espacios y forma Unicode.** Se ignora lo que ningún humano percibe como una
   diferencia: NFC, espacios colapsados y minúsculas.
3. **Lo anterior más quitar acentos y puntuación.** Resuelve «Lucia» contra «Lucía» y «Juan P»
   contra «Juan P.». También hace que «Pena» responda por «Peña».
4. **Emparejamiento difuso** (distancia de edición, coincidencia por nombre de pila o por apellido).
   Resolvería «Juan P.» contra «Juan Pérez» sin que nadie escriba nada. Y asignaría a un Juan el
   trabajo del otro.

## Decisión

**La opción 2**: la clave de comparación es el nombre en NFC, con los espacios colapsados a uno,
recortado y en minúsculas (`aliasKey`, en `src/core/aliases.ts`). Nada más.

El criterio que decide es **hacia qué lado equivocarse**, el mismo del ADR 0002:

- **No resolver** cuesta un alias más que el operador escribe —lo tiene delante, porque la pasada
  le dice qué nombres se quedaron sin resolver— y, mientras tanto, la acción entra sin responsable y
  el triage lo asigna, que es el camino que la spec ya contempla y que ya funcionaba.
- **Resolver mal** pone el trabajo de alguien en la lista de otra persona, firmado por el sistema,
  sin que nadie lo note. La acción aparece en el `get_priorities` de quien no es y desaparece del de
  quien sí. No hay señal de eso en ninguna parte.

Los tres pasos que sí se dan son los tres en los que esa asimetría no existe: nadie es otra persona
en minúsculas, un espacio de más es invisible, y dos formas Unicode del mismo carácter **son** el
mismo carácter. Los acentos no entran porque en castellano distinguen apellidos reales —Peña y Pena,
Nuñez y Núñez— y el difuso no entra en absoluto, además de que la spec no compra la librería.

Tres reglas más que salen de la misma idea:

- **Un nombre del transcript responde por una sola persona.** La tabla lo impone con un índice único
  sobre la clave. Si «Juan P.» pudiera ser dos personas, la ingesta tendría que elegir, y elegir es
  exactamente lo que no puede hacer.
- **Una persona responde por tantos nombres como haga falta.** Es la vía de salida de todo lo que no
  se normaliza: si la herramienta la llama de tres maneras, se dan de alta tres alias.
- **Los alias los escribe el operador, nunca se derivan de un transcript.** Se ha considerado y
  descartado cruzar el nombre atribuido con `meeting_attendees` para sacar el email: la propia
  fixture avisa de que ese cruce es heurístico y falla con homónimos, nombres parciales y externos.
  Un alias derivado se movería solo el día que alguien reetiquete un hablante (D-5).

## Consecuencias

- **El alias resuelve en el momento de la ingesta y ahí acaba su papel.** Un alias dado de alta
  después no reabre las acciones ya registradas, y uno borrado no le quita el responsable a nadie.
  Es lo único compatible con D-5 —el nombre atribuido puede cambiar mañana— y con que el triage
  haya podido decidir por su cuenta desde entonces. La corrección tardía se hace en el triage.
- **Corolario incómodo**: si en Fireflies se corrige la etiqueta de un hablante y se regenera el
  resumen sin que cambie el texto del ítem, la segunda pasada lo reconoce como ya visto (ADR 0002) y
  **el responsable recién resoluble no se aplica**. La corrección llega tarde por diseño.
- **La pasada devuelve los nombres que no supo resolver** (`IngestOutcome.unresolvedNames`) y la CLI
  los imprime. Sin eso, la tabla de alias sería inusable: el operador no tendría de dónde sacar los
  nombres salvo abriendo Fireflies.
- **Hay nombres que jamás deben darse de alta como alias**, y el sistema no puede saber cuáles: una
  etiqueta de hablante sin identificar («Speaker 2») es alguien distinto en cada reunión, y un
  colectivo («Todos», «Equipo de Plataforma») no es una persona. Aliarlos asignaría a una persona el
  trabajo de muchas. Queda avisado en la ayuda de la CLI y es criterio del operador; ponerlo como
  regla del núcleo metería el vocabulario de Fireflies dentro del dominio.
- **El alias apunta al identificador de la persona, no a su nombre**, así que renombrar a alguien no
  rompería ningún alias. Y la clave ajena está puesta para el día que se pueda borrar a una persona:
  se negará mientras un alias la nombre, que es el fallo honesto, porque un alias colgando resolvería
  a nadie en silencio. **Ni renombrar ni borrar personas existen hoy** (`src/core/people.ts` solo da
  de alta, lista y resuelve), así que esto es lo que el esquema promete, no algo ya ejercitado.

## Bajo qué evidencia habría que reconsiderar

1. **Un despliegue real muestra que la mayoría de los nombres atribuidos se quedan sin resolver** por
   diferencias que un humano leería como la misma persona (acentos, iniciales). Sería el argumento
   para la opción 3, medido y no supuesto.
2. **Fireflies empieza a dar el email del hablante junto al ítem** —hoy no lo da—, con lo que la
   correspondencia dejaría de ser por nombre y esta decisión sobraría casi entera.
3. **Aparecen homónimos reales en un despliegue.** No cambia la regla, pero sí obliga a mirar qué pasa
   cuando dos personas comparten nombre completo: hoy la tabla obliga a elegir a una y la otra se
   resuelve siempre en el triage.
