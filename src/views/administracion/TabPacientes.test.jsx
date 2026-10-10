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

vi.mock("../../services/firestore/mibgLotes.js", () => ({
  listenMibgLotes: (cb) => listenerCon(cb),
  administrarMibgTransaction: vi.fn(async () => {}),
  administrarLutecioTransaction: vi.fn(async () => {}),
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
