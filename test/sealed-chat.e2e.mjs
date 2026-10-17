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
const ROOM = 'e2e' + Math.random().toString(36).slice(2, 8)
const NICK_A = 'anaE2E' + Math.random().toString(36).slice(2, 5)
const NICK_B = 'benE2E' + Math.random().toString(36).slice(2, 5)
const TEXT = 'secreto-' + Math.random().toString(36).slice(2, 10)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

/** Graba TODO lo que entra y sale por el WebSocket, antes de que cargue la app. */
const RECORDER = () => {
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

const browser = await chromium.launch()

async function newPage (label) {
  const ctx = await browser.newContext()
  await ctx.addInitScript(RECORDER)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  (${label}) PAGEERROR ${e.message}`))
  return { ctx, page }
}

async function enter (page, nick) {
  await page.goto(BASE)
  await page.waitForSelector('[data-testid="nickname-input"]', { timeout: 30000 })
  await page.fill('[data-testid="nickname-input"]', nick)
  await page.click('[data-testid="nickname-submit"]')
  await page.waitForFunction(() => window.dotrinoChat?.connection?.isConnected === true, null, { timeout: 30000 })
  // La sala se crea escribiéndola en el creador de salas.
  await page.fill('.create-input', ROOM)
  await page.click('.room-create button')
  await page.waitForFunction((s) => window.dotrinoChat?.room?.currentRoom === s, ROOM, { timeout: 20000 })
}

const A = await newPage('ana')
const B = await newPage('ben')

await enter(A.page, NICK_A)
check('the first one enters, identifies and creates the room', true, ROOM)

await enter(B.page, NICK_B)
check('the second one enters the same room', true)

// ---------- 1. se reconocen (el saludo del transporte) ----------
// Dos pasos, y hacen cosas distintas: el SALUDO dice de quién es cada token (con eso ya
// se le puede sellar), y el RETO lo demuestra y trae con qué cifrar el texto del chat.
const ready = (page) => page.waitForFunction(
  () => window.dotrinoChat.room.members.filter((m) => !m.isMe && m.pubkey && m.encryptionPubkey).length >= 1,
  null, { timeout: 40000 }
).then(() => true).catch(() => false)
const seeEachOther = (await ready(A.page)) && (await ready(B.page))
check('they recognise each other: each token says whose it is, and proves it', seeEachOther)

// ---------- 2. una conversación de verdad ----------
await A.page.fill('[data-testid="composer"]', TEXT)
await A.page.click('[data-testid="send"]')

const arrived = await B.page.waitForFunction(
  (t) => [...document.querySelectorAll('[data-testid="message"]')].some((e) => e.textContent.includes(t)),
  TEXT, { timeout: 30000 }
).then(() => true).catch(() => false)
check('the message reaches the other browser and is readable', arrived, TEXT)

const nickVisible = await B.page.evaluate((n) => {
  return [...document.querySelectorAll('[data-testid="message"]')].some((e) => (e.getAttribute('data-nickname') || '') === n)
}, NICK_A)
check('the other one sees WHO wrote it (the nickname travelled, but inside the envelope)', nickVisible, NICK_A)

// ---------- 3. lo que de verdad se mide: qué se vio por el cable ----------
await new Promise((r) => setTimeout(r, 2500))   // que acaben latidos y calificaciones

const frames = {
  ana: await A.page.evaluate(() => window.__frames),
  ben: await B.page.evaluate(() => window.__frames),
}

const SECRETS = [
  ['the message text', TEXT],
  ['the nickname of the writer', NICK_A],
  ['the nickname of the other one', NICK_B],
]

let clean = true
for (const [who, f] of Object.entries(frames)) {
  for (const direction of ['out', 'in']) {
    const all = f[direction].join('\n')
    for (const [name, secret] of SECRETS) {
      if (all.includes(secret)) {
        clean = false
        check(`NOTHING readable on the wire — ${who}/${direction}`, false, `seen: ${name}`)
      }
    }
  }
}
if (clean) {
  const total = Object.values(frames).reduce((n, f) => n + f.out.length + f.in.length, 0)
  check('NOTHING readable on the wire, at both ends and in both directions', true, `${total} frames recorded`)
}

// El apodo tampoco en el canal público, que es donde estaba antes.
const publishWithNick = Object.values(frames).some((f) =>
  f.out.filter((t) => t.includes('"type":"publish"')).some((t) => t.includes(NICK_A) || t.includes(NICK_B)))
check('the public channel no longer carries the nickname', !publishWithNick)

// Y sí se ve el saludo: una trama de control que solo lleva una llave pública.
const hello = frames.ana.out.map((t) => { try { return JSON.parse(t) } catch (_) { return null } })
  .filter((f) => f?.message && String(f.message).includes('__cc_hello__'))
  .map((f) => JSON.parse(f.message))
const helloClean = hello.length > 0 && hello.every((s) => Object.keys(s).sort().join(',') === 'publickey,t')
check('the hello goes in clear and ONLY carries the public key', helloClean, `${hello.length} hellos`)

// ---------- 4. el fallo se distingue, y nunca cae a claro ----------
const noIdentity = await A.page.evaluate(async () => {
  try {
    await window.dotrinoChat.client.sendSealedTo('TOKEN-QUE-NADIE-SALUDO', { x: 1 })
    return 'did not throw'
  } catch (e) { return e.code }
})
check('to a token nobody has vouched for: `no-peer-identity`', noIdentity === 'no-peer-identity', noIdentity)

const noKey = await A.page.evaluate(async () => {
  // Una identidad real, bien formada, que jamás anunció llave de cifrado.
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  try {
    await window.dotrinoChat.client.sendSealedTo('TOKEN', { x: 1 }, { peerPubkey: JSON.stringify(jwk) })
    return 'did not throw'
  } catch (e) { return e.code }
})
check('to someone who never announced a sealing key: `no-encpub`', noKey === 'no-encpub', noKey)

const inClear = await A.page.evaluate(async () => {
  try {
    window.dotrinoChat.client.send('TOKEN', { text: 'in clear' })
    return 'did not throw'
  } catch (e) { return e.code }
})
check('sending in clear by token is blocked: `unsealed`', inClear === 'unsealed', inClear)

// ---------- cierre ----------
await browser.close()

const failures = results.filter((r) => !r.ok)
console.log(`\n${results.length - failures.length}/${results.length} checks OK`)
if (failures.length) {
  console.log('FAILED:\n' + failures.map((f) => ' · ' + f.name + (f.detail ? ' — ' + f.detail : '')).join('\n'))
  process.exit(1)
}
