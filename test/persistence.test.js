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

import { loadHistory, persistMessage } from '../src/services/store.js'
import { useRoomStore } from '../src/stores/roomStore.js'
import { useConnectionStore } from '../src/stores/connectionStore.js'

function setupStores ({ token = 'ME01', nickname = 'me' } = {}) {
  setActivePinia(createPinia())
  const connection = useConnectionStore()
  connection.token = token
  connection.nickname = nickname
  connection.isConnected = true
  connection.sendMessage = vi.fn().mockResolvedValue()
  connection.wsProxyClient = {
    isConnected: true,
    publish: vi.fn().mockResolvedValue(),
    unpublish: vi.fn().mockResolvedValue(),
    listChannel: vi.fn().mockResolvedValue([]),
    channelCount: vi.fn().mockResolvedValue(0),
    listChannels: vi.fn().mockResolvedValue([]),
    send: vi.fn().mockResolvedValue()
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
    // Y además el mensaje de sistema "You joined".
    expect(room.messages.some(m => m.type === 'system' && /joined/i.test(m.text))).toBe(true)
  })

  it('arranca sin historial si el store no devuelve nada', async () => {
    loadHistory.mockResolvedValueOnce([])
    await room.joinRoom('random')
    const chats = room.messages.filter(m => m.type === 'chat')
    expect(chats).toHaveLength(0)
  })

  it('persiste un mensaje de chat entrante (legacy CHAT_MSG)', () => {
    room.currentRoom = 'general'
    room.members = [{ token: 'ME01', nickname: 'me', isMe: true }]
    room.handleIncomingMessage('AB01', `CHAT_MSG|${JSON.stringify({
      nickname: 'ana', text: 'mensaje persistible', roomName: 'general', timestamp: 1234
    })}`)

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
