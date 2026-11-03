// Aislamiento entre sedes (2026-11-03): rama de stock por rol en
// CatalogoProvider -- probado acá porque no es un caso de firestore.rules
// (es puro JS del lado cliente, antes de llegar a ninguna query real): un
// técnico sin sedeId (roles/{email}.sede vacío/ausente) o un rol
// desconocido nunca deben disparar collection(db,'sedes',undefined,'lotes')
// -- eso arma una ruta inválida, no un permission-denied limpio. Se tratan
// como el mismo error visible (stockError) que ya usa un fallo real de
// lectura, nunca como "sin stock" silencioso.
import { test, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CatalogoProvider } from "./CatalogoContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";

afterEach(cleanup);

const listenLotes = vi.fn();
const listenLotesSede = vi.fn();
vi.mock("../services/firestore/stock.js", () => ({
  listenLotes: (...args) => listenLotes(...args),
  listenLotesSede: (...args) => listenLotesSede(...args),
}));
vi.mock("../services/firestore/farms.js", () => ({ listenFarms: (cb) => { cb([]); return () => {}; } }));
vi.mock("../services/firestore/sedes.js", () => ({ listenSedes: (cb) => { cb({}); return () => {}; } }));
vi.mock("../services/firestore/proveedores.js", () => ({ listenProveedores: (cb) => { cb([]); return () => {}; } }));
vi.mock("../services/firestore/radioisotopos.js", () => ({ listenRadioisotopos: (cb) => { cb([]); return () => {}; } }));
vi.mock("../services/firestore/estudios.js", () => ({ listenEstudios: (cb) => { cb([]); return () => {}; } }));

function Sonda() {
  const { stock, stockError, cargando } = useCatalogo();
  if (cargando) return <div>cargando</div>;
  return <div>stockError={String(stockError)} stockKeys={Object.keys(stock).join(",")}</div>;
}

afterEach(() => { listenLotes.mockReset(); listenLotesSede.mockReset(); });

test("técnico con sedeId vacío: NO llama a listenLotesSede, muestra stockError", async () => {
  render(<CatalogoProvider rol="tecnico" sedeId=""><Sonda /></CatalogoProvider>);
  const estado = await screen.findByText(/stockError=/);
  expect(listenLotesSede).not.toHaveBeenCalled();
  expect(estado.textContent).toContain("stockError=true");
});

test("técnico con sedeId undefined: NO llama a listenLotesSede, muestra stockError", async () => {
  render(<CatalogoProvider rol="tecnico"><Sonda /></CatalogoProvider>);
  const estado = await screen.findByText(/stockError=/);
  expect(listenLotesSede).not.toHaveBeenCalled();
  expect(estado.textContent).toContain("stockError=true");
});

test("rol desconocido: NO llama a listenLotes ni listenLotesSede, muestra stockError", async () => {
  render(<CatalogoProvider rol="supervisor" sedeId="central"><Sonda /></CatalogoProvider>);
  const estado = await screen.findByText(/stockError=/);
  expect(listenLotes).not.toHaveBeenCalled();
  expect(listenLotesSede).not.toHaveBeenCalled();
  expect(estado.textContent).toContain("stockError=true");
});

test("control positivo: técnico con sedeId llama a listenLotesSede(sedeId, ...), sin stockError", async () => {
  listenLotesSede.mockImplementation((sedeId, cb) => { cb({ [sedeId]: {} }); return () => {}; });
  render(<CatalogoProvider rol="tecnico" sedeId="central"><Sonda /></CatalogoProvider>);
  const estado = await screen.findByText(/stockError=/);
  expect(listenLotesSede).toHaveBeenCalledWith("central", expect.any(Function), expect.any(Function));
  expect(estado.textContent).toContain("stockError=false");
});

test("control positivo: admin llama a listenLotes (collectionGroup), no a listenLotesSede", async () => {
  listenLotes.mockImplementation((cb) => { cb({}); return () => {}; });
  render(<CatalogoProvider rol="admin"><Sonda /></CatalogoProvider>);
  const estado = await screen.findByText(/stockError=/);
  expect(listenLotes).toHaveBeenCalled();
  expect(listenLotesSede).not.toHaveBeenCalled();
  expect(estado.textContent).toContain("stockError=false");
});

test("control: administrativa no se suscribe a ningún listener de stock, sin stockError", async () => {
  render(<CatalogoProvider rol="administrativa"><Sonda /></CatalogoProvider>);
  const estado = await screen.findByText(/stockError=/);
  expect(listenLotes).not.toHaveBeenCalled();
  expect(listenLotesSede).not.toHaveBeenCalled();
  expect(estado.textContent).toContain("stockError=false");
});
