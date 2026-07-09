import { useContext } from "react";
import { CatalogoContext } from "../context/CatalogoContext.jsx";

export function useCatalogo() {
  const ctx = useContext(CatalogoContext);
  if (!ctx) throw new Error("useCatalogo debe usarse dentro de <CatalogoProvider>");
  return ctx;
}
