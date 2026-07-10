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
        try {
          const solicitudExistente = await fetchSolicitud(firebaseUser.email);
          if (!solicitudExistente) await crearSolicitud(firebaseUser.email, firebaseUser.displayName);
        } catch {
          // Carrera entre dos logins casi simultáneos (dos pestañas, etc.):
          // el segundo intento de crear la solicitud puede llegar cuando el
          // doc ya existe, y las reglas lo rechazan (create ya usado). No es
          // un error real para el usuario -- la solicitud ya quedó creada
          // por el otro intento -- así que se ignora en vez de dejar el
          // spinner de carga colgado para siempre.
        }
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
