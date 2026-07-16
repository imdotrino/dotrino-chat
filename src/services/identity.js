// Identidad = vault id.dotrino.com (única fuente del ecosistema). No
// reimplementamos nada: este módulo solo cachea LA conexión para que la app
// entera (stores, topbar, perfil) comparta una sola instancia.

import { Identity } from '@dotrino/identity'

let identity = null
let _promise = null

/** Conecta (una sola vez) al vault. Null si no alcanza: la app sigue sin identidad. */
export async function getIdentity () {
  if (identity) return identity
  if (!_promise) {
    _promise = Identity.connect()
      .then((id) => { identity = id; return id })
      .catch((e) => {
        console.warn('Identity vault unreachable, identity features disabled:', e)
        identity = null
        return null
      })
  }
  return _promise
}

/** Mi pubkey del vault (o null si aún no conectó / no hay vault). */
export function myPubkey () { return identity?.me?.publickey || null }
