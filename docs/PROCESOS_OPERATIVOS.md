# Procesos operativos

Confirmados por Pablo, 19-21/11/2026. Son hechos de negocio reales del
servicio, no hipótesis de diseño ni descripciones del código -- si algo del
código actual no coincide con lo que sigue, es una discrepancia a reportar y
corregir en su momento, no un motivo para reescribir este documento.

## Roles

- La administrativa de Cámara Gamma Central -- quien asigna los N° de ficha
  en Central es una sola persona -- emite fichas desde su PC de escritorio,
  que tiene la impresora Zebra y a la que nadie más accede.
- Los técnicos trabajan en la PC de la sala, con VM RIS abierto.
- El administrador de la app anula actas, desde el celular.
- Otros administrativos de la organización son usuarios de VM RIS, no de la
  app: sólo anulan estudios y reprograman pacientes ahí, nunca en RadioFarm.
- Otras sedes pueden tener horarios de administrativos distintos, y puede
  darse el caso de que una sede no tenga administrativo (caso posible, no
  confirmado que exista hoy). La app debe estar preparada para ese caso: la
  emisión nunca puede ser requisito ni depender de horarios. Hoy sólo Sede
  Central usa la app y el generador de QR; las otras sedes todavía no usan
  ninguno de los dos.
- Las impresoras las usan siempre los administrativos (administrativa o
  admin), nunca los técnicos.

## Asignación de N° de ficha

- La administrativa asigna el N° cuando el paciente está físicamente frente
  a ella, con el trámite completo y el certificado, listo para ingresar.
- Copia los datos de VM RIS -- cuya lista es inestable: los pacientes se
  autorizan y reprograman durante el día -- y carga N° de ficha, nombre,
  DNI, estudio y, si los tiene, peso y talla.
- Genera el QR y la etiqueta (Zebra, etiqueta física de 38x20 mm) y coloca
  la pulsera. Formato del QR: `nombre|dni|peso|talla|estudio|ficha`.
- El generador HTML externo (fuera de este repo) NO guarda datos de
  pacientes.

## Cómo el técnico identifica al paciente

- Escanea la pulsera; si no puede, lee la ficha que imprime VM RIS (después
  del OK de la administrativa) o le pregunta al paciente y corrobora.
- Si faltan peso y talla, los completa el técnico.
- El técnico puede cambiar el estudio al cargar el acta.

## VM RIS y asignación sin administrativa

- VM RIS no asigna el N° solo: tiene un campo "número de ficha" y un número
  sugerido, pero la asignación real es un acto humano.
- Si la administrativa no está, el técnico mira el último N° cargado en VM
  RIS, asigna el siguiente desde la PC de la sala y carga a mano en la app,
  sin emisión ni pulsera.

## Suspensión, anulación y liberación

- Si la administrativa suspende ANTES de asignar ficha: no existe ficha ni
  carga -- no hay nada que anular ni liberar.
- Si YA hay ficha asignada y ocurre un error: el paciente se anula, se
  reprograma, o se evalúa un estudio nuevo, y el N° se libera.
  - **Con acta cargada**: el administrador anula con tipo "Estudio no
    realizado".
  - **Sin acta** (sólo ficha emitida, nunca cargada): la administrativa
    libera la emisión.
- La reasignación del N° liberado a otro paciente es siempre una decisión
  humana, nunca automática.
- Si el paciente suspendido era el ÚLTIMO del día, el N° queda libre para
  asignarse al primer paciente del día siguiente.
- Error de carga (dato mal cargado, mismo paciente): el paciente conserva el
  mismo N°, se corrige y se recarga -- nunca se reasigna a otro.

## Protocolos de 2 o más días

- Usan un ÚNICO N° de ficha, sin ninguna recarga del lado de la app -- los
  técnicos llevan el seguimiento en una pizarra física, fuera del sistema.
- En la app se carga una sola vez por cada N° nuevo.
- **Una emisión pendiente de un día anterior NUNCA es normal** -- no existe
  ningún protocolo legítimo que la explique. Si aparece, es una ficha que
  quedó sin resolver (reprogramación, olvido), no un caso de seguimiento
  multi-día esperable.

## Lotes MIBG / Lutecio-177

- Anular el acta de administración NO anula el lote físico: el lote queda
  disponible para reasignar.
- Cada lote de MIBG se pide al laboratorio ya coordinado para un paciente
  específico -- reasignarlo a otro paciente es la excepción, no la regla.

## Sitio de inyección

- Obligatorio en Tc-99m, MIBG y Lutecio-177. No aplica a I-131 oral.
- Ganglio centinela: se elige OTRO y se escribe la ubicación (mama derecha,
  mama izquierda, lunar en otra zona) como texto del sitio.
- Antes del 18/11, las técnicas escribían el sitio a mano en el campo
  Observación, con abreviaturas propias (Dmd, Dmi, Dmf). "Dmf" no calza con
  ningún código de la lista actual y queda pendiente de confirmar con ellas
  qué sitio anatómico es.

## Supervisión

- Pablo revisa a diario que no falten pacientes cargados.
