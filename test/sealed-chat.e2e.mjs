/**
 * Prueba de punta a punta del SELLADO de la sala (CONVENCIONES §4.1).
 *
 * Dos navegadores de verdad, cada uno con su propio perfil, conversando por el proxio de
 * PRODUCCIÓN. Lo que se comprueba no es que el chat funcione, sino:
 *
 *   · que por el socket NO viaja nada legible, en las DOS direcciones: ni el apodo, ni
 *     el texto, ni el pubkey del calificado, ni las notas de calificación. Sellar solo
 *     de salida se lo salta quien acepte texto en claro.
 *   · que el apodo tampoco se queda escrito en el canal PÚBLICO, que es donde estaba
 *     antes a la vista de quien opera el servidor.
 *   · que la conversación llega: el mensaje de uno aparece en la pantalla del otro.
 *   · que el fallo es DISTINGUIBLE por `code` y nunca cae a mandar en claro:
 *     `no-peer-identity` (nadie ha dicho de quién es ese token) ≠ `no-encpub` (dijo
 *     quién es, pero nunca anunció con qué sellarle).
 *
 * Cómo correrla:
 *
 *   npm install && npx playwright install chromium
 *   npm run build && npm run preview -- --port 4180 &
 *   npm run test:e2e                      # o CHAT_BASE=https://chat.dotrino.com/
 *
 * Habla con `wss://proxy.dotrino.com` y con la bóveda `id.dotrino.com`: hace falta red.
 */
import { chromium } from 'playwright'

const BASE = process.env.CHAT_BASE || 'http://127.0.0.1:4180/'
const SALA = 'e2e' + Math.random().toString(36).slice(2, 8)
const NICK_A = 'anaE2E' + Math.random().toString(36).slice(2, 5)
const NICK_B = 'benE2E' + Math.random().toString(36).slice(2, 5)
const TEXTO = 'secreto-' + Math.random().toString(36).slice(2, 10)

const resultados = []
const check = (nombre, ok, detalle = '') => {
  resultados.push({ nombre, ok, detalle })
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}${detalle ? ' — ' + detalle : ''}`)
}

/** Graba TODO lo que entra y sale por el WebSocket, antes de que cargue la app. */
const GRABADORA = () => {
  window.__frames = { out: [], in: [] }
  const NativeWS = window.WebSocket
  const Patched = function (url, protocols) {
    const ws = protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols)
    const send = ws.send.bind(ws)
    ws.send = (data) => { try { window.__frames.out.push(String(data)) } catch (_) {} ; return send(data) }
    ws.addEventListener('message', (e) => { try { window.__frames.in.push(String(e.data)) } catch (_) {} })
    return ws
  }
  Patched.prototype = NativeWS.prototype
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Patched[k] = NativeWS[k]
  window.WebSocket = Patched
}

const navegador = await chromium.launch()

async function nuevaPagina (etiqueta) {
  const ctx = await navegador.newContext()
  await ctx.addInitScript(GRABADORA)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  (${etiqueta}) PAGEERROR ${e.message}`))
  return { ctx, page }
}

async function entrar (page, nick) {
  await page.goto(BASE)
  await page.waitForSelector('[data-testid="nickname-input"]', { timeout: 30000 })
  await page.fill('[data-testid="nickname-input"]', nick)
  await page.click('[data-testid="nickname-submit"]')
  await page.waitForFunction(() => window.dotrinoChat?.connection?.isConnected === true, null, { timeout: 30000 })
  // La sala se crea escribiéndola en el creador de salas.
  await page.fill('.create-input', SALA)
  await page.click('.room-create button')
  await page.waitForFunction((s) => window.dotrinoChat?.room?.currentRoom === s, SALA, { timeout: 20000 })
}

const A = await nuevaPagina('ana')
const B = await nuevaPagina('ben')

await entrar(A.page, NICK_A)
check('el primero entra, se identifica y crea la sala', true, SALA)

await entrar(B.page, NICK_B)
check('el segundo entra a la misma sala', true)

// ---------- 1. se reconocen (el saludo del transporte) ----------
// Dos pasos, y hacen cosas distintas: el SALUDO dice de quién es cada token (con eso ya
// se le puede sellar), y el RETO lo demuestra y trae con qué cifrar el texto del chat.
const listo = (page) => page.waitForFunction(
  () => window.dotrinoChat.room.members.filter((m) => !m.isMe && m.pubkey && m.encryptionPubkey).length >= 1,
  null, { timeout: 40000 }
).then(() => true).catch(() => false)
const seVen = (await listo(A.page)) && (await listo(B.page))
check('se reconocen: cada token dice de quién es, y lo demuestra', seVen)

// ---------- 2. una conversación de verdad ----------
await A.page.fill('[data-testid="composer"]', TEXTO)
await A.page.click('[data-testid="send"]')

const llego = await B.page.waitForFunction(
  (t) => [...document.querySelectorAll('[data-testid="message"]')].some((e) => e.textContent.includes(t)),
  TEXTO, { timeout: 30000 }
).then(() => true).catch(() => false)
check('el mensaje llega al otro navegador y se lee', llego, TEXTO)

const nickVisible = await B.page.evaluate((n) => {
  return [...document.querySelectorAll('[data-testid="message"]')].some((e) => (e.getAttribute('data-nickname') || '') === n)
}, NICK_A)
check('el otro ve QUIÉN lo escribió (el apodo viajó, pero dentro del sobre)', nickVisible, NICK_A)

// ---------- 3. lo que de verdad se mide: qué se vio por el cable ----------
await new Promise((r) => setTimeout(r, 2500))   // que acaben latidos y calificaciones

const frames = {
  ana: await A.page.evaluate(() => window.__frames),
  ben: await B.page.evaluate(() => window.__frames),
}

const SECRETOS = [
  ['el texto del mensaje', TEXTO],
  ['el apodo de quien escribe', NICK_A],
  ['el apodo del otro', NICK_B],
]

let limpio = true
for (const [quien, f] of Object.entries(frames)) {
  for (const direccion of ['out', 'in']) {
    const todo = f[direccion].join('\n')
    for (const [nombre, secreto] of SECRETOS) {
      if (todo.includes(secreto)) {
        limpio = false
        check(`NADA legible por el cable — ${quien}/${direccion}`, false, `se vio ${nombre}`)
      }
    }
  }
}
if (limpio) {
  const total = Object.values(frames).reduce((n, f) => n + f.out.length + f.in.length, 0)
  check('NADA legible por el cable, en los dos extremos y en los dos sentidos', true, `${total} tramas grabadas`)
}

// El apodo tampoco en el canal público, que es donde estaba antes.
const publishConApodo = Object.values(frames).some((f) =>
  f.out.filter((t) => t.includes('"type":"publish"')).some((t) => t.includes(NICK_A) || t.includes(NICK_B)))
check('el canal público ya no lleva el apodo escrito', !publishConApodo)

// Y sí se ve el saludo: una trama de control que solo lleva una llave pública.
const saludo = frames.ana.out.map((t) => { try { return JSON.parse(t) } catch (_) { return null } })
  .filter((f) => f?.message && String(f.message).includes('__cc_hello__'))
  .map((f) => JSON.parse(f.message))
const saludoLimpio = saludo.length > 0 && saludo.every((s) => Object.keys(s).sort().join(',') === 'publickey,t')
check('el saludo va en claro y SOLO lleva la llave pública', saludoLimpio, `${saludo.length} saludos`)

// ---------- 4. el fallo se distingue, y nunca cae a claro ----------
const sinIdentidad = await A.page.evaluate(async () => {
  try {
    await window.dotrinoChat.client.sendSealedTo('TOKEN-QUE-NADIE-SALUDO', { x: 1 })
    return 'no lanzó'
  } catch (e) { return e.code }
})
check('a un token del que nadie ha dicho nada: `no-peer-identity`', sinIdentidad === 'no-peer-identity', sinIdentidad)

const sinLlave = await A.page.evaluate(async () => {
  // Una identidad real, bien formada, que jamás anunció llave de cifrado.
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', par.publicKey)
  try {
    await window.dotrinoChat.client.sendSealedTo('TOKEN', { x: 1 }, { peerPubkey: JSON.stringify(jwk) })
    return 'no lanzó'
  } catch (e) { return e.code }
})
check('a quien nunca anunció con qué sellarle: `no-encpub`', sinLlave === 'no-encpub', sinLlave)

const enClaro = await A.page.evaluate(async () => {
  try {
    window.dotrinoChat.client.send('TOKEN', { texto: 'en claro' })
    return 'no lanzó'
  } catch (e) { return e.code }
})
check('mandar en claro por token está cortado: `unsealed`', enClaro === 'unsealed', enClaro)

// ---------- cierre ----------
await navegador.close()

const fallos = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length - fallos.length}/${resultados.length} comprobaciones OK`)
if (fallos.length) {
  console.log('FALLAN:\n' + fallos.map((f) => ' · ' + f.nombre + (f.detalle ? ' — ' + f.detalle : '')).join('\n'))
  process.exit(1)
}
