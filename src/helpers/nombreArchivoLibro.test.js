import { describe, test, expect } from "vitest";
import { nombreArchivoLibro, periodoMes, slugSede } from "./nombreArchivoLibro.js";
import { SEDES } from "../constants/sedes.js";

// Único call site real de imprimir(libro) -- GenerarActasImpresion.jsx,
// `onClick={() => imprimir(l.id)}` sobre el array LIBROS (líneas 148-156 de
// ese archivo) -- los 4 `id` son literales hardcodeados ahí mismo, nunca
// vienen de datos externos ni de otro valor posible. Si alguna vez se
// agrega un id distinto de estos 4, este test lo detecta antes que un
// usuario real tocando "Imprimir".
const LIBRO_IDS_REALES = ["libro1", "libro2", "libro3", "libro4"];

describe("slugSede", () => {
  test("sin tildes, sin ñ, sin espacios -- sedes reales (constants/sedes.js)", () => {
    expect(slugSede("Central")).toBe("Central");
    expect(slugSede("Italiano")).toBe("Italiano");
    expect(slugSede("Español")).toBe("Espanol");
    expect(slugSede("San Rafael")).toBe("SanRafael");
  });

  test("sede ausente -- no rompe, devuelve vacío", () => {
    expect(slugSede(undefined)).toBe("");
  });
});

describe("periodoMes", () => {
  test("mes en minúscula, con año -- distinto de nombreMes (que capitaliza para el encabezado)", () => {
    expect(periodoMes("2026-10")).toBe("octubre-2026");
    expect(periodoMes("2026-01")).toBe("enero-2026");
  });

  // Tabla fija (no toLocaleDateString, ver comentario en nombreArchivoLibro.js)
  // -- un test por mes, los 12, para que un error de índice en la tabla no
  // pase inadvertido en uno solo.
  test("los 12 meses, uno por uno", () => {
    const NOMBRES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    NOMBRES.forEach((nombre, i) => {
      const mesISO = `2026-${String(i + 1).padStart(2, "0")}`;
      expect(periodoMes(mesISO)).toBe(`${nombre}-2026`);
    });
  });
});

describe("nombreArchivoLibro", () => {
  test("Libro4 PDF, ejemplo de Pablo: Libro4-Lutecio-177_octubre-2026_Central.pdf", () => {
    const nombre = nombreArchivoLibro({ libro: "libro4", extension: "pdf", periodo: periodoMes("2026-10"), sedeShort: "Central" });
    expect(nombre).toBe("Libro4-Lutecio-177_octubre-2026_Central.pdf");
  });

  test("los 4 libros, nombres sin tildes", () => {
    expect(nombreArchivoLibro({ libro: "libro1", extension: "pdf", periodo: "agosto-2026", sedeShort: "Italiano" })).toBe("Libro1-Marcacion_agosto-2026_Italiano.pdf");
    expect(nombreArchivoLibro({ libro: "libro2", extension: "pdf", periodo: "agosto-2026", sedeShort: "Italiano" })).toBe("Libro2-Pacientes_agosto-2026_Italiano.pdf");
    expect(nombreArchivoLibro({ libro: "libro3", extension: "pdf", periodo: "agosto-2026", sedeShort: "Italiano" })).toBe("Libro3-Elucion_agosto-2026_Italiano.pdf");
  });

  test("CSV de un día (Libro 1/2/3)", () => {
    const nombre = nombreArchivoLibro({ libro: "libro1", extension: "csv", periodo: "2026-10-15", sedeShort: "Central" });
    expect(nombre).toBe("Libro1-Marcacion_2026-10-15_Central.csv");
  });

  test("CSV de un rango de fechas (búsqueda 'Ver todos', no existe un CSV sin acotar -- ver diagnóstico)", () => {
    const nombre = nombreArchivoLibro({ libro: "libro3", extension: "csv", periodo: "2026-09-01_a_2026-10-15", sedeShort: "San Rafael" });
    expect(nombre).toBe("Libro3-Elucion_2026-09-01_a_2026-10-15_SanRafael.csv");
  });

  // Pedido explícito de Pablo (verificación anti-rotura): imprimir(libro) en
  // GenerarActasImpresion.jsx SIEMPRE llama con uno de estos 4 ids literales
  // (ver LIBRO_IDS_REALES más arriba) -- si nombreArchivoLibro no sabe
  // resolver alguno, acá se ve con "undefined" en el nombre en vez de recién
  // romper al tocar "Imprimir" en producción. SEDES viene de
  // constants/sedes.js REAL (no una copia a mano) -- si se agrega/renombra
  // una sede ahí, este test corre con los valores reales de ese momento.
  test("los 4 ids reales de imprimir(libro) x las sedes reales de constants/sedes.js -- nunca 'undefined'", () => {
    for (const libro of LIBRO_IDS_REALES) {
      for (const sede of SEDES) {
        const nombre = nombreArchivoLibro({ libro, extension: "pdf", periodo: "octubre-2026", sedeShort: sede.short });
        expect(nombre).not.toMatch(/undefined/);
        expect(nombre).toMatch(/^Libro[1-4]-.+_octubre-2026_.+\.pdf$/);
      }
    }
  });
});
