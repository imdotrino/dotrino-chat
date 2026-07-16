import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// El servicio del store carga un iframe (store.dotrino.com) que no aplica en
// tests unitarios: lo mockeamos como no-op para no tocar la red ni colgar.
vi.mock('../src/services/store.js', () => ({
  loadHistory: vi.fn().mockResolvedValue([]),
  persistMessage: vi.fn(),
  clearHistory: vi.fn(),
  getStore: vi.fn().mockResolvedValue(null)
}))

import { useRoomStore } from '../src/stores/roomStore.js'
import { useConnectionStore } from '../src/stores/connectionStore.js'

function setupStores({ token = 'ME01', nickname = 'me' } = {}) {
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

function parseHeartbeat(rawMessage) {
  const idx = rawMessage.indexOf('|')
  return {
    type: rawMessage.slice(0, idx),
    payload: JSON.parse(rawMessage.slice(idx + 1))
  }
}

describe('roomStore — presencia con eventos del proxy', () => {
  let room, connection
  const channel = 'chat_room_general'

  beforeEach(async () => {
    ({ room, connection } = setupStores())
    // Forzar entrar a la sala sin disparar joins reales
    room.currentRoom = 'general'
    room.members = [{
      token: connection.token,
      nickname: connection.nickname,
      lastSeen: Date.now(),
      isMe: true
    }]
    room.messages = []
  })

  describe('handlePeerJoined', () => {
    it('agrega un miembro nuevo con nickname placeholder y envía HEARTBEAT_ACK', () => {
      room.handlePeerJoined('XYZW', channel)

      expect(room.members).toHaveLength(2)
      const newMember = room.members.find(m => m.token === 'XYZW')
      expect(newMember).toMatchObject({
        token: 'XYZW',
        nickname: 'XYZW', // placeholder
        isMe: false
      })

      expect(connection.sendMessage).toHaveBeenCalledTimes(1)
      const [targets, raw] = connection.sendMessage.mock.calls[0]
      expect(targets).toEqual(['XYZW'])
      const { type, payload } = parseHeartbeat(raw)
      expect(type).toBe('HEARTBEAT_ACK')
      expect(payload).toMatchObject({ nickname: 'me', roomName: 'general' })
    })

    it('ignora joined de otro canal', () => {
      room.handlePeerJoined('XYZW', 'chat_room_other')
      expect(room.members).toHaveLength(1)
      expect(connection.sendMessage).not.toHaveBeenCalled()
    })

    it('ignora joined con el propio token', () => {
      room.handlePeerJoined(connection.token, channel)
      expect(room.members).toHaveLength(1)
      expect(connection.sendMessage).not.toHaveBeenCalled()
    })

    it('actualiza lastSeen pero NO duplica si el miembro ya existe', () => {
      room.members.push({ token: 'XYZW', nickname: 'preset', lastSeen: 0, isMe: false })

      room.handlePeerJoined('XYZW', channel)

      expect(room.members.filter(m => m.token === 'XYZW')).toHaveLength(1)
      const existing = room.members.find(m => m.token === 'XYZW')
      expect(existing.nickname).toBe('preset') // no sobreescribe nickname
      expect(existing.lastSeen).toBeGreaterThan(0)
      // Aún así envía HEARTBEAT_ACK (puede que el otro lado nos haya perdido)
      expect(connection.sendMessage).toHaveBeenCalled()
    })

    it('no hace nada si no estamos en una sala', () => {
      room.currentRoom = null
      room.handlePeerJoined('XYZW', channel)
      expect(connection.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('handlePeerLeft', () => {
    beforeEach(() => {
      room.members.push({ token: 'XYZW', nickname: 'bob', lastSeen: Date.now(), isMe: false })
    })

    it('remueve al miembro y agrega mensaje de sistema "left"', () => {
      room.handlePeerLeft('XYZW', channel)

      expect(room.members.find(m => m.token === 'XYZW')).toBeUndefined()
      const sysMsg = room.messages.find(m => m.type === 'system')
      // El aviso guarda la clave + los datos; el texto lo arma la vista (i18n).
      expect(sysMsg).toMatchObject({ key: 'left', params: { nickname: 'bob' } })
    })

    it('ignora left de otro canal', () => {
      room.handlePeerLeft('XYZW', 'chat_room_other')
      expect(room.members.find(m => m.token === 'XYZW')).toBeTruthy()
    })

    it('noop si el miembro no existe', () => {
      room.handlePeerLeft('NONE', channel)
      expect(room.members).toHaveLength(2) // self + bob
      expect(room.messages).toHaveLength(0)
    })
  })

  describe('handlePeerDisconnected', () => {
    beforeEach(() => {
      room.members.push({ token: 'XYZW', nickname: 'alice', lastSeen: Date.now(), isMe: false })
    })

    it('remueve al miembro cuando channel coincide y agrega "disconnected"', () => {
      room.handlePeerDisconnected('XYZW', channel)

      expect(room.members.find(m => m.token === 'XYZW')).toBeUndefined()
      const sysMsg = room.messages.find(m => m.type === 'system')
      expect(sysMsg).toMatchObject({ key: 'disconnected', params: { nickname: 'alice' } })
    })

    it('procesa disconnected forma legacy (sin channel) si el miembro existe', () => {
      room.handlePeerDisconnected('XYZW', undefined)
      expect(room.members.find(m => m.token === 'XYZW')).toBeUndefined()
    })

    it('ignora disconnected con channel de otra sala', () => {
      room.handlePeerDisconnected('XYZW', 'chat_room_other')
      expect(room.members.find(m => m.token === 'XYZW')).toBeTruthy()
    })

    it('noop si el miembro no está en la sala', () => {
      room.handlePeerDisconnected('NONE', channel)
      expect(room.messages).toHaveLength(0)
    })
  })

  describe('handleIncomingMessage', () => {
    it('rutea CHAT_MSG: agrega mensaje y upsertea miembro', () => {
      const raw = 'CHAT_MSG|' + JSON.stringify({
        nickname: 'bob',
        roomName: 'general',
        text: 'hola',
        timestamp: 123
      })
      room.handleIncomingMessage('XYZW', raw)

      const chat = room.messages.find(m => m.type === 'chat')
      expect(chat).toMatchObject({ from: 'XYZW', nickname: 'bob', text: 'hola' })
      expect(room.members.find(m => m.token === 'XYZW')).toMatchObject({ nickname: 'bob' })
    })

    it('rutea JOIN_ANNOUNCE: upserta miembro con nickname real, envía HEARTBEAT_ACK', () => {
      const raw = 'JOIN_ANNOUNCE|' + JSON.stringify({
        nickname: 'alice',
        roomName: 'general',
        timestamp: 123
      })
      room.handleIncomingMessage('XYZW', raw)

      expect(room.members.find(m => m.token === 'XYZW')).toMatchObject({ nickname: 'alice' })
      expect(connection.sendMessage).toHaveBeenCalled()
      const [targets, ack] = connection.sendMessage.mock.calls[0]
      expect(targets).toEqual(['XYZW'])
      expect(parseHeartbeat(ack).type).toBe('HEARTBEAT_ACK')
    })

    it('rutea LEAVE_ANNOUNCE: remueve miembro', () => {
      room.members.push({ token: 'XYZW', nickname: 'alice', lastSeen: 0, isMe: false })
      const raw = 'LEAVE_ANNOUNCE|' + JSON.stringify({
        nickname: 'alice',
        roomName: 'general',
        timestamp: 123
      })
      room.handleIncomingMessage('XYZW', raw)
      expect(room.members.find(m => m.token === 'XYZW')).toBeUndefined()
    })

    it('rutea HEARTBEAT: upserta miembro y NO envía HEARTBEAT_ACK', () => {
      const raw = 'HEARTBEAT|' + JSON.stringify({
        nickname: 'alice',
        roomName: 'general',
        timestamp: 123
      })
      room.handleIncomingMessage('XYZW', raw)
      expect(room.members.find(m => m.token === 'XYZW')).toMatchObject({ nickname: 'alice' })
      expect(connection.sendMessage).not.toHaveBeenCalled()
    })

    it('rutea HEARTBEAT_ACK: upserta miembro', () => {
      const raw = 'HEARTBEAT_ACK|' + JSON.stringify({
        nickname: 'alice',
        roomName: 'general',
        timestamp: 123
      })
      room.handleIncomingMessage('XYZW', raw)
      expect(room.members.find(m => m.token === 'XYZW')).toMatchObject({ nickname: 'alice' })
    })

    it('ignora mensajes para otra sala', () => {
      const raw = 'CHAT_MSG|' + JSON.stringify({
        nickname: 'bob',
        roomName: 'other',
        text: 'hola',
        timestamp: 123
      })
      room.handleIncomingMessage('XYZW', raw)
      expect(room.messages).toHaveLength(0)
    })

    it('ignora payload mal formado', () => {
      room.handleIncomingMessage('XYZW', 'CHAT_MSG|not-json')
      expect(room.messages).toHaveLength(0)
    })

    it('ignora si no estamos en una sala', () => {
      room.currentRoom = null
      const raw = 'CHAT_MSG|' + JSON.stringify({
        nickname: 'bob', roomName: 'general', text: 'x', timestamp: 0
      })
      room.handleIncomingMessage('XYZW', raw)
      expect(room.messages).toHaveLength(0)
    })
  })
})

describe('roomStore — listPublicRooms (descubrimiento dinámico)', () => {
  it('descubre salas dinámicas además de las default y muestra counts del servidor', async () => {
    const { room, connection } = setupStores()
    connection.wsProxyClient.listChannels.mockResolvedValue([
      { name: 'chat_room_general', count: 3 },
      { name: 'chat_room_prueba', count: 1 }
    ])

    await room.listPublicRooms()

    expect(connection.wsProxyClient.listChannels).toHaveBeenCalledWith({ prefix: 'chat_room_' })

    const names = room.rooms.map(r => r.name)
    expect(names).toContain('general')
    expect(names).toContain('random')   // default mantenida aunque no esté en el server
    expect(names).toContain('prueba')   // descubierta dinámicamente

    expect(room.rooms.find(r => r.name === 'general').memberCount).toBe(3)
    expect(room.rooms.find(r => r.name === 'random').memberCount).toBe(0)
    expect(room.rooms.find(r => r.name === 'prueba').memberCount).toBe(1)
  })

  it('mantiene defaults primero y ordena las dinámicas alfabéticamente', async () => {
    const { room, connection } = setupStores()
    connection.wsProxyClient.listChannels.mockResolvedValue([
      { name: 'chat_room_zzz', count: 1 },
      { name: 'chat_room_aaa', count: 1 },
      { name: 'chat_room_general', count: 5 }
    ])

    await room.listPublicRooms()

    const names = room.rooms.map(r => r.name)
    expect(names.slice(0, 2)).toEqual(['general', 'random'])
    expect(names.slice(2)).toEqual(['aaa', 'zzz'])
  })

  it('preserva la sala actual aunque no esté en el directorio del servidor', async () => {
    const { room, connection } = setupStores()
    room.currentRoom = 'mi-sala'
    connection.wsProxyClient.listChannels.mockResolvedValue([])

    await room.listPublicRooms()

    const miSala = room.rooms.find(r => r.name === 'mi-sala')
    expect(miSala).toBeTruthy()
    expect(miSala.memberCount).toBe(1)
  })

  it('si listChannels falla, no rompe (ya catcheado)', async () => {
    const { room, connection } = setupStores()
    connection.wsProxyClient.listChannels.mockRejectedValue(new Error('boom'))

    await expect(room.listPublicRooms()).resolves.toBeUndefined()
  })
})
