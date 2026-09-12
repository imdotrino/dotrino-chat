import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock del servicio del store: loadHistory devuelve un historial controlado y
// persistMessage es un spy para verificar que se guardan los mensajes de chat.
vi.mock('../src/services/store.js', () => ({
  loadHistory: vi.fn().mockResolvedValue([]),
  persistMessage: vi.fn(),
  clearHistory: vi.fn(),
  getStore: vi.fn().mockResolvedValue(null)
}))

// La bóveda es un iframe: en un test unitario se sustituye por lo mínimo que la sala
// le pide. Lo que importa aquí es que el mensaje que se persiste salió de un SOBRE, no
// de un campo de texto en claro.
vi.mock('../src/services/identity.js', () => ({
  getIdentity: vi.fn().mockResolvedValue({
    decrypt: vi.fn().mockResolvedValue({ plaintext: 'mensaje persistible' })
  }),
  myPubkey: () => 'PK-ME'
}))

import { loadHistory, persistMessage } from '../src/services/store.js'
import { useRoomStore } from '../src/stores/roomStore.js'
import { useConnectionStore } from '../src/stores/connectionStore.js'

function setupStores ({ token = 'ME01', nickname = 'me' } = {}) {
  setActivePinia(createPinia())
  const connection = useConnectionStore()
  connection.token = token
  connection.nickname = nickname
  connection.isConnected = true
  // `sendMessage` sella uno por destinatario y devuelve a quién no se le pudo mandar:
  // nunca lanza por un peer suelto, y NUNCA cae a mandar en claro.
  connection.sendMessage = vi.fn(async (to) => ({
    sent: Array.isArray(to) ? [...to] : [to], failed: []
  }))
  connection.greet = vi.fn()
  connection.wsProxyClient = {
    isConnected: true,
    publish: vi.fn().mockResolvedValue(),
    unpublish: vi.fn().mockResolvedValue(),
    listChannel: vi.fn().mockResolvedValue([]),
    channelCount: vi.fn().mockResolvedValue(0),
    listChannels: vi.fn().mockResolvedValue([]),
    // El saludo ya se ha dado: en los tests de presencia los tokens tienen dueño.
    pubkeyOfToken: vi.fn((t) => `PK-${t}`),
    helloTo: vi.fn(),
    sendSealedTo: vi.fn().mockResolvedValue()
  }
  const room = useRoomStore()
  return { room, connection }
}

describe('persistencia del historial (store del ecosistema)', () => {
  let room

  beforeEach(() => {
    vi.clearAllMocks()
    ;({ room } = setupStores())
  })

  it('restaura el historial persistido al entrar a la sala', async () => {
    loadHistory.mockResolvedValueOnce([
      { id: 'h1', from: 'AB01', nickname: 'ana', text: 'hola viejo', ts: 1000, isMe: false },
      { id: 'h2', from: 'ME01', nickname: 'me', text: 'qué tal', ts: 2000, isMe: true }
    ])

    await room.joinRoom('general')

    expect(loadHistory).toHaveBeenCalledWith('general')
    const chats = room.messages.filter(m => m.type === 'chat')
    expect(chats.map(m => m.text)).toEqual(['hola viejo', 'qué tal'])
    expect(chats[0]).toMatchObject({ id: 'h1', historic: true, isMe: false })
    expect(chats[1]).toMatchObject({ id: 'h2', historic: true, isMe: true })
    // Y además el aviso de sistema "entraste a la sala" (clave + datos: el
    // texto lo arma la vista según el idioma).
    expect(room.messages.some(m => m.type === 'system' && m.key === 'youJoined')).toBe(true)
  })

  it('arranca sin historial si el store no devuelve nada', async () => {
    loadHistory.mockResolvedValueOnce([])
    await room.joinRoom('random')
    const chats = room.messages.filter(m => m.type === 'chat')
    expect(chats).toHaveLength(0)
  })

  it('persiste un mensaje de chat entrante (CHAT_ENC)', async () => {
    room.currentRoom = 'general'
    room.members = [
      { token: 'ME01', nickname: 'me', isMe: true },
      { token: 'AB01', nickname: 'ana', encryptionPubkey: 'ENC-ANA', isMe: false }
    ]
    room.handleIncomingMessage('AB01', `CHAT_ENC|${JSON.stringify({
      envelope: { v: 2, iv: 'x', ct: 'y', wrap: {} },
      nickname: 'ana', roomName: 'general', timestamp: 1234
    })}`)
    await new Promise(r => setTimeout(r, 0))

    expect(persistMessage).toHaveBeenCalledTimes(1)
    const [roomArg, msgArg] = persistMessage.mock.calls[0]
    expect(roomArg).toBe('general')
    expect(msgArg).toMatchObject({ type: 'chat', text: 'mensaje persistible', isMe: false })
  })

  it('no persiste mensajes de sistema', () => {
    room.currentRoom = 'general'
    room.members = [{ token: 'ME01', nickname: 'me', isMe: true }]
    room.handlePeerJoined('XYZW', 'chat_room_general') // genera system "joined"
    // persistMessage solo se llama para type 'chat'
    expect(persistMessage).not.toHaveBeenCalled()
  })
})
