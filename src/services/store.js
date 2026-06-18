// Persistencia del historial local del chat usando el store estándar del
// ecosistema (`@dotrino/store` ≥ 0.3.0, IndexedDB en
// `store.dotrino.com`). Es un almacén de THREADS de mensajes: cada sala es un
// thread (`chat:<sala>`) y cada mensaje propio/recibido (ya en claro en este
// cliente) se guarda como una entrada.
//
// No cambia el modelo E2E: los mensajes viajan cifrados por el proxy y ningún
// servidor guarda historial; esto solo persiste TU vista local en TU navegador
// (no se sincroniza salvo que actives el sync a tu Drive en el vault del store).

import { Store } from '@dotrino/store'

let _storePromise = null

/** Conecta (una sola vez) al store del ecosistema. Null si no alcanza. */
export function getStore () {
  if (!_storePromise) {
    _storePromise = Store.connect()
      .then((s) => s)
      .catch((e) => { console.warn('Store del ecosistema inalcanzable:', e); return null })
  }
  return _storePromise
}

const threadKey = (room) => `chat:${room}`

/** Carga el historial persistido de una sala (best-effort, vacío si no alcanza). */
export async function loadHistory (room, limit = 200) {
  const store = await getStore()
  if (!store) return []
  try {
    return await store.listThread(threadKey(room), { limit })
  } catch (e) { console.warn('loadHistory falló:', e); return [] }
}

/** Persiste un mensaje de chat (fire-and-forget; ignora fallos). */
export async function persistMessage (room, message) {
  if (!room || !message || message.type !== 'chat') return
  const store = await getStore()
  if (!store) return
  try {
    await store.appendMessage(threadKey(room), {
      id: message.id,
      ts: message.timestamp || Date.now(),
      from: message.from,
      nickname: message.nickname,
      type: 'chat',
      text: message.text,
      isMe: !!message.isMe
    })
  } catch (e) { console.warn('persistMessage falló:', e) }
}

/** Borra el historial persistido de una sala. */
export async function clearHistory (room) {
  const store = await getStore()
  if (!store) return
  try { await store.removeThread(threadKey(room)) } catch (e) { console.warn('clearHistory falló:', e) }
}
