/**
 * EL SELLADO DE LA SALA (CONVENCIONES §4.1), a nivel de unidad.
 *
 * Lo que se fija aquí no es que el chat funcione, es que NADA del usuario salga por un
 * mensaje dirigido sin sobre, ni siquiera en los caminos donde apetece hacer una
 * excepción: el apodo del que entra, el latido, la pregunta de reputación y la respuesta
 * con las notas. La prueba de que por el cable no viaja legible está en el e2e
 * (`test/sealed-chat.e2e.mjs`), que graba los DOS extremos; esto fija las decisiones.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../src/services/store.js', () => ({
  loadHistory: vi.fn().mockResolvedValue([]),
  persistMessage: vi.fn(),
  clearHistory: vi.fn(),
  getStore: vi.fn().mockResolvedValue(null)
}))

vi.mock('../src/services/identity.js', () => ({
  getIdentity: vi.fn().mockResolvedValue({
    makeChallenge: vi.fn().mockResolvedValue({ nonce: 'N1' }),
    signChallenge: vi.fn().mockResolvedValue({ publickey: 'PK-XYZW', signature: 'S' }),
    verifyResponse: vi.fn(),
    getRatingsForSubject: vi.fn().mockResolvedValue({ mine: null, endorsements: [] }),
    recordQuery: vi.fn()
  }),
  myPubkey: () => 'PK-ME'
}))

import { useRoomStore } from '../src/stores/roomStore.js'
import { useConnectionStore } from '../src/stores/connectionStore.js'

/** Una sala con el transporte pinchado: se ve exactamente qué se le pidió mandar. */
function sala ({ conocidos = ['XYZW'], falla = null } = {}) {
  setActivePinia(createPinia())
  const connection = useConnectionStore()
  connection.token = 'ME01'
  connection.nickname = 'me'
  connection.isConnected = true

  const sellados = []   // { token, raw }
  connection.sendMessage = vi.fn(async (to, raw) => {
    const list = Array.isArray(to) ? to : [to]
    const sent = []
    const failed = []
    for (const t of list) {
      if (!conocidos.includes(t)) { failed.push({ token: t, code: 'no-peer-identity' }); continue }
      if (falla) { failed.push({ token: t, code: falla }); continue }
      sellados.push({ token: t, raw })
      sent.push(t)
    }
    return { sent, failed }
  })
  connection.greet = vi.fn()
  connection.wsProxyClient = {
    isConnected: true,
    publish: vi.fn().mockResolvedValue(),
    unpublish: vi.fn().mockResolvedValue(),
    listChannel: vi.fn().mockResolvedValue([]),
    channelCount: vi.fn().mockResolvedValue(0),
    listChannels: vi.fn().mockResolvedValue([]),
    pubkeyOfToken: vi.fn((t) => (conocidos.includes(t) ? `PK-${t}` : null)),
    helloTo: vi.fn(),
    // Si algo llamara a `send` (sin sellar) el test lo caza aquí.
    send: vi.fn(() => { throw new Error('se intentó mandar un mensaje dirigido SIN SELLAR') })
  }

  const room = useRoomStore()
  room.currentRoom = 'general'
  room.members = [{ token: 'ME01', nickname: 'me', isMe: true }]
  room.messages = []
  return { room, connection, sellados }
}

const tipoDe = (raw) => raw.slice(0, raw.indexOf('|'))
const cargaDe = (raw) => JSON.parse(raw.slice(raw.indexOf('|') + 1))
const esperar = () => new Promise((r) => setTimeout(r, 0))

describe('la sala no manda nada del usuario sin sobre', () => {
  let room, connection, sellados

  beforeEach(() => {
    vi.clearAllMocks()
    ;({ room, connection, sellados } = sala())
  })

  it('el canal público va SIN el apodo: ahí lo lee quien opera el servidor', async () => {
    await room.joinRoom('general')
    const [canal, extra] = connection.wsProxyClient.publish.mock.calls.at(-1)
    expect(canal).toBe('chat_room_general')
    expect(extra).toBeUndefined()
  })

  it('el latido lleva el apodo, y por eso va sellado', async () => {
    room.members.push({ token: 'XYZW', nickname: 'ana', lastSeen: Date.now(), isMe: false })
    connection.wsProxyClient.listChannel.mockResolvedValueOnce(['ME01', 'XYZW'])
    await room.handleIncomingMessage('XYZW', 'HEARTBEAT|' + JSON.stringify({
      nickname: 'ana', roomName: 'general', timestamp: 1
    }))
    // El ACK del saludo de sala va por el camino sellado, nunca por `send`.
    room.handlePeerJoined('XYZW', 'chat_room_general')
    await esperar()
    const ack = sellados.find(s => tipoDe(s.raw) === 'HEARTBEAT_ACK')
    expect(ack).toBeTruthy()
    expect(cargaDe(ack.raw).nickname).toBe('me')
    expect(connection.wsProxyClient.send).not.toHaveBeenCalled()
  })

  it('las notas de calificación y el pubkey del calificado van sellados', async () => {
    room.members.push({ token: 'XYZW', nickname: 'ana', pubkey: 'PK-XYZW', isMe: false })
    await room.handleIncomingMessage('XYZW', 'RATING_QUERY|' + JSON.stringify({
      queryId: 'q1', subject: 'PK-SUJETO'
    }))
    await esperar()
    const reply = sellados.find(s => tipoDe(s.raw) === 'RATING_REPLY')
    expect(reply).toBeTruthy()
    expect(cargaDe(reply.raw).subject).toBe('PK-SUJETO')
    expect(connection.wsProxyClient.send).not.toHaveBeenCalled()
  })
})

describe('a quien todavía no ha dicho quién es', () => {
  it('no se le manda en claro: se guarda y sale entero cuando se sabe', async () => {
    const { room, connection, sellados } = sala({ conocidos: [] })
    room.handlePeerJoined('NUEVO', 'chat_room_general')
    await esperar()

    // Se le saludó y NO salió nada: sin saber de quién es ese token no hay a quién
    // sellarle, y el apodo no se manda «mientras tanto».
    expect(connection.greet).toHaveBeenCalledWith('NUEVO')
    expect(sellados).toHaveLength(0)

    // Cuando contesta el saludo, sale lo que estaba esperando.
    connection.wsProxyClient.pubkeyOfToken.mockReturnValue('PK-NUEVO')
    connection.sendMessage.mockImplementation(async (to, raw) => {
      const list = Array.isArray(to) ? to : [to]
      for (const t of list) sellados.push({ token: t, raw })
      return { sent: list, failed: [] }
    })
    room.handlePeerIdentity('NUEVO', 'PK-NUEVO')
    await esperar()
    expect(sellados.some(s => tipoDe(s.raw) === 'HEARTBEAT_ACK')).toBe(true)
  })

  it('la cola tiene tope: quien nunca contesta no la hace crecer sin fin', async () => {
    const { room, connection, sellados } = sala({ conocidos: [] })
    for (let i = 0; i < 20; i++) {
      room.handlePeerJoined('MUDO', 'chat_room_general')
      await esperar()
    }
    connection.wsProxyClient.pubkeyOfToken.mockReturnValue('PK-MUDO')
    connection.sendMessage.mockImplementation(async (to, raw) => {
      const list = Array.isArray(to) ? to : [to]
      for (const t of list) sellados.push({ token: t, raw })
      return { sent: list, failed: [] }
    })
    room.handlePeerIdentity('MUDO', 'PK-MUDO')
    await esperar()
    // 8 es el tope de la cola; lo que salga además es el reto de identidad, que no
    // estaba esperando.
    expect(sellados.filter(s => tipoDe(s.raw) === 'HEARTBEAT_ACK')).toHaveLength(8)
  })
})

describe('a quien nunca anunció con qué sellarle', () => {
  it('no se le manda nada, y la sala lo DICE (una vez por motivo)', async () => {
    const { room, sellados } = sala({ conocidos: ['XYZW'], falla: 'no-encpub' })
    room.members.push({ token: 'XYZW', nickname: 'ana', isMe: false })

    room.handlePeerJoined('XYZW', 'chat_room_general')
    await esperar()
    room.handlePeerJoined('XYZW', 'chat_room_general')
    await esperar()

    expect(sellados).toHaveLength(0)
    const avisos = room.messages.filter(m => m.key === 'peerUnreachable')
    expect(avisos).toHaveLength(1)
    expect(avisos[0].params).toMatchObject({ code: 'no-encpub', nickname: 'ana' })
  })

  it('distingue el motivo por su code, no por la frase', async () => {
    const { room } = sala({ conocidos: ['XYZW'], falla: 'encpub-unverified' })
    room.members.push({ token: 'XYZW', nickname: 'ana', isMe: false })
    room.handlePeerJoined('XYZW', 'chat_room_general')
    await esperar()
    expect(room.messages.find(m => m.key === 'peerUnreachable').params.code).toBe('encpub-unverified')
  })
})

describe('el saludo no está firmado; el reto sí', () => {
  it('quien saluda como uno y prueba ser otro se va de la sala', async () => {
    const { room } = sala()
    const { getIdentity } = await import('../src/services/identity.js')
    const id = await getIdentity()
    id.verifyResponse = vi.fn().mockResolvedValue({ ok: true, publickey: 'PK-OTRO' })

    room.handlePeerIdentity('XYZW', 'PK-XYZW')
    await esperar()
    expect(room.members.find(m => m.token === 'XYZW')).toBeTruthy()

    await room.handleIncomingMessage('XYZW', 'IDENTIFY_RESPONSE|' + JSON.stringify({
      publickey: 'PK-OTRO', signature: 'S'
    }))
    await esperar()
    expect(room.members.find(m => m.token === 'XYZW')).toBeUndefined()
  })
})
