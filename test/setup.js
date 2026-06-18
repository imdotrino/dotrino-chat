// happy-dom no expone WebSocket global. El código del cliente usa WebSocket.OPEN
// como constante; un polyfill mínimo es suficiente para los tests unitarios
// (los tests no abren sockets reales — usan un fake con readyState = 1).
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3
  }
}

// happy-dom no siempre expone un `localStorage` funcional en este entorno
// (los stores leen `localStorage.getItem` al inicializar). Polyfill en memoria
// si falta o no es funcional, suficiente para los tests unitarios.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.getItem !== 'function') {
  const mem = new Map()
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(String(k), String(v)) },
    removeItem: (k) => { mem.delete(k) },
    clear: () => { mem.clear() },
    key: (i) => [...mem.keys()][i] ?? null,
    get length () { return mem.size }
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
  if (globalThis.window) {
    try { Object.defineProperty(globalThis.window, 'localStorage', { value: storage, configurable: true, writable: true }) } catch { /* */ }
  }
}
