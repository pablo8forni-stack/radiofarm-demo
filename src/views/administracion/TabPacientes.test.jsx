// Regresión del bug real encontrado con evidencia de staging (PC: el "0" de
// Peso terminó en Nombre; celular: terminó en DNI): 4 bloques condicionales
// SIN key, antes de los inputs de Nombre/DNI/Peso/Talla, hacían que React
// reconciliara por POSICIÓN. Cuando fichaEstado pasaba de "verificando" a
// {tipo:"ok"} (async, tras el blur de Ficha) y el bloque "Verificando..."
// desaparecía del árbol, la posición de Nombre/DNI/Peso/Talla en el array de
// hijos se corría -- sin key propia, la key IMPLÍCITA de cada uno (su índice
// en el array) cambiaba, y React podía reutilizar el nodo DOM de un campo
// para representar OTRO. El nodo seguía enfocado en el navegador (React no
// mueve el foco al actualizar props), así que una tecla que llegaba justo
// en ese instante quedaba atribuida al campo equivocado.
//
// En vez de intentar cronometrar un keystroke real contra la promesa (fresco
// en Node/jsdom, poco confiable -- ver intento anterior descartado), este
// test verifica la causa raíz directamente: la IDENTIDAD del nodo DOM de
// cada campo antes y después de que fichaEstado cambie. Si algún campo
// termina con un nodo DOM distinto al que tenía (o el nodo que sigue
// enfocado ya no es el de Peso), React lo reconcilió por posición en vez de
// por identidad -- exactamente la causa del bug real. Esto es 100%
// determinístico: no depende de timing de red ni de la velocidad de tipeo.
import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabPacientes } from "./TabPacientes.jsx";

afterEach(cleanup);

function crearDiferida() {
  let resolver;
  const promesa = new Promise((r) => { resolver = r; });
  return { promesa, resolver };
}

// listenX(callback, ...) -- llama el callback con `datos` (por defecto
// vacío) de una y devuelve un unsubscribe no-op, mismo shape que los
// listeners reales de Firestore.
function listenerCon(cb, datos = []) {
  cb(datos);
  return () => {};
}

let resolverFichaIntentoDeferido;
// Datos del listado de Libro 2 para los tests de renderizado -- se
// reasigna en cada test antes de montar el componente (ver
// listenActas más abajo, que sólo la usa para tipo "paciente").
let actasParaListado = [];
// Por tipo de I-131 (ablativaI131/dosisI131/etc., ver TabPacientes.jsx) --
// {} por defecto (listenActas devuelve [] para cualquier tipo no listado
// acá), cada test que necesite datos de un tipo puntual (ver
// avisoI131Previo) la reasigna antes de montar.
let actasI131PorTipo = {};
let anulacionesParaTest = [];
// Marcaciones de Libro 1 "de hoy" para el selector de Lote de Tc-99m (Libro
// 2) -- [] por defecto (ningún lote marcado), cada test de "Ver todos los
// lotes en stock"/"No requiere marcación" la reasigna antes de montar.
let marcacionesHoyParaTest = [];
// A diferencia de los otros listeners de este mock (una sola llamada,
// "foto" fija), este guarda el callback para poder simular un cambio EN
// VIVO (como el listener real de Firestore) -- necesario para probar que
// la restauración al destildar la excepción se omite si el lote dejó de
// figurar como marcado MIENTRAS la excepción estaba activa.
let marcacionesHoyCallbacks = [];
function dispararMarcacionesHoy(datos) {
  marcacionesHoyParaTest = datos;
  marcacionesHoyCallbacks.forEach((cb) => cb(datos));
}
// Mismo motivo que marcacionesHoyCallbacks de arriba, generalizado por tipo
// -- necesario para probar que la restauración de "cápsula sellada" se
// omite si la extracción se vincula a OTRA dosis mientras la excepción
// está activa (extraccionesYaVinculadasIds depende de ablativaI131/
// dosisI131/dosisBarridoI131, todos alimentados por listenActas).
let actasI131Callbacks = {};
function dispararActasI131(tipo, datos) {
  actasI131PorTipo[tipo] = datos;
  (actasI131Callbacks[tipo] || []).forEach((cb) => cb(datos));
}

vi.mock("../../services/firestore/actas.js", () => ({
  listenActas: (tipo, cb) => {
    if (tipo === "paciente") return listenerCon(cb, actasParaListado);
    (actasI131Callbacks[tipo] ||= []).push(cb);
    cb(actasI131PorTipo[tipo] || []);
    return () => { actasI131Callbacks[tipo] = (actasI131Callbacks[tipo] || []).filter((c) => c !== cb); };
  },
  // Ajuste D (9/11, decaído I-131): mismo mock que listenActas de arriba --
  // ignora `desde` a propósito (los tests de este archivo prueban la
  // MECÁNICA de vinculación/decaimiento con fixtures chicas, no la ventana
  // de tiempo en sí -- eso está cubierto en scripts/testing/*.mjs contra el
  // emulador real y en decaimientoI131.test.js). Comparte actasI131PorTipo/
  // actasI131Callbacks con listenActas -- un mismo tipo (ej. i131_ablativa)
  // puede estar escuchado por las dos funciones a la vez, ambas ven el
  // mismo fixture.
  listenActasDesdeFecha: (tipo, cb) => {
    (actasI131Callbacks[tipo] ||= []).push(cb);
    cb(actasI131PorTipo[tipo] || []);
    return () => { actasI131Callbacks[tipo] = (actasI131Callbacks[tipo] || []).filter((c) => c !== cb); };
  },
  listenAnulacionesActas: (cb) => listenerCon(cb, anulacionesParaTest),
  listenActasMarcacionHoy: (_sedeId, cb) => {
    marcacionesHoyCallbacks.push(cb);
    cb(marcacionesHoyParaTest);
    return () => { marcacionesHoyCallbacks = marcacionesHoyCallbacks.filter((c) => c !== cb); };
  },
  obtenerUltimaFicha: vi.fn(async () => null),
  // El eje de la prueba: NO resuelve hasta que el test llame a .resolver()
  // -- deja fichaEstado en "verificando" el tiempo que el test necesite.
  resolverFichaIntento: vi.fn(() => {
    const d = crearDiferida();
    resolverFichaIntentoDeferido = d;
    return d.promesa;
  }),
  fechaFichaSiguiente: vi.fn(async () => null),
  actasMarcacionPorFecha: vi.fn(async () => []),
  addActaPaciente: vi.fn(async () => {}),
  actasPorRango: vi.fn(async () => []),
  anularActaTransaction: vi.fn(async () => {}),
  addActaI131Ablativa: vi.fn(async () => {}),
  addActaI131Dosis: vi.fn(async () => {}),
  addActaI131Barrido: vi.fn(async () => {}),
  addActaI131DosisBarrido: vi.fn(async () => {}),
  addActaI131Captacion: vi.fn(async () => {}),
  addActaI131Centellograma: vi.fn(async () => {}),
  addActaI131CaptacionCentellograma: vi.fn(async () => {}),
}));

// estadoPorLoteDosisUnica/disponiblesDesdeEstadoPorLote: versión mínima y
// PERMISIVA para este archivo (ignora sin-vencimiento/vencido/no-verificable
// a propósito -- eso ya está cubierto a fondo en scripts/testing/
// transacciones.test.mjs contra el emulador real, y en
// src/hooks/useLotesDisponibles.test.js) -- acá sólo hace falta que un lote
// no anulado quede "disponible" sin reventar ni pegarle a Firestore de
// verdad (la real hace getDoc contra `db`, que no existe en este entorno de
// test). Los tests que necesitan un estado puntual (no-verificable,
// cargando que nunca resuelve, etc.) lo overridean con vi.spyOn, mismo
// patrón que ya usa este archivo para listenMibgLotes/administrarXTransaction.
vi.mock("../../services/firestore/mibgLotes.js", () => ({
  listenMibgLotes: (cb) => listenerCon(cb),
  administrarMibgTransaction: vi.fn(async () => {}),
  administrarLutecioTransaction: vi.fn(async () => {}),
  estadoPorLoteDosisUnica: async (lotes, { anulaciones }) =>
    new Map(lotes.map((l) => [l.id, anulaciones.has(l.id) ? { estado: "anulado", uso: null, error: null } : { estado: "disponible", uso: null, error: null }])),
  disponiblesDesdeEstadoPorLote: (lotes, estadoPorLoteId) =>
    lotes.filter((l) => estadoPorLoteId.get(l.id)?.estado === "disponible"),
}));

const catalogo = {
  farms: [{ id: "mibi", nombre: "MIBI (Sestamibi)", viales_x_kit: null }],
  sedes: { central: { nombre: "FUESMEN Central", short: "Central", activo: true, principal: true, eliminada: false, farmIds: ["mibi"], puntosReorden: {} } },
  stock: { central: { mibi: [] } },
  proveedores: [],
  estudios: [{ id: "ecografia", nombre: "Ecografía" }],
  // lu177/i131 -- sin esto, isotoposCasoDistinto queda vacío y el link
  // "¿Es un caso distinto a Tc-99m?" no aparece (mismo bug real diagnosticado
  // en staging por un catálogo de radioisotopos vacío, no una regresión de
  // código -- ver TIPOS_I131/isotoposCasoDistinto en TabPacientes.jsx).
  radioisotopos: [{ id: "tc99m", nombre: "Tc-99m" }, { id: "lu177", nombre: "Lutecio-177" }, { id: "i131", nombre: "I-131" }],
};
const usuario = { nombre: "Técnica Test", email: "tecnica@test.local", sede: "central", accesoTerapiaI131: false };
// Dosis de barrido corporal (como los otros 3 diagnósticos "reales") exige
// accesoTerapiaI131 -- con el usuario de arriba (sin acceso) la opción
// queda disabled en el <Sel>, sin poder seleccionarla.
const usuarioConAccesoI131 = { ...usuario, accesoTerapiaI131: true };

function labelInput(label) {
  return screen.getByText(label, { selector: "label" }).nextElementSibling;
}

async function llegarAFormularioConFichaVerificando(user) {
  render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
  await user.click(await screen.findByText("+ Manual"));
  const fichaInput = labelInput("N° de Ficha");
  await user.type(fichaInput, "999999");
  fichaInput.blur();
  // fichaEstado ya es "verificando" acá (síncrono) -- resolverFichaIntento
  // sigue en vuelo (la promesa deferida todavía no se resolvió).
  await screen.findByText("Verificando N° de Ficha...");
}

describe("TabPacientes -- reconciliación de campos Ficha/Nombre/DNI/Peso/Talla", () => {
  test("cada campo conserva su PROPIO nodo DOM cuando fichaEstado pasa de 'verificando' a {tipo:'ok'} (no se reconcilia por posición)", async () => {
    const user = userEvent.setup();
    await llegarAFormularioConFichaVerificando(user);

    const nombreAntes = labelInput("Apellido y nombre");
    const dniAntes = labelInput("DNI");
    const pesoAntes = labelInput("Peso (kg)");
    const tallaAntes = labelInput("Talla (cm)");

    // Resuelve la consulta -- dispara el re-render que en el bug original
    // hacía desaparecer el bloque "Verificando..." y corría la posición de
    // Nombre/DNI/Peso/Talla en el array de hijos.
    await act(async () => {
      resolverFichaIntentoDeferido.resolver({ intento: "1" });
      await resolverFichaIntentoDeferido.promesa;
    });
    expect(screen.queryByText("Verificando N° de Ficha...")).toBeNull();

    // Mismo nodo DOM físico para cada campo, antes y después -- si React
    // reconcilió por posición en vez de por key, alguno de estos hubiera
    // terminado apuntando al nodo que ANTES pertenecía a un campo vecino.
    expect(labelInput("Apellido y nombre")).toBe(nombreAntes);
    expect(labelInput("DNI")).toBe(dniAntes);
    expect(labelInput("Peso (kg)")).toBe(pesoAntes);
    expect(labelInput("Talla (cm)")).toBe(tallaAntes);
  });

  test("una tecla que llega justo cuando fichaEstado resuelve queda atribuida al campo que el usuario realmente estaba tocando (Peso), no a otro", async () => {
    const user = userEvent.setup();
    await llegarAFormularioConFichaVerificando(user);

    await user.type(labelInput("Apellido y nombre"), "Garcia Pedro");
    await user.type(labelInput("DNI"), "28668919");

    // La técnica hace foco en Peso y empieza a tipear -- el navegador NO
    // mueve el foco sólo porque React actualice props en un re-render
    // posterior, así que este es el nodo que debería recibir la tecla que
    // "llega tarde", sin importar qué haga React internamente.
    const pesoInput = labelInput("Peso (kg)");
    pesoInput.focus();
    fireEvent.input(pesoInput, { target: { value: "4" } });
    expect(document.activeElement).toBe(pesoInput);

    // Resuelve la consulta -- el bloque "Verificando..." desaparece.
    await act(async () => {
      resolverFichaIntentoDeferido.resolver({ intento: "1" });
      await resolverFichaIntentoDeferido.promesa;
    });

    // La tecla "2" (completando "42") llega DESPUÉS de la reconciliación,
    // dirigida al nodo que sigue teniendo foco real -- exactamente lo que
    // pasa con un keystroke humano que coincide con la respuesta async.
    fireEvent.input(document.activeElement, { target: { value: document.activeElement.value + "2" } });

    expect(labelInput("Peso (kg)").value).toBe("42");
    expect(labelInput("Apellido y nombre").value).toBe("Garcia Pedro");
    expect(labelInput("DNI").value).toBe("28668919");
    expect(labelInput("Talla (cm)").value).toBe("");
  });
});

// Hallazgo real de Pablo (sede de trabajo del admin, 2026-11): anular un
// acta de OTRA sede (sólo visible auditándola, sedeAuditando) y precargar
// sus datos en un registro nuevo de la sede de TRABAJO mezclaría N° de
// Ficha entre sedes -- es correlativo por sede, no global. confirmarAnulacion
// ahora corta antes de precargar si acta.sedeId !== sedeId (usuario.sede).
describe("TabPacientes -- sede de trabajo del admin: anular un acta de OTRA sede no precarga el formulario", () => {
  const catalogoDosSedes = {
    ...catalogo,
    sedes: {
      ...catalogo.sedes,
      italiano: { nombre: "C. Gamma Hospital Italiano", short: "Italiano", activo: true, principal: false, eliminada: false, farmIds: ["mibi"], puntosReorden: {} },
    },
  };
  // sede (trabajo) == central, sedeAuditando == italiano -- exactamente el
  // caso real: el admin sólo puede haber visto esta acta auditando italiano.
  const usuarioAdmin = { nombre: "Admin Test", email: "admin@test.local", sede: "central", sedeAuditando: "italiano" };
  // Control positivo: audita SU PROPIA sede -- el listado (filtrado por
  // sedeEfectiva, ver TabPacientes.jsx) sólo muestra acta de central acá.
  const usuarioAdminPropiaSede = { ...usuarioAdmin, sedeAuditando: "central" };

  afterEach(() => { actasParaListado = []; });

  test("acta de otra sede: Anular NO abre el formulario precargado, avisa con toast", async () => {
    actasParaListado = [{
      id: "acta-italiano", tipo: "paciente", sedeId: "italiano", sedeNombre: "C. Gamma Hospital Italiano",
      pacienteFicha: "555", pacienteNombre: "Paciente Italiano", pacienteDni: "9988",
      fecha: new Date().toISOString(), isotopoId: "tc99m", farmId: "mibi", lote: "LOTE-IT", mciAdministrados: 10,
    }];
    const onToast = vi.fn();
    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogoDosSedes} usuario={usuarioAdmin} esAdmin onToast={onToast} nav={null} />);

    const botonesAnular = await screen.findAllByRole("button", { name: "Anular" });
    await user.click(botonesAnular[0]);
    await user.type(labelInput("Motivo de la anulación (obligatorio)"), "Test");
    await user.click(screen.getByRole("button", { name: "Confirmar anulación" }));

    // No se abre "Nuevo registro de paciente" con los datos precargados --
    // el formulario queda cerrado (confirmarAnulacion corta con `return`
    // antes de setMostrarForm(true)).
    expect(screen.queryByText("Nuevo registro de paciente")).toBeNull();
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("C. Gamma Hospital Italiano"), "info", 10000);
  });

  test("control positivo: acta de la PROPIA sede sí precarga el formulario", async () => {
    actasParaListado = [{
      id: "acta-central", tipo: "paciente", sedeId: "central", sedeNombre: "FUESMEN Central",
      pacienteFicha: "777", pacienteNombre: "Paciente Central", pacienteDni: "1122",
      fecha: new Date().toISOString(), isotopoId: "tc99m", farmId: "mibi", lote: "LOTE-C", mciAdministrados: 5,
    }];
    const onToast = vi.fn();
    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogoDosSedes} usuario={usuarioAdminPropiaSede} esAdmin onToast={onToast} nav={null} />);

    const botonesAnular = await screen.findAllByRole("button", { name: "Anular" });
    await user.click(botonesAnular[0]);
    await user.type(labelInput("Motivo de la anulación (obligatorio)"), "Test");
    await user.click(screen.getByRole("button", { name: "Confirmar anulación" }));

    await screen.findByText("Nuevo registro de paciente");
    expect(labelInput("N° de Ficha").value).toBe("777");
    expect(labelInput("Apellido y nombre").value).toBe("Paciente Central");
  });
});

// Regresión del bug real (confirmado con datos reales de Firestore --
// el documento guardado queda limpio, es puramente de renderizado): en
// filaPaciente (tabla de escritorio) y tarjetaPaciente (tarjeta mobile),
// `(a.peso || a.talla) && ...` y los `{a.peso && ...}`/`{a.talla && ...}`
// internos usaban la truthiness cruda del número. peso=0/talla=0 son datos
// REALES (el paciente fue pesado y midió 0, o no se cargó -- de cualquier
// forma es el valor guardado), pero en JS `0 && x` da `0` (no `false`), y
// React SÍ renderiza un `0` suelto como texto -- quedaba pegado sin espacio
// al nombre (tabla) o al DNI (tarjeta), justo donde no hay otro separador
// en el JSX. El fix compara explícitamente `!= null` en vez de la
// truthiness del número.
describe("TabPacientes -- listado de Libro 2, peso/talla=0 no debe dejar un '0' suelto pegado a Nombre/DNI", () => {
  // Reloj fijo en vez de la hora real: con la hora real, cuando el test corre
  // entre 00:00 y 09:59, tarjetaPaciente (mobile) pega el nombre directo a la
  // hora ("Perez Carlos00:05...") sin separador -- "Carlos0" seguido de un
  // dígito y ":" (hora tipo HH:MM) es ese caso, no el bug de peso/talla=0, y
  // los regex de abajo ya lo excluyen. 00:05 es justamente la hora que antes
  // rompía el test; queda fijada para que actúe como guarda de regresión.
  beforeEach(() => {
    // Sólo Date, no los timers reales (setTimeout/setInterval) -- si no,
    // findAllByText/waitFor (que usan setTimeout por dentro) se cuelgan.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 0, 5, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function actaDePrueba(overrides) {
    return {
      id: "acta-test", tipo: "paciente", sedeId: "central", pacienteFicha: "1",
      pacienteNombre: "Perez Carlos", pacienteDni: "28668919",
      fecha: new Date(), estudio: "Ecografía", farmNombre: "MIBI", usuarioNombre: "Técnica Test",
      ...overrides,
    };
  }

  async function renderConActa(acta) {
    actasParaListado = [acta];
    const utils = render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    // Desktop (tabla) y mobile (tarjeta) se renderizan los dos en simultáneo
    // en jsdom (el hidden/md:hidden es CSS, jsdom no aplica layout) --
    // "Perez Carlos" aparece dos veces, por eso findAllByText en vez de
    // findByText (que tira si hay más de un match).
    await screen.findAllByText("Perez Carlos");
    return utils;
  }

  // "Carlos0" seguido de "kg" es el dato real (0kg), correctamente envuelto
  // en su propio <div> -- en un navegador real queda en su renglón aparte
  // (el <div> es block-level), container.textContent sólo no lo separa con
  // un salto de línea porque no interpreta layout. "Carlos0" NO seguido de
  // "kg" es el bug real: un 0 suelto, sin unidad, colgado directo del
  // nombre porque el <div> contenedor ni siquiera llegó a existir.
  test("peso=0 y talla=0 juntos: no queda ningún '0' pegado al nombre, y '0kg · 0cm' se muestra como dato real", async () => {
    const { container } = await renderConActa(actaDePrueba({ peso: 0, talla: 0 }));
    expect(container.textContent).not.toMatch(/Carlos0(?!kg)(?!\d:)/);
    expect(container.textContent).toContain("0kg · 0cm");
  });

  test("peso=0 con talla real (176): no queda un '0' suelto antes de ' · 176cm'", async () => {
    const { container } = await renderConActa(actaDePrueba({ peso: 0, talla: 176 }));
    expect(container.textContent).not.toMatch(/Carlos0(?!kg)(?!\d:)/);
    expect(container.textContent).not.toMatch(/[^0-9]0 · 176cm/); // "0" suelto (sin "kg") antes del separador
    expect(container.textContent).toContain("0kg · 176cm");
  });

  test("peso real (78) con talla=0: no queda un '0' suelto pegado después de '78kg'", async () => {
    const { container } = await renderConActa(actaDePrueba({ peso: 78, talla: 0 }));
    expect(container.textContent).not.toMatch(/Carlos0(?!\d:)/);
    expect(container.textContent).not.toMatch(/78kg0/);
    expect(container.textContent).toContain("78kg · 0cm");
  });
});

// Dosis de barrido corporal: 7° tipo diagnóstico -- mismos campos que
// Captación/Centellograma/Captación y Centellograma (µCi), pero SIN el
// picker "Dosis relacionada" (nunca hay una dosis previa que vincular, ver
// sinVinculoDosis en TIPOS_I131). Regresión: confirma que partir el bloque
// categoria==="diagnostico" en dos no le rompió el picker a los otros 3.
describe("TabPacientes -- Gestión I-131, Dosis de barrido corporal no muestra 'Dosis relacionada'", () => {
  async function abrirYElegirIsotopoI131(user) {
    render(<TabPacientes catalogo={catalogo} usuario={usuarioConAccesoI131} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
    await user.selectOptions(labelInput("Isótopo"), "i131");
  }

  test("Dosis de barrido corporal: sin 'Dosis relacionada', con Actividad administrada en mCi (no µCi -- bug real corregido)", async () => {
    const user = userEvent.setup();
    await abrirYElegirIsotopoI131(user);
    await user.selectOptions(labelInput("Tipo de registro"), "dosis_barrido");

    expect(screen.getByText("Actividad administrada (mCi)")).toBeTruthy();
    expect(screen.queryByText("Actividad administrada (µCi)")).toBeNull();
    expect(screen.queryByText("Dosis relacionada (opcional)")).toBeNull();
  });

  test("control positivo -- Captación SÍ sigue mostrando 'Dosis relacionada' (no se rompió con el split)", async () => {
    const user = userEvent.setup();
    await abrirYElegirIsotopoI131(user);
    await user.selectOptions(labelInput("Tipo de registro"), "captacion");

    expect(screen.getByText("Actividad administrada (µCi)")).toBeTruthy();
    expect(screen.getByText("Dosis relacionada (opcional)")).toBeTruthy();
  });
});

// Vínculo lote-paciente (extraccionId/sinExtraccionVial): XOR obligatorio
// para Dosis ablativa/Dosis terapéutica/Dosis de barrido corporal -- nunca
// los dos juntos, nunca ninguno (ver firestore.rules#vinculoExtraccionI131Valido).
// Captación/Centellograma/Captación y Centellograma quedan FUERA de este
// vínculo (ya tienen el suyo propio, dosisActaId).
describe("TabPacientes -- Gestión I-131, vínculo a Extracción (Dosis ablativa/terapéutica/barrido corporal)", () => {
  async function abrirYElegirIsotopoI131(user) {
    render(<TabPacientes catalogo={catalogo} usuario={usuarioConAccesoI131} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
    await user.selectOptions(labelInput("Isótopo"), "i131");
  }

  test("Dosis de barrido corporal muestra 'Extracción relacionada' + 'cápsula sellada'", async () => {
    const user = userEvent.setup();
    await abrirYElegirIsotopoI131(user);
    await user.selectOptions(labelInput("Tipo de registro"), "dosis_barrido");

    expect(screen.getByText("Extracción relacionada")).toBeTruthy();
    expect(screen.getByText("Es una cápsula sellada (sin extracción de vial)")).toBeTruthy();
  });

  test("control positivo -- Captación NO muestra el vínculo a Extracción (ya tiene el suyo propio, dosisActaId)", async () => {
    const user = userEvent.setup();
    await abrirYElegirIsotopoI131(user);
    await user.selectOptions(labelInput("Tipo de registro"), "captacion");

    expect(screen.queryByText("Extracción relacionada")).toBeNull();
    expect(screen.queryByText("Es una cápsula sellada (sin extracción de vial)")).toBeNull();
  });

  test("tildar 'cápsula sellada' limpia y deshabilita el Sel de Extracción relacionada", async () => {
    const user = userEvent.setup();
    await abrirYElegirIsotopoI131(user);
    await user.selectOptions(labelInput("Tipo de registro"), "dosis_barrido");

    const checkbox = screen.getByText("Es una cápsula sellada (sin extracción de vial)").previousElementSibling;
    await user.click(checkbox);

    expect(labelInput("Extracción relacionada").value).toBe("");
    expect(labelInput("Extracción relacionada").disabled).toBe(true);
  });
});

// Ajuste D (9/11, plan "decaído" de I-131): "Extracción relacionada" ya NO
// sólo excluye vinculadas -- también excluye decaídas, por la actividad
// PROPIA de la extracción (nunca por el estado del vial de origen, que acá
// ni se calcula). La mecánica de "ya vinculada" acotada por tiempo (en vez
// de los 3 listeners limitados a 150) está probada contra el emulador real
// en scripts/testing/transacciones.test.mjs -- acá sólo la DECISIÓN de
// qué se oculta y por qué.
describe("TabPacientes -- 'Extracción relacionada' también oculta las decaídas (ajuste D)", () => {
  async function abrirPickerExtraccion(user) {
    render(<TabPacientes catalogo={catalogo} usuario={usuarioConAccesoI131} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
    await user.selectOptions(labelInput("Isótopo"), "i131");
    await user.selectOptions(labelInput("Tipo de registro"), "dosis_barrido");
  }

  beforeEach(() => { actasI131PorTipo.i131_vial = []; });
  afterEach(() => { actasI131PorTipo = {}; actasI131Callbacks = {}; anulacionesParaTest = []; });

  test("decaída (actividad medida chica, hace muchos días) -- no aparece, aunque nunca fue vinculada", async () => {
    actasI131PorTipo.i131_extraccion = [{
      id: "ex-decaida", tipo: "i131_extraccion", fecha: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      actividadMedida: 2, actividadCalculada: 2, viales: [],
    }];
    const user = userEvent.setup();
    await abrirPickerExtraccion(user);

    expect(screen.queryByRole("option", { name: /mCi medido/ })).toBeNull();
  });

  test("reciente, con actividad alta -- SÍ aparece", async () => {
    actasI131PorTipo.i131_extraccion = [{
      id: "ex-vigente", tipo: "i131_extraccion", fecha: new Date(),
      actividadMedida: 50, actividadCalculada: 50, viales: [],
    }];
    const user = userEvent.setup();
    await abrirPickerExtraccion(user);

    expect(screen.getByRole("option", { name: /mCi medido/ })).toBeTruthy();
  });

  // Fail-open explícito (pedido de Pablo): sin actividadMedida NI
  // actividadCalculada (dato viejo/malformado), nunca se oculta por error.
  test("sin actividadMedida ni actividadCalculada -- NO se oculta (falla abierto)", async () => {
    actasI131PorTipo.i131_extraccion = [{
      id: "ex-sin-dato", tipo: "i131_extraccion", fecha: new Date(Date.now() - 300 * 24 * 60 * 60 * 1000), viales: [],
    }];
    const user = userEvent.setup();
    await abrirPickerExtraccion(user);

    expect(screen.getByRole("option", { name: /0\.00 mCi medido/ })).toBeTruthy();
  });

  // No es un vial decaído lo que oculta la extracción -- es la actividad
  // PROPIA de la extracción. Esta pantalla ni siquiera calcula el
  // decaimiento del vial de origen -- este test deja constancia de que el
  // criterio correcto (actividad propia) es el único que puede aplicar.
  test("extracción reciente con actividad alta -- se muestra sin importar cuán viejo sea el vial de origen", async () => {
    actasI131PorTipo.i131_vial = [{ id: "vial-viejo", sedeId: "central", lote: "I131-VIAL-VIEJO", fechaCalibracion: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) }];
    actasI131PorTipo.i131_extraccion = [{
      id: "ex-de-vial-viejo", tipo: "i131_extraccion", fecha: new Date(),
      actividadMedida: 80, actividadCalculada: 80, viales: [{ vialId: "vial-viejo", mlExtraidos: 1 }],
    }];
    const user = userEvent.setup();
    await abrirPickerExtraccion(user);

    expect(screen.getByText(/I131-VIAL-VIEJO/)).toBeTruthy();
  });
});

// Mismo patrón de CasilleroExcepcion (sólo el input interactivo, texto sin
// interacción, no se pierde la extracción ya vinculada) aplicado acá.
describe("TabPacientes -- 'Es una cápsula sellada' (CasilleroExcepcion): sólo el cuadradito activa la excepción", () => {
  beforeEach(() => {
    actasI131PorTipo.i131_extraccion = [{ id: "ex1", tipo: "i131_extraccion", fecha: new Date(), actividadMedida: 10, viales: [] }];
    actasI131PorTipo.i131_vial = [];
  });
  afterEach(() => {
    actasI131PorTipo = {};
    actasI131Callbacks = {};
    anulacionesParaTest = [];
  });

  async function abrirYVincularExtraccion(user) {
    render(<TabPacientes catalogo={catalogo} usuario={usuarioConAccesoI131} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
    await user.selectOptions(labelInput("Isótopo"), "i131");
    await user.selectOptions(labelInput("Tipo de registro"), "dosis_barrido");
    await user.selectOptions(labelInput("Extracción relacionada"), "ex1");
  }

  test("tocar el texto 'Es una cápsula sellada' NO activa la excepción", async () => {
    const user = userEvent.setup();
    await abrirYVincularExtraccion(user);

    await user.click(screen.getByText("Es una cápsula sellada (sin extracción de vial)"));

    expect(labelInput("Extracción relacionada").value).toBe("ex1");
    expect(screen.queryByText("Se guardará como cápsula sellada, sin extracción de vial.")).toBeNull();
  });

  test("tocar el cuadradito SÍ activa la excepción, y muestra el aviso", async () => {
    const user = userEvent.setup();
    await abrirYVincularExtraccion(user);

    const checkbox = screen.getByLabelText("Es una cápsula sellada (sin extracción de vial)");
    await user.click(checkbox);

    expect(labelInput("Extracción relacionada").value).toBe("");
    expect(labelInput("Extracción relacionada").disabled).toBe(true);
    expect(screen.getByText("Se guardará como cápsula sellada, sin extracción de vial.")).toBeTruthy();
  });

  test("Espacio con foco en el cuadradito también activa la excepción", async () => {
    const user = userEvent.setup();
    await abrirYVincularExtraccion(user);

    const checkbox = screen.getByLabelText("Es una cápsula sellada (sin extracción de vial)");
    checkbox.focus();
    await user.keyboard(" ");

    expect(screen.getByText("Se guardará como cápsula sellada, sin extracción de vial.")).toBeTruthy();
  });

  test("restauración válida: tildar y destildar sin cambiar nada más devuelve la extracción vinculada", async () => {
    const user = userEvent.setup();
    await abrirYVincularExtraccion(user);

    const checkbox = screen.getByLabelText("Es una cápsula sellada (sin extracción de vial)");
    await user.click(checkbox);
    await user.click(checkbox);

    expect(labelInput("Extracción relacionada").value).toBe("ex1");
  });

  test("restauración omitida: si la extracción se vincula a otra dosis mientras la excepción estaba activa, el campo queda vacío", async () => {
    const user = userEvent.setup();
    await abrirYVincularExtraccion(user);

    const checkbox = screen.getByLabelText("Es una cápsula sellada (sin extracción de vial)");
    await user.click(checkbox);
    // Mientras la excepción está activa, otra carga vincula esa misma
    // extracción a otra dosis -- extraccionesYaVinculadasIds (derivado de
    // ablativaI131/dosisI131/dosisBarridoI131) pasa a excluirla de
    // extraccionesDisponibles.
    await act(async () => {
      dispararActasI131("i131_dosis_barrido", [{ id: "otra", tipo: "i131_dosis_barrido", extraccionId: "ex1", fecha: new Date() }]);
    });
    await user.click(checkbox);

    expect(labelInput("Extracción relacionada").value).toBe("");
  });
});

function haceDias(n) {
  return { toDate: () => new Date(Date.now() - n * 24 * 60 * 60 * 1000) };
}

// Aviso informativo por DNI (avisoI131Previo): NUNCA auto-completa nada --
// sólo un cartel. Costo real cero (filtra actasI131PorTipo, ya "en
// memoria" vía el mock de listenActas, ninguna consulta nueva).
describe("TabPacientes -- aviso informativo de I-131 previo por DNI", () => {
  beforeEach(() => { actasI131PorTipo = {}; anulacionesParaTest = []; });

  async function abrirFormYEscribirDni(user, dniValor) {
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    await user.type(labelInput("DNI"), dniValor);
  }

  test("muestra el aviso -- registro de I-131 no anulado del mismo DNI, dentro de los últimos 10 días", async () => {
    actasI131PorTipo.i131_captacion = [{ id: "a1", tipo: "i131_captacion", pacienteDni: "12345678", fecha: haceDias(3) }];
    const user = userEvent.setup();
    await abrirFormYEscribirDni(user, "12345678");
    expect(await screen.findByText(/Este DNI tiene un registro de I-131/)).toBeTruthy();
    expect(screen.getByText(/Captación/)).toBeTruthy();
  });

  test("NO muestra el aviso si el único registro de ese DNI está anulado", async () => {
    actasI131PorTipo.i131_captacion = [{ id: "a1", tipo: "i131_captacion", pacienteDni: "12345678", fecha: haceDias(3) }];
    anulacionesParaTest = [{ id: "anula_a1", anulaId: "a1", motivo: "Test" }];
    const user = userEvent.setup();
    await abrirFormYEscribirDni(user, "12345678");
    expect(screen.queryByText(/Este DNI tiene un registro de I-131/)).toBeNull();
  });

  test("NO muestra el aviso si el registro tiene más de 10 días", async () => {
    actasI131PorTipo.i131_captacion = [{ id: "a1", tipo: "i131_captacion", pacienteDni: "12345678", fecha: haceDias(15) }];
    const user = userEvent.setup();
    await abrirFormYEscribirDni(user, "12345678");
    expect(screen.queryByText(/Este DNI tiene un registro de I-131/)).toBeNull();
  });

  test("NO muestra el aviso para un DNI distinto", async () => {
    actasI131PorTipo.i131_captacion = [{ id: "a1", tipo: "i131_captacion", pacienteDni: "99999999", fecha: haceDias(3) }];
    const user = userEvent.setup();
    await abrirFormYEscribirDni(user, "12345678");
    expect(screen.queryByText(/Este DNI tiene un registro de I-131/)).toBeNull();
  });
});

// Peso/Talla: se sacaron de los 8 tipos de I-131 (las técnicas de esa
// sección no toman esos datos) -- siguen para Tc-99m plano (caso por
// defecto del form) y Lutecio-177.
describe("TabPacientes -- Peso/Talla ausentes para I-131, presentes para Tc-99m", () => {
  test("Tc-99m (caso por defecto, sin tocar el toggle): Peso y Talla siguen visibles", async () => {
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await userEvent.setup().click(await screen.findByText("+ Manual"));
    expect(screen.getByText("Peso (kg)")).toBeTruthy();
    expect(screen.getByText("Talla (cm)")).toBeTruthy();
  });

  test("I-131 (cualquier tipo, ej. Captación): Peso y Talla NO se muestran", async () => {
    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuarioConAccesoI131} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
    await user.selectOptions(labelInput("Isótopo"), "i131");
    await user.selectOptions(labelInput("Tipo de registro"), "captacion");

    expect(screen.queryByText("Peso (kg)")).toBeNull();
    expect(screen.queryByText("Talla (cm)")).toBeNull();
  });
});

// Bug real reportado por Pablo: el texto al lado del casillero estaba
// DENTRO del <label> que envuelve el <input> -- tocar el texto, o un poco
// por debajo del selector de Lote (pegado por un gap de 4px), tildaba la
// excepción sin querer. CasilleroExcepcion.jsx separa el texto a un <span>
// sin interacción; estos tests cubren los 3 casos reales -- texto, input,
// teclado -- más que el estado elegido (farmId/lote) no se pierda.
//
// El selector de Lote es ListaSeleccionable (un combobox armado a mano, no
// un <select>) -- labelInput("Lote") no sirve acá (apunta al <div> que
// envuelve el botón, no a un elemento con .value). Se lee/elige por rol.
function botonLote() {
  return screen.getByRole("combobox", { name: "Lote" });
}
async function elegirLotePorTexto(user, textoInicial) {
  await user.click(botonLote());
  await user.click(await screen.findByRole("option", { name: new RegExp("^" + textoInicial) }));
}

describe("TabPacientes -- 'No requiere marcación de radiofármaco' (CasilleroExcepcion): sólo el cuadradito activa la excepción", () => {
  beforeEach(() => {
    catalogo.stock.central.mibi = [{ lote: "LOTE1", cantidad: 10, vencimiento: "2026-12-31" }];
    marcacionesHoyParaTest = [{ id: "m1", farmId: "mibi", lote: "LOTE1", fecha: new Date() }];
  });
  afterEach(() => {
    catalogo.stock.central.mibi = [];
    catalogo.sedes.central.farmIds = ["mibi"];
    marcacionesHoyParaTest = [];
    marcacionesHoyCallbacks = [];
  });

  async function abrirFormularioYElegirLote(user) {
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    await user.selectOptions(labelInput("Radiofármaco utilizado"), "mibi");
    await elegirLotePorTexto(user, "LOTE1");
  }

  test("tocar el texto 'No requiere marcación...' NO activa la excepción", async () => {
    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));

    await user.click(screen.getByText("No requiere marcación de radiofármaco (Tc-99m puro)"));

    // Si se hubiera activado, el Sel "Radiofármaco utilizado" desaparecería.
    expect(screen.getByText("Radiofármaco utilizado")).toBeTruthy();
    expect(screen.queryByText("Se guardará SIN marcación de radiofármaco.")).toBeNull();
  });

  test("tocar el cuadradito SÍ activa la excepción, y muestra el aviso", async () => {
    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));

    const checkbox = screen.getByLabelText("No requiere marcación de radiofármaco (Tc-99m puro)");
    await user.click(checkbox);

    expect(screen.queryByText("Radiofármaco utilizado")).toBeNull();
    expect(screen.getByText("Se guardará SIN marcación de radiofármaco.")).toBeTruthy();
  });

  test("Espacio con foco en el cuadradito también activa la excepción", async () => {
    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));

    const checkbox = screen.getByLabelText("No requiere marcación de radiofármaco (Tc-99m puro)");
    checkbox.focus();
    await user.keyboard(" ");

    expect(screen.getByText("Se guardará SIN marcación de radiofármaco.")).toBeTruthy();
  });

  test("restauración válida: tildar y destildar sin cambiar nada más devuelve el radiofármaco y el lote elegidos", async () => {
    const user = userEvent.setup();
    await abrirFormularioYElegirLote(user);
    expect(labelInput("Radiofármaco utilizado").value).toBe("mibi");
    expect(botonLote().textContent).toMatch(/^LOTE1/);

    const checkbox = screen.getByLabelText("No requiere marcación de radiofármaco (Tc-99m puro)");
    await user.click(checkbox);
    await user.click(checkbox);

    expect(labelInput("Radiofármaco utilizado").value).toBe("mibi");
    expect(botonLote().textContent).toMatch(/^LOTE1/);
  });

  test("restauración omitida: si el lote dejó de figurar como marcado mientras la excepción estaba activa, el campo queda vacío", async () => {
    const user = userEvent.setup();
    await abrirFormularioYElegirLote(user);

    const checkbox = screen.getByLabelText("No requiere marcación de radiofármaco (Tc-99m puro)");
    await user.click(checkbox);
    // Mientras la excepción está activa, Libro 1 deja de tener marcaciones
    // de hoy para este lote (p. ej. alguien deshizo esa marcación) -- el
    // listener real dispara con el array actualizado.
    await act(async () => { dispararMarcacionesHoy([]); });
    await user.click(checkbox);

    expect(labelInput("Radiofármaco utilizado").value).toBe("mibi");
    expect(botonLote().textContent).toContain("Seleccionar lote...");
  });

  test("restauración omitida: si el radiofármaco dejó de estar habilitado en la sede mientras la excepción estaba activa, ni el radiofármaco ni el lote se restauran", async () => {
    const user = userEvent.setup();
    await abrirFormularioYElegirLote(user);

    const checkbox = screen.getByLabelText("No requiere marcación de radiofármaco (Tc-99m puro)");
    await user.click(checkbox);
    // Mientras la excepción está activa, alguien desactiva "mibi" para
    // esta sede desde Configuración -- farmsDeSede ya no lo ofrece, así
    // que ni el radiofármaco ni (por lo tanto) el lote pueden restaurarse,
    // aunque ese lote siga figurando como marcado.
    catalogo.sedes.central.farmIds = [];
    await user.click(checkbox);

    expect(labelInput("Radiofármaco utilizado").value).toBe("");
    expect(botonLote().textContent).toContain("Seleccionar lote...");
  });
});

describe("TabPacientes -- 'Ver todos los lotes en stock' (CasilleroExcepcion): sólo el cuadradito activa la excepción", () => {
  beforeEach(() => {
    catalogo.stock.central.mibi = [
      { lote: "LOTE1", cantidad: 10, vencimiento: "2026-12-31" },
      { lote: "LOTE2", cantidad: 5, vencimiento: "2026-12-31" },
    ];
    marcacionesHoyParaTest = [{ id: "m1", farmId: "mibi", lote: "LOTE1", fecha: new Date() }];
  });
  afterEach(() => {
    catalogo.stock.central.mibi = [];
    marcacionesHoyParaTest = [];
    marcacionesHoyCallbacks = [];
  });

  async function abrirYElegirLote1(user) {
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    await user.selectOptions(labelInput("Radiofármaco utilizado"), "mibi");
    await elegirLotePorTexto(user, "LOTE1");
  }

  test("tocar el texto 'Ver todos los lotes en stock' NO activa la excepción", async () => {
    const user = userEvent.setup();
    await abrirYElegirLote1(user);

    await user.click(screen.getByText("Ver todos los lotes en stock (excepcional)"));

    expect(screen.queryByText("Estás eligiendo un lote que no figura como marcado hoy.")).toBeNull();
    expect(botonLote().textContent).toMatch(/^LOTE1/);
  });

  test("tocar el cuadradito SÍ activa la excepción y muestra el aviso", async () => {
    const user = userEvent.setup();
    await abrirYElegirLote1(user);

    const checkbox = screen.getByLabelText("Ver todos los lotes en stock (excepcional)");
    await user.click(checkbox);

    expect(screen.getByText("Estás eligiendo un lote que no figura como marcado hoy.")).toBeTruthy();
    // Al tildar se limpia el lote (cambia la fuente de opciones) -- LOTE2
    // (nunca marcado) ahora es elegible.
    await user.click(botonLote());
    expect(await screen.findByRole("option", { name: /^LOTE2/ })).toBeTruthy();
  });

  test("Espacio con foco en el cuadradito también activa la excepción", async () => {
    const user = userEvent.setup();
    await abrirYElegirLote1(user);

    const checkbox = screen.getByLabelText("Ver todos los lotes en stock (excepcional)");
    checkbox.focus();
    await user.keyboard(" ");

    expect(screen.getByText("Estás eligiendo un lote que no figura como marcado hoy.")).toBeTruthy();
  });

  test("restauración válida: tildar y destildar sin elegir otro lote devuelve LOTE1", async () => {
    const user = userEvent.setup();
    await abrirYElegirLote1(user);

    const checkbox = screen.getByLabelText("Ver todos los lotes en stock (excepcional)");
    await user.click(checkbox);
    await user.click(checkbox);

    expect(botonLote().textContent).toMatch(/^LOTE1/);
  });

  test("restauración omitida: si LOTE1 dejó de figurar como marcado mientras la excepción estaba activa, destildar deja el campo vacío", async () => {
    const user = userEvent.setup();
    await abrirYElegirLote1(user);

    const checkbox = screen.getByLabelText("Ver todos los lotes en stock (excepcional)");
    await user.click(checkbox);
    // El respaldo se toma al tildar (LOTE1) -- si mientras la excepción
    // está activa Libro 1 deja de tener esa marcación (p. ej. se deshizo),
    // LOTE1 ya no es válido para restaurar al destildar.
    await act(async () => { dispararMarcacionesHoy([]); });
    await user.click(checkbox);

    expect(botonLote().textContent).toContain("Seleccionar lote...");
  });
});

// Bug real investigado con Pablo: un reset/proyecto nuevo (o alguien
// borrando lu177/i131 a mano) deja el interruptor "¿Es un caso distinto a
// Tc-99m?" invisible sin ningún aviso -- silencioso. Este aviso ámbar hace
// visible esa falta para CUALQUIER rol (no sólo admin), apenas el catálogo
// terminó de cargar.
describe("TabPacientes -- aviso ámbar cuando faltan los isótopos base (I-131/Lutecio-177)", () => {
  async function abrirFormCon(user, catalogoParcial) {
    render(<TabPacientes catalogo={catalogoParcial} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
  }

  test("catálogo completo (I-131 y Lutecio-177 presentes): sin aviso", async () => {
    const user = userEvent.setup();
    await abrirFormCon(user, catalogo); // fixture de arriba, con los 3 isótopos

    expect(screen.queryByText(/No se encontró el catálogo de isótopos base/)).toBeNull();
  });

  test("faltan los dos (I-131 y Lutecio-177): aviso con el texto exacto pedido", async () => {
    const user = userEvent.setup();
    const catalogoSinAmbos = { ...catalogo, radioisotopos: [{ id: "tc99m", nombre: "Tc-99m" }] };
    await abrirFormCon(user, catalogoSinAmbos);

    expect(screen.getByText('No se encontró el catálogo de isótopos base: I-131 y Lutecio-177 no están disponibles. Avisá al administrador.')).toBeTruthy();
  });

  test("falta sólo I-131 (Lutecio-177 presente): singular, nombra sólo el que falta", async () => {
    const user = userEvent.setup();
    const catalogoSinI131 = { ...catalogo, radioisotopos: [{ id: "tc99m", nombre: "Tc-99m" }, { id: "lu177", nombre: "Lutecio-177" }] };
    await abrirFormCon(user, catalogoSinI131);

    expect(screen.getByText("No se encontró el catálogo de isótopos base: I-131 no está disponible. Avisá al administrador.")).toBeTruthy();
    // El interruptor sigue ofreciendo Lutecio-177, que sí está disponible.
    expect(screen.getByText("¿Es un caso distinto a Tc-99m?")).toBeTruthy();
  });

  test("catálogo todavía cargando (cargando=true): sin aviso aunque falten los dos", async () => {
    const user = userEvent.setup();
    const catalogoCargando = { ...catalogo, radioisotopos: [], cargando: true };
    await abrirFormCon(user, catalogoCargando);

    expect(screen.queryByText(/No se encontró el catálogo de isótopos base/)).toBeNull();
  });
});

// Bug real encontrado por Pablo (4/11): administrarMibgTransaction/
// administrarLutecioTransaction son transacciones REALES (pueden fallar de
// verdad si otra técnica usó el mismo lote un instante antes) -- pero
// limpiarForm()/setMostrarForm(false) corrían SIN esperar la promesa, así
// que el formulario se cerraba igual aunque la transacción fallara, dejando
// sólo un toast de error sobre una pantalla vacía. Ahora esperan el
// resultado: si falla, el formulario queda abierto con los datos cargados;
// si tiene éxito, se cierra y limpia como siempre.
describe("TabPacientes -- MIBG/Lutecio-177: el formulario espera la transacción antes de cerrarse", () => {
  test("MIBG: si la transacción FALLA, el formulario queda abierto con los datos cargados", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [
      { id: "lote-mibg-1", sedeId: "central", isotopoId: "mibg", numeroLote: "123-45678", proveedor: "IPEN", actividadCalibrada: 20, volumen: 2, fechaHoraCalibracion: new Date(), fecha: new Date() },
    ]));
    vi.spyOn(mibgLotesMod, "administrarMibgTransaction").mockRejectedValueOnce(new Error("Este lote ya fue administrado a otro paciente -- elegí otro."));

    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={onToast} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    const fichaInput = labelInput("N° de Ficha");
    await user.type(fichaInput, "999999");
    fichaInput.blur();
    await screen.findByText("Verificando N° de Ficha...");
    await act(async () => {
      resolverFichaIntentoDeferido.resolver({ intento: "1" });
      await resolverFichaIntentoDeferido.promesa;
    });
    await user.type(labelInput("Apellido y nombre"), "Paciente MIBG Test");
    await user.type(labelInput("DNI"), "12345678");
    await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
    await user.selectOptions(labelInput("Isótopo"), "i131");
    await user.selectOptions(labelInput("Tipo de registro"), "mibg");
    await user.selectOptions(labelInput("Lote de MIBG disponible"), "lote-mibg-1");
    await user.type(labelInput("Dosis administrada (mCi)"), "10");

    await user.click(screen.getByRole("button", { name: "Guardar registro" }));
    await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("ya fue administrado"), "error"));

    // El formulario sigue abierto, con los datos todavía cargados, y el
    // botón se volvió a habilitar (ya no dice "Guardando...").
    const boton = screen.getByRole("button", { name: "Guardar registro" });
    expect(boton).toBeTruthy();
    expect(boton.disabled).toBe(false);
    expect(labelInput("Apellido y nombre").value).toBe("Paciente MIBG Test");
    expect(labelInput("DNI").value).toBe("12345678");
  });

  // Bug real encontrado por Pablo tras el fix anterior: con el formulario
  // quedando abierto durante la transacción (en vez de cerrarse al
  // instante), un doble clic/doble tap (frecuente desde el celular)
  // disparaba DOS transacciones reales -- la primera tenía éxito, la
  // segunda rechazaba con "ya fue administrado", y la técnica veía un error
  // sobre algo que en realidad se guardó bien. transaccionEnCursoRef corta
  // el segundo guardar() de forma SÍNCRONA (no sólo vía el state del
  // botón), para cubrir un doble tap real que dispare los dos clics antes
  // de que React re-renderice con el botón disabled.
  test("MIBG: doble clic rápido invoca la transacción UNA sola vez", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [
      { id: "lote-mibg-dc", sedeId: "central", isotopoId: "mibg", numeroLote: "123-45678", proveedor: "IPEN", actividadCalibrada: 20, volumen: 2, fechaHoraCalibracion: new Date(), fecha: new Date() },
    ]));
    let resolverTransaccion;
    const espiaTransaccion = vi.spyOn(mibgLotesMod, "administrarMibgTransaction")
      .mockImplementation(() => new Promise((resolve) => { resolverTransaccion = resolve; }));

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    const fichaInput = labelInput("N° de Ficha");
    await user.type(fichaInput, "999995");
    fichaInput.blur();
    await screen.findByText("Verificando N° de Ficha...");
    await act(async () => {
      resolverFichaIntentoDeferido.resolver({ intento: "1" });
      await resolverFichaIntentoDeferido.promesa;
    });
    await user.type(labelInput("Apellido y nombre"), "Paciente Doble Clic");
    await user.type(labelInput("DNI"), "99999991");
    await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
    await user.selectOptions(labelInput("Isótopo"), "i131");
    await user.selectOptions(labelInput("Tipo de registro"), "mibg");
    await user.selectOptions(labelInput("Lote de MIBG disponible"), "lote-mibg-dc");
    await user.type(labelInput("Dosis administrada (mCi)"), "10");

    const boton = screen.getByRole("button", { name: "Guardar registro" });
    // Dos .click() nativos en el MISMO bloque act(), sin ningún await entre
    // uno y el otro -- simula un doble tap real, donde los dos eventos
    // pueden llegar antes de que React re-renderice con disabled=true.
    await act(async () => {
      boton.click();
      boton.click();
    });

    expect(espiaTransaccion).toHaveBeenCalledTimes(1);
    // Resolver DENTRO de act() y esperarla -- sin esto, la continuación
    // (.then() de guardar()) queda como una promesa colgada que se resuelve
    // en un microtask POSTERIOR a que este test ya terminó, y se filtra al
    // siguiente test del archivo (bug real de higiene de test encontrado
    // armando los tests del paso 5 -- otro test más adelante se volvía
    // flaky/colgaba por esta continuación ajena interviniendo a mitad de
    // camino).
    await act(async () => { resolverTransaccion(); await Promise.resolve(); });
  });

  // Bug real encontrado por Pablo tras el fix del doble clic: con sólo el
  // botón "Guardar registro" protegido, "Cancelar" (y la X de cerrar)
  // seguían activos mientras la transacción vieja estaba en vuelo --
  // Guardar, Cancelar, abrir un formulario NUEVO y empezar a cargarlo, y
  // cuando la transacción vieja terminaba, su .then() ejecutaba
  // limpiarForm()/setMostrarForm(false) y borraba el formulario nuevo, que
  // además quedaba con el botón trabado en "Guardando..." al reabrir.
  test("MIBG: 'Cancelar' queda deshabilitado mientras la transacción está pendiente, se habilita al resolverse", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [
      { id: "lote-mibg-cancel", sedeId: "central", isotopoId: "mibg", numeroLote: "123-45678", proveedor: "IPEN", actividadCalibrada: 20, volumen: 2, fechaHoraCalibracion: new Date(), fecha: new Date() },
    ]));
    let resolverTransaccion;
    vi.spyOn(mibgLotesMod, "administrarMibgTransaction")
      .mockImplementation(() => new Promise((resolve) => { resolverTransaccion = resolve; }));

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    const fichaInput = labelInput("N° de Ficha");
    await user.type(fichaInput, "999993");
    fichaInput.blur();
    await screen.findByText("Verificando N° de Ficha...");
    await act(async () => {
      resolverFichaIntentoDeferido.resolver({ intento: "1" });
      await resolverFichaIntentoDeferido.promesa;
    });
    await user.type(labelInput("Apellido y nombre"), "Paciente Cancelar Test");
    await user.type(labelInput("DNI"), "99999993");
    await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
    await user.selectOptions(labelInput("Isótopo"), "i131");
    await user.selectOptions(labelInput("Tipo de registro"), "mibg");
    await user.selectOptions(labelInput("Lote de MIBG disponible"), "lote-mibg-cancel");
    await user.type(labelInput("Dosis administrada (mCi)"), "10");

    await user.click(screen.getByRole("button", { name: "Guardar registro" }));

    // Transacción todavía PENDIENTE -- "Cancelar" tiene que estar
    // deshabilitado (si no, el escenario de arriba es posible).
    const botonCancelar = screen.getByRole("button", { name: "Cancelar" });
    expect(botonCancelar.disabled).toBe(true);

    await act(async () => {
      resolverTransaccion();
      await Promise.resolve();
    });

    // Resuelta -- el formulario se cerró (éxito), "Cancelar" ya no existe.
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  });

  test("MIBG: si la transacción tiene éxito, el formulario se cierra y limpia", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [
      { id: "lote-mibg-2", sedeId: "central", isotopoId: "mibg", numeroLote: "123-45678", proveedor: "IPEN", actividadCalibrada: 20, volumen: 2, fechaHoraCalibracion: new Date(), fecha: new Date() },
    ]));
    vi.spyOn(mibgLotesMod, "administrarMibgTransaction").mockResolvedValueOnce();

    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={onToast} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    const fichaInput = labelInput("N° de Ficha");
    await user.type(fichaInput, "999998");
    fichaInput.blur();
    await screen.findByText("Verificando N° de Ficha...");
    await act(async () => {
      resolverFichaIntentoDeferido.resolver({ intento: "1" });
      await resolverFichaIntentoDeferido.promesa;
    });
    await user.type(labelInput("Apellido y nombre"), "Paciente MIBG OK");
    await user.type(labelInput("DNI"), "87654321");
    await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
    await user.selectOptions(labelInput("Isótopo"), "i131");
    await user.selectOptions(labelInput("Tipo de registro"), "mibg");
    await user.selectOptions(labelInput("Lote de MIBG disponible"), "lote-mibg-2");
    await user.type(labelInput("Dosis administrada (mCi)"), "10");

    await user.click(screen.getByRole("button", { name: "Guardar registro" }));
    await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith("MIBG registrado — consultalo en la pestaña Gestión I-131"));

    expect(screen.queryByRole("button", { name: "Guardar registro" })).toBeNull();
  });

  test("Lutecio-177: si la transacción FALLA, el formulario queda abierto con los datos cargados", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [
      { id: "lote-lu-1", sedeId: "central", isotopoId: "lutecio177", numeroLote: "LPS261101E-25", numeroVial: 5, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(), fecha: new Date() },
    ]));
    vi.spyOn(mibgLotesMod, "administrarLutecioTransaction").mockRejectedValueOnce(new Error("Este lote ya fue administrado a otro paciente -- elegí otro."));

    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={onToast} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    const fichaInput = labelInput("N° de Ficha");
    await user.type(fichaInput, "999997");
    fichaInput.blur();
    await screen.findByText("Verificando N° de Ficha...");
    await act(async () => {
      resolverFichaIntentoDeferido.resolver({ intento: "1" });
      await resolverFichaIntentoDeferido.promesa;
    });
    await user.type(labelInput("Apellido y nombre"), "Paciente Lutecio Test");
    await user.type(labelInput("DNI"), "11223344");
    await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
    await user.selectOptions(labelInput("Isótopo"), "lu177");
    await user.type(labelInput("Médico responsable"), "Dr. Test");
    await user.selectOptions(labelInput("Lote de Lutecio-177 disponible"), "lote-lu-1");
    await user.type(labelInput("Dosis administrada (mCi)"), "1.5");

    await user.click(screen.getByRole("button", { name: "Guardar registro" }));
    await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("ya fue administrado"), "error"));

    const boton = screen.getByRole("button", { name: "Guardar registro" });
    expect(boton).toBeTruthy();
    expect(boton.disabled).toBe(false);
    expect(labelInput("Apellido y nombre").value).toBe("Paciente Lutecio Test");
    expect(labelInput("Médico responsable").value).toBe("Dr. Test");
  });

  test("Lutecio-177: doble clic rápido invoca la transacción UNA sola vez", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [
      { id: "lote-lu-dc", sedeId: "central", isotopoId: "lutecio177", numeroLote: "LPS261101E-25", numeroVial: 7, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(), fecha: new Date() },
    ]));
    let resolverTransaccion;
    const espiaTransaccion = vi.spyOn(mibgLotesMod, "administrarLutecioTransaction")
      .mockImplementation(() => new Promise((resolve) => { resolverTransaccion = resolve; }));

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    const fichaInput = labelInput("N° de Ficha");
    await user.type(fichaInput, "999994");
    fichaInput.blur();
    await screen.findByText("Verificando N° de Ficha...");
    await act(async () => {
      resolverFichaIntentoDeferido.resolver({ intento: "1" });
      await resolverFichaIntentoDeferido.promesa;
    });
    await user.type(labelInput("Apellido y nombre"), "Paciente Lutecio Doble Clic");
    await user.type(labelInput("DNI"), "99999992");
    await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
    await user.selectOptions(labelInput("Isótopo"), "lu177");
    await user.type(labelInput("Médico responsable"), "Dr. Test");
    await user.selectOptions(labelInput("Lote de Lutecio-177 disponible"), "lote-lu-dc");
    await user.type(labelInput("Dosis administrada (mCi)"), "1.5");

    const boton = screen.getByRole("button", { name: "Guardar registro" });
    await act(async () => {
      boton.click();
      boton.click();
    });

    expect(espiaTransaccion).toHaveBeenCalledTimes(1);
    // Ver comentario equivalente en el test de MIBG (misma causa real).
    await act(async () => { resolverTransaccion(); await Promise.resolve(); });
  });

  test("Lutecio-177: si la transacción tiene éxito, el formulario se cierra y limpia", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [
      { id: "lote-lu-2", sedeId: "central", isotopoId: "lutecio177", numeroLote: "LPS261101E-25", numeroVial: 6, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(), fecha: new Date() },
    ]));
    vi.spyOn(mibgLotesMod, "administrarLutecioTransaction").mockResolvedValueOnce();

    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={onToast} nav={null} />);
    await user.click(await screen.findByText("+ Manual"));
    const fichaInput = labelInput("N° de Ficha");
    await user.type(fichaInput, "999996");
    fichaInput.blur();
    await screen.findByText("Verificando N° de Ficha...");
    await act(async () => {
      resolverFichaIntentoDeferido.resolver({ intento: "1" });
      await resolverFichaIntentoDeferido.promesa;
    });
    await user.type(labelInput("Apellido y nombre"), "Paciente Lutecio OK");
    await user.type(labelInput("DNI"), "55667788");
    await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
    await user.selectOptions(labelInput("Isótopo"), "lu177");
    await user.type(labelInput("Médico responsable"), "Dr. Test");
    await user.selectOptions(labelInput("Lote de Lutecio-177 disponible"), "lote-lu-2");
    await user.type(labelInput("Dosis administrada (mCi)"), "1.5");

    await user.click(screen.getByRole("button", { name: "Guardar registro" }));
    await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith("Lutecio-177 registrado — consultalo en Libro 4"));

    expect(screen.queryByRole("button", { name: "Guardar registro" })).toBeNull();
  });
});

// Paso 5: useLotesDisponibles enchufado en los pickers MIBG/Lutecio-177 (ver
// mibgCandidatos/lutecio en TabPacientes.jsx). Estos tests cubren MIBG como
// representativo -- Lutecio-177 usa exactamente el mismo hook/wiring, misma
// clase de bug si algo se rompe acá se rompería igual allá.
async function llegarAFormMibg(user, numeroFicha) {
  await user.click(await screen.findByText("+ Manual"));
  const fichaInput = labelInput("N° de Ficha");
  await user.type(fichaInput, numeroFicha);
  fichaInput.blur();
  await screen.findByText("Verificando N° de Ficha...");
  await act(async () => {
    resolverFichaIntentoDeferido.resolver({ intento: "1" });
    await resolverFichaIntentoDeferido.promesa;
  });
  await user.type(labelInput("Apellido y nombre"), "Paciente Picker Test");
  await user.type(labelInput("DNI"), "11112222");
  await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
  await user.selectOptions(labelInput("Isótopo"), "i131");
  await user.selectOptions(labelInput("Tipo de registro"), "mibg");
}

async function llegarAFormLutecio(user, numeroFicha) {
  await user.click(await screen.findByText("+ Manual"));
  const fichaInput = labelInput("N° de Ficha");
  await user.type(fichaInput, numeroFicha);
  fichaInput.blur();
  await screen.findByText("Verificando N° de Ficha...");
  await act(async () => {
    resolverFichaIntentoDeferido.resolver({ intento: "1" });
    await resolverFichaIntentoDeferido.promesa;
  });
  await user.type(labelInput("Apellido y nombre"), "Paciente Picker Lutecio Test");
  await user.type(labelInput("DNI"), "33334444");
  await user.click(screen.getByText("¿Es un caso distinto a Tc-99m?"));
  await user.selectOptions(labelInput("Isótopo"), "lu177");
  await user.type(labelInput("Médico responsable"), "Dr. Picker Test");
}

const loteMibgBase = (id, numeroLote) => ({
  id, sedeId: "central", isotopoId: "mibg", numeroLote, fechaVencimiento: "2027-01-01",
  actividadCalibrada: 20, volumen: 2, fechaHoraCalibracion: new Date(), fecha: new Date(),
});
const loteLutecioBase = (id, numeroLote) => ({
  id, sedeId: "central", isotopoId: "lutecio177", numeroLote, fechaVencimiento: "2027-01-01",
  actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(), fecha: new Date(),
});

// vi.spyOn sobre estadoPorLoteDosisUnica NO se restaura solo entre tests (el
// afterEach de arriba sólo hace cleanup()) -- sin esto, el mock de un test
// (ej. una promesa que nunca resuelve, para simular cargando) se filtraba al
// siguiente test y lo hacía fallar por timeout. Alcance acotado a este
// describe exterior -- no toca el comportamiento de los tests ya existentes
// arriba.
describe("TabPacientes -- paso 5: picker MIBG/Lutecio con useLotesDisponibles", () => {
  // beforeEach (no sólo afterEach): un vi.spyOn sin restaurar de un test de
  // OTRO describe, más arriba en el archivo (ej. "doble clic rápido", que
  // deja administrarMibgTransaction devolviendo una promesa que nunca se
  // vuelve a resolver) se filtra igual -- afterEach sólo protege entre
  // tests DE ESTE describe, no contra lo que ya venía sucio de antes.
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

describe("TabPacientes -- picker de MIBG con useLotesDisponibles: cargando", () => {
  test("cargando=true: muestra 'Verificando lotes…', no ofrece ninguna opción, nunca dice 'no hay disponibles'", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteMibgBase("lote-cargando", "CARGANDO-1")]));
    vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica").mockImplementation(() => new Promise(() => {})); // nunca resuelve en este test

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await llegarAFormMibg(user, "900001");

    expect(await screen.findByText("Verificando lotes…")).toBeTruthy();
    expect(screen.queryByText("CARGANDO-1")).toBeNull();
    expect(screen.queryByText("Lote de MIBG disponible")).toBeNull(); // el Sel ni se renderiza mientras carga
    expect(screen.queryByText(/No hay lotes de MIBG disponibles/)).toBeNull(); // nunca "vacío" mientras todavía no se sabe
  });
});

describe("TabPacientes -- picker de MIBG: guardar bloqueado mientras carga", () => {
  test("sin ningún lote elegido: Guardar deshabilitado mientras cargando=true", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteMibgBase("lote-bloq", "BLOQ-1")]));
    vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica").mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await llegarAFormMibg(user, "900002");
    await user.type(labelInput("Dosis administrada (mCi)"), "5");

    expect(screen.getByRole("button", { name: "Guardar registro" }).disabled).toBe(true);
  });

  // Caso que de verdad aísla la cláusula `mibg.cargando` del disabled (la
  // de arriba también pasaría sólo con el chequeo de "sin lote elegido" --
  // ver mutación verificada en el informe): un lote QUEDA elegido (de una
  // corrida ya resuelta) y un recálculo nuevo entra en vuelo sin que la
  // selección se haya limpiado todavía (el efecto de limpieza se frena
  // mientras cargando=true, ver TabPacientes.jsx) -- con un lote elegido Y
  // cargando=true a la vez, Guardar tiene que seguir bloqueado.
  test("con un lote YA elegido: un recálculo nuevo en vuelo igual bloquea Guardar", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    let emitirLotes;
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => {
      emitirLotes = cb;
      cb([loteMibgBase("lote-elegido", "ELEGIDO-1")]);
      return () => {};
    });
    // Por CONTENIDO, no por orden global de llamada (el hook de Lutecio-177,
    // candidatos vacíos, llama a esto en paralelo todo el tiempo -- ver
    // mismo motivo en el test de "refrescar()" más abajo).
    vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica").mockImplementation(async (lotes) => {
      if (!lotes.some((l) => l.id === "lote-elegido")) return new Map();
      if (lotes.length === 1) return new Map([["lote-elegido", { estado: "disponible", uso: null, error: null }]]);
      return new Promise(() => {}); // el conjunto cambió (lote-nuevo apareció) -- esta corrida queda en vuelo
    });

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await llegarAFormMibg(user, "900008");
    await user.selectOptions(labelInput("Lote de MIBG disponible"), "lote-elegido");
    await user.type(labelInput("Dosis administrada (mCi)"), "5");
    expect(screen.getByRole("button", { name: "Guardar registro" }).disabled).toBe(false);

    // Un lote NUEVO aparece (otra carga) -- cambia el conjunto de
    // candidatos, dispara un recálculo que queda en vuelo (nunca resuelve
    // en este test) SIN tocar la selección ya hecha.
    await act(async () => { emitirLotes([loteMibgBase("lote-elegido", "ELEGIDO-1"), loteMibgBase("lote-nuevo", "NUEVO-1")]); });

    // El Sel ya ni se renderiza (cargando=true, "Verificando lotes…") -- la
    // selección interna sigue en "lote-elegido" (el efecto de limpieza se
    // frena mientras cargando), pero lo que importa acá es que Guardar se
    // bloquea de nuevo pese a que HABÍA un lote elegido.
    await screen.findByText("Verificando lotes…");
    expect(screen.getByRole("button", { name: "Guardar registro" }).disabled).toBe(true);
  });
});

describe("TabPacientes -- picker de MIBG: vacío real", () => {
  test("cargando=false y sin lotes -- mensaje claro de que no hay disponibles", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, []));

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await llegarAFormMibg(user, "900003");

    expect(await screen.findByText(/No hay lotes de MIBG disponibles/)).toBeTruthy();
    expect(screen.queryByText("Verificando lotes…")).toBeNull();
  });
});

describe("TabPacientes -- picker de MIBG: aviso de no-verificable", () => {
  test("lote no-verificable: aviso visible y claro, nunca aparece como opción elegible", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteMibgBase("lote-nv", "NOVERIF-1")]));
    vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica").mockResolvedValue(
      new Map([["lote-nv", { estado: "no-verificable", uso: null, error: new Error("permission-denied simulado") }]])
    );

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await llegarAFormMibg(user, "900004");

    expect(await screen.findByText(/no se pud.*verificar/)).toBeTruthy();
    expect(screen.queryByText("NOVERIF-1")).toBeNull();
  });
});

describe("TabPacientes -- picker de MIBG: lote usado que desaparece tras refrescar()", () => {
  test("tras guardar con éxito, el lote usado ya no se ofrece al reabrir el formulario", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteMibgBase("lote-refrescar", "REFRESCAR-1")]));
    // Implementación por CONTENIDO (no por orden de llamada global): el hook
    // de Lutecio-177 (candidatos vacíos, se ejecuta en paralelo todo el
    // tiempo) también llama a estadoPorLoteDosisUnica -- mockResolvedValueOnce
    // encadenado se mezclaría con esas llamadas ajenas. Sólo cuenta las
    // llamadas que de verdad incluyen el lote de este test.
    let llamadasConEsteLote = 0;
    vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica").mockImplementation(async (lotes) => {
      if (!lotes.some((l) => l.id === "lote-refrescar")) return new Map();
      llamadasConEsteLote++;
      const estado = llamadasConEsteLote === 1 ? "disponible" : "usado";
      return new Map([["lote-refrescar", { estado, uso: estado === "usado" ? { pacienteNombre: "Otro Paciente" } : null, error: null }]]);
    });
    // Explícito, no implícito -- un vi.spyOn SIN restaurar de un test de
    // OTRO describe (ej. "doble clic rápido", que deja esta función
    // devolviendo una promesa que nunca se vuelve a resolver) puede
    // filtrarse igual aunque este describe tenga su propio beforeEach/
    // afterEach con restoreAllMocks (bug real de este archivo encontrado
    // armando este test: colgaba sin razón aparente hasta que esto se hizo
    // explícito acá).
    vi.spyOn(mibgLotesMod, "administrarMibgTransaction").mockResolvedValue({});

    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={onToast} nav={null} />);
    await llegarAFormMibg(user, "900005");
    await user.selectOptions(labelInput("Lote de MIBG disponible"), "lote-refrescar");
    await user.type(labelInput("Dosis administrada (mCi)"), "5");
    await user.click(screen.getByRole("button", { name: "Guardar registro" }));
    await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith("MIBG registrado — consultalo en la pestaña Gestión I-131"), { timeout: 3000 });

    // La segunda llamada (con ESTE lote) es refrescar() -- confirma que se disparó.
    await vi.waitFor(() => expect(llamadasConEsteLote).toBe(2));

    await llegarAFormMibg(user, "900006");
    await screen.findByText(/No hay lotes de MIBG disponibles/);
    expect(screen.queryByText("REFRESCAR-1")).toBeNull();
  });
});

describe("TabPacientes -- picker de MIBG: la selección se limpia si el lote deja de estar disponible", () => {
  // OJO -- leer el .value del <select> NO alcanza acá: el DOM resetea el
  // value a "" en cuanto el valor controlado no matchea NINGUNA <option>
  // existente, sin importar si el estado interno (mibgLoteSeleccionado) de
  // verdad se limpió o quedó colgado en "lote-se-va" -- en los dos casos el
  // <select> se ve igual (muestra la primera opción, "Seleccionar lote...").
  // Encontrado armando este test: con el efecto de limpieza DESACTIVADO a
  // mano, el assert sobre .value pasaba igual, sin detectar nada. El chequeo
  // real: completar el resto del formulario ANTES de que el lote
  // desaparezca, y mirar el disabled de Guardar -- si mibgLoteSeleccionado
  // sigue siendo la string vieja (truthy, aunque inválida), Guardar quedaría
  // HABILITADO; si se limpió a "", queda deshabilitado.
  test("el lote elegido desaparece del conjunto de candidatos -- Guardar se bloquea (la selección interna se limpió, no sólo el <select> visual)", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    let emitirLotes;
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => {
      emitirLotes = cb;
      cb([loteMibgBase("lote-se-va", "SEVA-1")]);
      return () => {};
    });

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await llegarAFormMibg(user, "900007");
    await user.selectOptions(labelInput("Lote de MIBG disponible"), "lote-se-va");
    await user.type(labelInput("Dosis administrada (mCi)"), "5"); // completo ANTES de que el lote desaparezca
    expect(screen.getByRole("button", { name: "Guardar registro" }).disabled).toBe(false);

    // El lote desaparece del listener (otra técnica lo movió/usó un instante
    // antes, el conjunto de candidatos cambia) -- useLotesDisponibles
    // recalcula solo, y el efecto de "limpiar selección" la vacía.
    await act(async () => { emitirLotes([]); });
    await vi.waitFor(() => expect(screen.queryByText(/No hay lotes de MIBG disponibles/)).toBeTruthy());

    // Un render más -- el efecto de limpieza corre DESPUÉS del render que
    // muestra "No hay lotes" (cargando=false), su propio setMibgLoteSeleccionado("")
    // todavía puede no haberse reflejado en el DOM en el instante exacto del
    // assert anterior.
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Guardar registro" }).disabled).toBe(true));
  });
});

// Punto 1 (Pablo): sin esto, useLotesDisponibles corría SIEMPRE que la
// pantalla estaba montada, aunque nadie hubiera abierto el form o estuviera
// en Tc-99m -- ~446 lecturas puntuales por cada apertura real de la pestaña.
describe("TabPacientes -- picker MIBG/Lutecio: SIN candidatos cuando el form correspondiente no está abierto", () => {
  // El hook SIGUE llamando a estadoPorLoteDosisUnica al montar (siempre lo
  // hizo, ver useLotesDisponibles.js) -- lo que cambia es CON QUÉ: antes
  // recibía los 2 lotes reales (172+154 candidatos reales en staging,
  // ~446 lecturas); con SIN_CANDIDATOS recibe un array vacío, así que la
  // llamada es instantánea y de CERO lecturas puntuales (el loop interno
  // sobre `lotes` nunca itera). Por eso el assert es "con array vacío", no
  // "nunca se llama" -- esto último sería falso y un test así fallaría
  // siempre, sin reflejar la mejora real.
  test("form cerrado (pantalla recién montada): estadoPorLoteDosisUnica sólo se llama con un array VACÍO (cero lecturas)", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteMibgBase("lote-x", "X-1"), loteLutecioBase("lote-y", "Y-1")]));
    const espia = vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica");

    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await screen.findByText("+ Manual");
    await act(async () => { await Promise.resolve(); });

    expect(espia.mock.calls.length).toBeGreaterThan(0);
    for (const [lotesPasados] of espia.mock.calls) expect(lotesPasados).toEqual([]);
  });

  test("form abierto pero en Tc-99m (tipo por defecto, ni MIBG ni Lutecio): estadoPorLoteDosisUnica sólo se llama con un array VACÍO", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteMibgBase("lote-x", "X-1"), loteLutecioBase("lote-y", "Y-1")]));
    const espia = vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica");

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await user.click(await screen.findByText("+ Manual")); // Tc-99m es el default, no se toca nada más
    await act(async () => { await Promise.resolve(); });

    expect(espia.mock.calls.length).toBeGreaterThan(0);
    for (const [lotesPasados] of espia.mock.calls) expect(lotesPasados).toEqual([]);
  });
});

// Punto 2 (Pablo): si la transacción falla porque el lote ya estaba usado,
// el picker no debe seguir ofreciéndolo -- refrescar() también en el .catch.
describe("TabPacientes -- refrescar() tras un error (lote ya usado) -- MIBG y Lutecio-177", () => {
  test("MIBG: si la transacción falla, refrescar() se dispara igual", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteMibgBase("lote-mibg-catch", "CATCH-1")]));
    let llamadas = 0;
    vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica").mockImplementation(async (lotes) => {
      if (!lotes.some((l) => l.id === "lote-mibg-catch")) return new Map();
      llamadas++;
      return new Map([["lote-mibg-catch", { estado: "disponible", uso: null, error: null }]]);
    });
    vi.spyOn(mibgLotesMod, "administrarMibgTransaction").mockRejectedValueOnce(new Error("Este lote ya fue administrado a otro paciente -- elegí otro."));

    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={onToast} nav={null} />);
    await llegarAFormMibg(user, "900013");
    await user.selectOptions(labelInput("Lote de MIBG disponible"), "lote-mibg-catch");
    await user.type(labelInput("Dosis administrada (mCi)"), "5");
    await user.click(screen.getByRole("button", { name: "Guardar registro" }));
    await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("ya fue administrado"), "error"), { timeout: 3000 });

    await vi.waitFor(() => expect(llamadas).toBe(2)); // la segunda llamada (con este lote) es refrescar() tras el error
  });

  test("Lutecio-177: si la transacción falla, refrescar() se dispara igual", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteLutecioBase("lote-lu-catch", "LU-CATCH-1")]));
    let llamadas = 0;
    vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica").mockImplementation(async (lotes) => {
      if (!lotes.some((l) => l.id === "lote-lu-catch")) return new Map();
      llamadas++;
      return new Map([["lote-lu-catch", { estado: "disponible", uso: null, error: null }]]);
    });
    vi.spyOn(mibgLotesMod, "administrarLutecioTransaction").mockRejectedValueOnce(new Error("Este lote ya fue administrado a otro paciente -- elegí otro."));

    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={onToast} nav={null} />);
    await llegarAFormLutecio(user, "900014");
    await user.selectOptions(labelInput("Lote de Lutecio-177 disponible"), "lote-lu-catch");
    await user.type(labelInput("Dosis administrada (mCi)"), "1.5");
    await user.click(screen.getByRole("button", { name: "Guardar registro" }));
    await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("ya fue administrado"), "error"), { timeout: 3000 });

    await vi.waitFor(() => expect(llamadas).toBe(2));
  });
});

// Punto 3 (Pablo): equivalentes de Lutecio-177 a los 7 tests de MIBG --
// mismo hook, mismo wiring, misma clase de bug si algo se rompe.
describe("TabPacientes -- picker de Lutecio-177: guardar bloqueado mientras carga (con lote ya elegido)", () => {
  test("con un lote YA elegido: un recálculo nuevo en vuelo igual bloquea Guardar", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    let emitirLotes;
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => {
      emitirLotes = cb;
      cb([loteLutecioBase("lote-lu-elegido", "LU-ELEGIDO-1")]);
      return () => {};
    });
    vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica").mockImplementation(async (lotes) => {
      if (!lotes.some((l) => l.id === "lote-lu-elegido")) return new Map();
      if (lotes.length === 1) return new Map([["lote-lu-elegido", { estado: "disponible", uso: null, error: null }]]);
      return new Promise(() => {}); // el conjunto cambió -- esta corrida queda en vuelo
    });

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await llegarAFormLutecio(user, "900009");
    await user.selectOptions(labelInput("Lote de Lutecio-177 disponible"), "lote-lu-elegido");
    await user.type(labelInput("Dosis administrada (mCi)"), "1.5");
    expect(screen.getByRole("button", { name: "Guardar registro" }).disabled).toBe(false);

    await act(async () => { emitirLotes([loteLutecioBase("lote-lu-elegido", "LU-ELEGIDO-1"), loteLutecioBase("lote-lu-nuevo", "LU-NUEVO-1")]); });

    await screen.findByText("Verificando lotes…");
    expect(screen.getByRole("button", { name: "Guardar registro" }).disabled).toBe(true);
  });
});

describe("TabPacientes -- picker de Lutecio-177: la selección se limpia si el lote deja de estar disponible", () => {
  // Mismo motivo que el test equivalente de MIBG -- leer .value del
  // <select> no distingue "se limpió" de "quedó colgada" (el DOM resetea
  // el value visual en los dos casos, por no matchear ninguna <option>).
  // El chequeo real es el disabled de Guardar, con el resto del formulario
  // ya completo ANTES de que el lote desaparezca.
  test("el lote elegido desaparece del conjunto de candidatos -- Guardar se bloquea (la selección interna se limpió)", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    let emitirLotes;
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => {
      emitirLotes = cb;
      cb([loteLutecioBase("lote-lu-se-va", "LU-SEVA-1")]);
      return () => {};
    });

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} nav={null} />);
    await llegarAFormLutecio(user, "900010");
    await user.selectOptions(labelInput("Lote de Lutecio-177 disponible"), "lote-lu-se-va");
    await user.type(labelInput("Dosis administrada (mCi)"), "1.5");
    expect(screen.getByRole("button", { name: "Guardar registro" }).disabled).toBe(false);

    await act(async () => { emitirLotes([]); });
    await vi.waitFor(() => expect(screen.queryByText(/No hay lotes de Lutecio-177 disponibles/)).toBeTruthy());

    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Guardar registro" }).disabled).toBe(true));
  });
});

describe("TabPacientes -- picker de Lutecio-177: lote usado que desaparece tras refrescar() (éxito)", () => {
  test("tras guardar con éxito, el lote usado ya no se ofrece al reabrir el formulario", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteLutecioBase("lote-lu-refrescar", "LU-REFRESCAR-1")]));
    let llamadasConEsteLote = 0;
    vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica").mockImplementation(async (lotes) => {
      if (!lotes.some((l) => l.id === "lote-lu-refrescar")) return new Map();
      llamadasConEsteLote++;
      const estado = llamadasConEsteLote === 1 ? "disponible" : "usado";
      return new Map([["lote-lu-refrescar", { estado, uso: estado === "usado" ? { pacienteNombre: "Otro Paciente" } : null, error: null }]]);
    });
    vi.spyOn(mibgLotesMod, "administrarLutecioTransaction").mockResolvedValue({});

    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={onToast} nav={null} />);
    await llegarAFormLutecio(user, "900011");
    await user.selectOptions(labelInput("Lote de Lutecio-177 disponible"), "lote-lu-refrescar");
    await user.type(labelInput("Dosis administrada (mCi)"), "1.5");
    await user.click(screen.getByRole("button", { name: "Guardar registro" }));
    await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith("Lutecio-177 registrado — consultalo en Libro 4"), { timeout: 3000 });
    await vi.waitFor(() => expect(llamadasConEsteLote).toBe(2));

    await llegarAFormLutecio(user, "900012");
    await screen.findByText(/No hay lotes de Lutecio-177 disponibles/);
    expect(screen.queryByText("LU-REFRESCAR-1")).toBeNull();
  });
});

// Punto A (Pablo): admin con sedeAuditando distinta de usuario.sede -- los
// pickers no lanzan ninguna lectura y muestran un único aviso fijo, sin Sel
// ni "no hay lotes disponibles" (sería falso en este caso: no es que no
// haya lotes, es que no se puede ofrecer ningún picker real para la sede de
// trabajo mientras se está auditando otra).
const usuarioAdminOtraSede = { ...usuario, sede: "central", sedeAuditando: "italiano" };

describe("TabPacientes -- admin auditando sede distinta de la propia: picker MIBG", () => {
  test("no lanza ninguna lectura puntual, muestra el aviso fijo, sin Sel ni 'no hay lotes'", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteMibgBase("lote-x", "X-1")]));
    const espia = vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica");

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuarioAdminOtraSede} esAdmin={true} onToast={vi.fn()} nav={null} />);
    await llegarAFormMibg(user, "900015");

    expect(await screen.findByText(/Estás auditando/)).toBeTruthy();
    expect(screen.queryByText("Lote de MIBG disponible")).toBeNull();
    expect(screen.queryByText(/No hay lotes de MIBG disponibles/)).toBeNull();
    expect(screen.queryByText("Verificando lotes…")).toBeNull();
    for (const [lotesPasados] of espia.mock.calls) expect(lotesPasados).toEqual([]);
  });
});

describe("TabPacientes -- admin auditando sede distinta de la propia: picker Lutecio-177", () => {
  test("no lanza ninguna lectura puntual, muestra el aviso fijo, sin Sel ni 'no hay lotes'", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteLutecioBase("lote-y", "Y-1")]));
    const espia = vi.spyOn(mibgLotesMod, "estadoPorLoteDosisUnica");

    const user = userEvent.setup();
    render(<TabPacientes catalogo={catalogo} usuario={usuarioAdminOtraSede} esAdmin={true} onToast={vi.fn()} nav={null} />);
    await llegarAFormLutecio(user, "900017");

    expect(await screen.findByText(/Estás auditando/)).toBeTruthy();
    expect(screen.queryByText("Lote de Lutecio-177 disponible")).toBeNull();
    expect(screen.queryByText(/No hay lotes de Lutecio-177 disponibles/)).toBeNull();
    expect(screen.queryByText("Verificando lotes…")).toBeNull();
    for (const [lotesPasados] of espia.mock.calls) expect(lotesPasados).toEqual([]);
  });
});

}); // cierra "TabPacientes -- paso 5: picker MIBG/Lutecio con useLotesDisponibles"
