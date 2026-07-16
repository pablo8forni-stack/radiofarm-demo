import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../firebase.js";
import { slugify } from "../../helpers/formato.js";

const proveedoresCol = collection(db, "proveedores");
const proveedorRef = (id) => doc(proveedoresCol, id);

// Emite proveedores con los campos nuevos (cuit/direccion/contactoNombre/
// contactoEmail/contactoTelefono) en "" si el doc todavía no los tiene.
// `contacto` era el único campo de contacto libre antes de esta pantalla --
// si un doc lo tiene pero no tiene contactoTelefono, se usa como valor
// inicial de ese campo para no perder el dato ya cargado (p. ej. el
// "Proveedor Principal" sembrado). Ningún otro lugar del código lee
// `contacto`, así que queda inerte una vez que se guarda con el campo nuevo.
export function listenProveedores(callback) {
  return onSnapshot(query(proveedoresCol, orderBy("nombre")), (snap) => {
    callback(snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        cuit: "", direccion: "", contactoNombre: "", contactoEmail: "", contactoTelefono: data.contacto || "", principal: false,
        ...data,
      };
    }));
  });
}

export function addProveedor({ nombre, cuit, direccion, contactoNombre, contactoEmail, contactoTelefono, principal }) {
  const id = `${slugify(nombre)}-${Date.now().toString().slice(-4)}`;
  return setDoc(proveedorRef(id), {
    nombre, cuit: cuit || "", direccion: direccion || "",
    contactoNombre: contactoNombre || "", contactoEmail: contactoEmail || "", contactoTelefono: contactoTelefono || "",
    principal: !!principal,
  });
}

export function updateProveedor(id, { nombre, cuit, direccion, contactoNombre, contactoEmail, contactoTelefono }) {
  return updateDoc(proveedorRef(id), {
    nombre, cuit: cuit || "", direccion: direccion || "",
    contactoNombre: contactoNombre || "", contactoEmail: contactoEmail || "", contactoTelefono: contactoTelefono || "",
  });
}

export function deleteProveedor(id) {
  return deleteDoc(proveedorRef(id));
}

// Exclusivo: sólo puede haber un proveedor principal a la vez. El caller
// pasa el id del principal anterior (si hay) para no tener que buscarlo acá.
export function setProveedorPrincipal(id, prevPrincipalId) {
  const batch = writeBatch(db);
  if (prevPrincipalId && prevPrincipalId !== id) batch.update(proveedorRef(prevPrincipalId), { principal: false });
  batch.update(proveedorRef(id), { principal: true });
  return batch.commit();
}
