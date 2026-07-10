import { useEffect, useState } from "react";
import { listenAuthState, fetchRol, fetchSolicitud, crearSolicitud } from "../services/auth.js";

// usuario:
//   null                                     -> nadie logueado
//   {sinAcceso:true, email, nombreGoogle}    -> logueado con Google pero sin doc en roles/
//   {email, nombre, rol, sede, initial}      -> acceso concedido
export function useAuth() {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const unsub = listenAuthState(async (firebaseUser) => {
      if (!firebaseUser) {
        setUsuario(null);
        setCargando(false);
        return;
      }
      setCargando(true);
      const rol = await fetchRol(firebaseUser.email);
      if (!rol) {
        const solicitudExistente = await fetchSolicitud(firebaseUser.email);
        if (!solicitudExistente) await crearSolicitud(firebaseUser.email, firebaseUser.displayName);
        setUsuario({ sinAcceso: true, email: firebaseUser.email, nombreGoogle: firebaseUser.displayName });
      } else {
        setUsuario({ ...rol, initial: (rol.nombre || rol.email)[0].toUpperCase() });
      }
      setCargando(false);
    });
    return unsub;
  }, []);

  return { usuario, cargando };
}
