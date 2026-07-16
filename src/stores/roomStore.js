import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useConnectionStore } from './connectionStore'
import { sanitizeMessage, sanitizeNickname } from '../utils/sanitize'
import { loadHistory, persistMessage } from '../services/store'
// Identidad y reputación viven en services/ (singletons compartidos con el
// <dotrino-topbar>, que es el dueño del modal "Mi perfil").
import { getIdentity } from '../services/identity'
import { getReputation } from '../services/reputation'

export const useRoomStore = defineStore('room', () => {
  const connectionStore = useConnectionStore()

  // State
  const currentRoom = ref(null)
  const rooms = ref([
    { name: 'general', memberCount: 0 },
    { name: 'random', memberCount: 0 }
  ])
  const messages = ref([])
  const members = ref([])
  // Map<pubkey, rating> de peers que yo he calificado, usado para pesar endorsements.
  const trustMap = ref(new Map())
  const isInRoom = computed(() => !!currentRoom.value)
  const channelName = computed(() => currentRoom.value ? `chat_room_${currentRoom.value}` : null)

  let refreshInterval = null
  let heartbeatInterval = null

  // Message protocol helpers
  const formatMessage = (type, payload) => {
    return `${type}|${JSON.stringify(payload)}`
  }

  const parseMessage = (raw) => {
    const pipeIdx = raw.indexOf('|')
    if (pipeIdx === -1) return { type: null, payload: null }
    const type = raw.slice(0, pipeIdx)
    try {
      const payload = JSON.parse(raw.slice(pipeIdx + 1))
      return { type, payload }
    } catch {
      return { type: null, payload: null }
    }
  }

  const ROOM_CAPACITY = 20

  // Avisos de la conversación: guardamos la CLAVE y sus datos, no el texto ya
  // armado. El idioma lo resuelve la vista (src/i18n.js), así los avisos que ya
  // están en pantalla cambian de idioma con la app (CONVENCIONES §9).
  const sysMessage = (key, params) => ({
    id: crypto.randomUUID(),
    from: 'system',
    type: 'system',
    key,
    params,
    timestamp: Date.now()
  })

  // Errores con código: el texto de cara al usuario lo pone la vista (i18n);
  // el `message` queda como pista para el log.
  const roomError = (code, params) => Object.assign(new Error(code), { code, params })

  // Actions
  const joinRoom = async (roomName) => {
    try {
      if (currentRoom.value) {
        await leaveRoom()
      }

      const targetChannel = `chat_room_${roomName}`

      // Cap de capacidad: el chat es P2P-mesh con E2E por destinatario y
      // handshake al entrar. >20 personas degrada CPU y UX. El proxy permite
      // hasta 100 como hard cap, pero el chat impone su propio límite.
      try {
        const count = await connectionStore.wsProxyClient.channelCount(targetChannel)
        if (count >= ROOM_CAPACITY) {
          throw roomError('roomFull', { max: ROOM_CAPACITY })
        }
      } catch (e) {
        // Si el error es el de capacidad, lo propagamos. Otros errores (timeout,
        // método ausente) los toleramos: el cap del proxy de 100 actúa de fallback.
        if (e?.code === 'roomFull') throw e
      }

      currentRoom.value = roomName
      messages.value = []

      // Restaurar historial local persistido (best-effort; si el store no está,
      // arranca vacío como antes). Se carga antes del aviso "You joined".
      try {
        const history = await loadHistory(roomName)
        if (currentRoom.value === roomName && history.length) {
          messages.value.push(...history.map(h => ({
            id: h.id || crypto.randomUUID(),
            from: h.from,
            nickname: h.nickname,
            type: 'chat',
            text: h.text,
            timestamp: h.ts || h.timestamp || Date.now(),
            isMe: !!h.isMe,
            historic: true
          })))
        }
      } catch (_) { /* sin historial, seguimos */ }

      members.value = [
        {
          token: connectionStore.token,
          nickname: connectionStore.nickname,
          lastSeen: Date.now(),
          isMe: true
        }
      ]

      // Publish to room channel
      await connectionStore.wsProxyClient.publish(
        channelName.value,
        { nickname: connectionStore.nickname, roomName }
      )

      // Get existing members
      await refreshMembers()

      // Broadcast join announcement
      const others = members.value
        .filter(m => !m.isMe)
        .map(m => m.token)

      if (others.length > 0) {
        const joinMsg = formatMessage('JOIN_ANNOUNCE', {
          nickname: connectionStore.nickname,
          roomName,
          timestamp: Date.now()
        })
        // Identidad: retar a los ya presentes
        for (const t of others) challengePeer(t)
        try {
          await connectionStore.sendMessage(others, joinMsg)
        } catch (e) {
          console.error('Failed to send JOIN_ANNOUNCE:', e)
        }
      }

      // Add system message
      messages.value.push(sysMessage('youJoined', { room: roomName }))

      // Start intervals
      startHeartbeat()
      startMemberRefresh()

      // Refrescar lista pública (mi nuevo publish hace que aparezca en el directorio)
      listPublicRooms().catch(() => {})

    } catch (error) {
      console.error('Join room error:', error)
      currentRoom.value = null
      throw error
    }
  }

  const leaveRoom = async () => {
    if (!currentRoom.value) return

    try {
      // Broadcast leave announcement
      const others = members.value
        .filter(m => !m.isMe)
        .map(m => m.token)

      if (others.length > 0) {
        const leaveMsg = formatMessage('LEAVE_ANNOUNCE', {
          nickname: connectionStore.nickname,
          roomName: currentRoom.value,
          timestamp: Date.now()
        })
        try {
          await connectionStore.sendMessage(others, leaveMsg)
        } catch (e) {
          console.error('Failed to send LEAVE_ANNOUNCE:', e)
        }
      }

      // Unpublish
      await connectionStore.wsProxyClient.unpublish(channelName.value)

      // Clean up
      stopHeartbeat()
      stopMemberRefresh()

      const roomName = currentRoom.value
      currentRoom.value = null
      messages.value = []
      members.value = []

      messages.value.push(sysMessage('youLeft', { room: roomName }))

      // Refrescar lista pública (mi unpublish puede haber dejado el canal vacío)
      listPublicRooms().catch(() => {})

    } catch (error) {
      console.error('Leave room error:', error)
    }
  }

  const createRoom = async (roomName) => {
    const trimmed = roomName.trim()
    if (!trimmed || trimmed.length > 32 || !/^[a-z0-9-]+$/.test(trimmed)) {
      throw roomError('badRoomName')
    }

    if (!rooms.value.find(r => r.name === trimmed)) {
      rooms.value.push({ name: trimmed, memberCount: 0 })
    }

    return joinRoom(trimmed)
  }

  const sendChatMessage = async (text) => {
    if (!currentRoom.value || !connectionStore.isConnected || !text.trim()) {
      return
    }

    const trimmed = text.trim()

    try {
      // Solo destinatarios verificados (con encryptionPubkey conocida).
      // Los demás peers verán el mensaje cuando completen el handshake.
      const recipients = members.value
        .filter(m => !m.isMe && m.token && m.encryptionPubkey)
        .map(m => ({ token: m.token, encryptionPubkey: m.encryptionPubkey }))

      if (recipients.length === 0) {
        messages.value.push(sysMessage('noVerifiedMembers'))
        return
      }

      const id = await getIdentity()
      if (!id) throw new Error('Identity vault no disponible — no se puede cifrar')

      const envelope = await id.encrypt(recipients, trimmed)

      const msg = formatMessage('CHAT_ENC', {
        envelope,
        nickname: connectionStore.nickname,
        roomName: currentRoom.value,
        timestamp: Date.now()
      })

      await connectionStore.sendMessage(recipients.map(r => r.token), msg)

      // Echo local (el remitente nunca cifra para sí mismo)
      const echo = {
        id: crypto.randomUUID(),
        from: connectionStore.token,
        nickname: connectionStore.nickname,
        type: 'chat',
        text: trimmed,
        timestamp: Date.now(),
        isMe: true
      }
      messages.value.push(echo)
      persistMessage(currentRoom.value, echo)

    } catch (error) {
      // El detalle técnico se queda en el log; en pantalla, un aviso claro.
      console.error('Send message error:', error)
      messages.value.push(sysMessage('sendFailed'))
    }
  }

  const handleIncomingMessage = (fromToken, rawMessage) => {
    if (!currentRoom.value) return

    const { type, payload } = parseMessage(rawMessage)
    if (!payload) return

    switch (type) {
      case 'CHAT_ENC':
        handleEncryptedChatMessage(fromToken, payload)
        break
      case 'CHAT_MSG':
        // Compatibilidad legacy con clientes pre-E2E (descartar en producción).
        handleChatMessage(fromToken, payload)
        break
      case 'JOIN_ANNOUNCE':
        handleJoinAnnounce(fromToken, payload)
        break
      case 'LEAVE_ANNOUNCE':
        handleLeaveAnnounce(fromToken, payload)
        break
      case 'HEARTBEAT':
        handleHeartbeat(fromToken, payload)
        break
      case 'HEARTBEAT_ACK':
        handleHeartbeatAck(fromToken, payload)
        break
      case 'IDENTIFY_CHALLENGE':
        handleIdentifyChallenge(fromToken, payload)
        break
      case 'IDENTIFY_RESPONSE':
        handleIdentifyResponse(fromToken, payload)
        break
      case 'RATING_QUERY':
        handleRatingQuery(fromToken, payload)
        break
      case 'RATING_REPLY':
        handleRatingReply(fromToken, payload)
        break
    }
  }

  // ---- Identity handshake -------------------------------------------------

  const challengePeer = async (peerToken) => {
    const id = await getIdentity()
    if (!id) return
    if (peerToken === connectionStore.token) return
    try {
      const { nonce } = await id.makeChallenge()
      const msg = formatMessage('IDENTIFY_CHALLENGE', { nonce })
      await connectionStore.sendMessage([peerToken], msg)
    } catch (e) {
      console.warn('challengePeer failed:', e)
    }
  }

  const handleIdentifyChallenge = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.nonce) return
    try {
      const response = await id.signChallenge(payload.nonce)
      const msg = formatMessage('IDENTIFY_RESPONSE', response)
      await connectionStore.sendMessage([fromToken], msg)
    } catch (e) {
      console.warn('signChallenge failed:', e)
    }
  }

  const handleIdentifyResponse = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.publickey) return
    try {
      const result = await id.verifyResponse(payload)
      if (!result.ok) return
      const member = members.value.find(m => m.token === fromToken)
      if (member) {
        member.pubkey = result.publickey
        member.encryptionPubkey = result.encryptionPubkey || payload.encryptionPubkey || null
        member.peer = result.peer || null
      }
      // Una vez verificado, intercambiar reputación del nuevo peer con el resto del cuarto
      requestRatingsForSubject(result.publickey, fromToken)
    } catch (e) {
      console.warn('verifyResponse failed:', e)
    }
  }

  // ---- Rating exchange (web of trust) -------------------------------------

  /**
   * Pregunta automáticamente al resto de la sala "qué saben sobre este pubkey".
   * El propio peer es excluido. Se ejecuta una vez tras verificar identidad.
   */
  const requestRatingsForSubject = (subjectPubkey, excludeToken) => {
    if (!subjectPubkey) return
    const targets = members.value
      .filter(m => !m.isMe && m.token !== excludeToken && m.pubkey)
      .map(m => m.token)
    if (targets.length === 0) return
    const queryId = crypto.randomUUID()
    const msg = formatMessage('RATING_QUERY', { queryId, subject: subjectPubkey })
    connectionStore.sendMessage(targets, msg).catch(() => {})
  }

  const handleRatingQuery = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.subject || !payload?.queryId) return
    const fromMember = members.value.find(m => m.token === fromToken)
    const askerPubkey = fromMember?.pubkey || null
    try {
      // Tally even queries that come from unverified askers (rare)
      if (askerPubkey) await id.recordQuery(askerPubkey, payload.subject)
      const { mine, endorsements } = await id.getRatingsForSubject(payload.subject)
      const reply = formatMessage('RATING_REPLY', {
        queryId: payload.queryId,
        subject: payload.subject,
        mine,
        endorsements
      })
      await connectionStore.sendMessage([fromToken], reply)
    } catch (e) {
      console.warn('handleRatingQuery failed:', e)
    }
  }

  const handleRatingReply = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.subject || !Array.isArray(payload?.endorsements)) return
    const fromMember = members.value.find(m => m.token === fromToken)
    const askerPubkey = fromMember?.pubkey || null
    try {
      const all = []
      if (payload.mine && payload.mine.subject === payload.subject) {
        all.push(payload.mine)
      }
      for (const e of payload.endorsements) {
        if (e && e.subject === payload.subject) all.push(e)
      }
      if (all.length === 0) return
      await id.mergeEndorsements(payload.subject, all, askerPubkey)
      // Refrescar el peer afectado
      const peer = await id.getPeer(payload.subject)
      for (const m of members.value) {
        if (m.pubkey === payload.subject) m.peer = peer
      }
    } catch (e) {
      console.warn('handleRatingReply failed:', e)
    }
  }

  /** Refresh peer info (rating/custom nickname) for all known members. */
  const refreshPeerInfo = async () => {
    const id = await getIdentity()
    if (!id) return
    for (const m of members.value) {
      if (!m.pubkey) continue
      try {
        const peer = await id.getPeer(m.pubkey)
        m.peer = peer
      } catch (_) {}
    }
  }

  /** Refresca el mapa de confianza (mis ratings emitidos). */
  const refreshTrustMap = async () => {
    const id = await getIdentity()
    if (!id) return
    try {
      const all = await id.listPeers()
      const next = new Map()
      for (const p of all) {
        const r = p?.myRating?.rating
        if (typeof r === 'number' && r > 0) next.set(p.publickey, r)
      }
      trustMap.value = next
    } catch (_) {}
  }

  /** Set a rating for a peer and refresh local cache. */
  const ratePeer = async (pubkey, rating, notes) => {
    const id = await getIdentity()
    if (!id) throw new Error('Identity vault not available')
    const updated = await id.setRating(pubkey, rating, notes)
    // Save rated peer in the shared contact book (id.dotrino.com ≥ 0.6.0).
    try {
      const m = members.value.find(x => x.pubkey === pubkey)
      await id.addContact({
        publickey: pubkey,
        nickname: m?.nickname || undefined,
        encryptionPubkey: m?.encryptionPubkey || undefined,
        lastToken: m?.token || undefined
      })
    } catch (_) {}
    for (const m of members.value) {
      if (m.pubkey === pubkey) m.peer = updated
    }
    await refreshTrustMap()
    return updated
  }

  /** Set a custom nickname for a peer. */
  const setPeerNickname = async (pubkey, nickname) => {
    const id = await getIdentity()
    if (!id) throw new Error('Identity vault not available')
    const updated = await id.setNickname(pubkey, nickname)
    for (const m of members.value) {
      if (m.pubkey === pubkey) m.peer = updated
    }
    return updated
  }

  const handleEncryptedChatMessage = async (fromToken, payload) => {
    if (!payload?.envelope) return
    if (payload.roomName && payload.roomName !== currentRoom.value) return

    const id = await getIdentity()
    if (!id) {
      console.warn('Identity vault no disponible: no se puede descifrar el mensaje')
      return
    }

    const sender = members.value.find(m => m.token === fromToken)
    const senderEncryptionPubkey = sender?.encryptionPubkey
    if (!senderEncryptionPubkey) {
      console.warn(`No tengo encryptionPubkey de ${fromToken}; no se puede descifrar`)
      return
    }

    let plaintext
    try {
      const result = await id.decrypt(senderEncryptionPubkey, connectionStore.token, payload.envelope)
      plaintext = result.plaintext
    } catch (e) {
      console.warn('Failed to decrypt incoming message:', e)
      return
    }

    const sanitizedNickname = sanitizeNickname(payload.nickname)
    const sanitizedText = sanitizeMessage(plaintext)

    const member = members.value.find(m => m.token === fromToken)
    if (member) {
      if (sanitizedNickname) member.nickname = sanitizedNickname
      member.lastSeen = Date.now()
    } else {
      members.value.push({
        token: fromToken,
        nickname: sanitizedNickname || fromToken,
        lastSeen: Date.now(),
        isMe: false
      })
    }

    const incoming = {
      id: crypto.randomUUID(),
      from: fromToken,
      nickname: sanitizedNickname || (member?.nickname || fromToken),
      type: 'chat',
      text: sanitizedText,
      timestamp: payload.timestamp || Date.now(),
      isMe: false
    }
    messages.value.push(incoming)
    persistMessage(currentRoom.value, incoming)
  }

  const handleChatMessage = (fromToken, payload) => {
    if (payload.roomName !== currentRoom.value) return

    const sanitizedNickname = sanitizeNickname(payload.nickname)
    const sanitizedText = sanitizeMessage(payload.text)

    // Update member nickname if known
    const member = members.value.find(m => m.token === fromToken)
    if (member) {
      member.nickname = sanitizedNickname
      member.lastSeen = Date.now()
    } else {
      members.value.push({
        token: fromToken,
        nickname: sanitizedNickname,
        lastSeen: Date.now(),
        isMe: false
      })
    }

    // Add message
    const legacyMsg = {
      id: crypto.randomUUID(),
      from: fromToken,
      nickname: sanitizedNickname,
      type: 'chat',
      text: sanitizedText,
      timestamp: payload.timestamp || Date.now(),
      isMe: false
    }
    messages.value.push(legacyMsg)
    persistMessage(currentRoom.value, legacyMsg)
  }

  const handleJoinAnnounce = (fromToken, payload) => {
    if (payload.roomName !== currentRoom.value) return

    const sanitizedNickname = sanitizeNickname(payload.nickname)

    // Upsert member
    let member = members.value.find(m => m.token === fromToken)
    if (member) {
      member.nickname = sanitizedNickname
      member.lastSeen = Date.now()
    } else {
      members.value.push({
        token: fromToken,
        nickname: sanitizedNickname,
        lastSeen: Date.now(),
        isMe: false
      })
    }

    // Iniciar handshake de identidad
    challengePeer(fromToken)

    // System message
    messages.value.push(sysMessage('joined', { nickname: sanitizedNickname }))

    // Reply with heartbeat
    const heartbeatMsg = formatMessage('HEARTBEAT_ACK', {
      nickname: connectionStore.nickname,
      roomName: currentRoom.value,
      timestamp: Date.now()
    })
    connectionStore.sendMessage([fromToken], heartbeatMsg).catch(() => {})
  }

  const handlePeerDisconnected = (peerToken, channel) => {
    if (!currentRoom.value) return
    // Si vino con canal, ignorar si no es el de esta sala
    if (channel && channel !== channelName.value) return

    const member = members.value.find(m => m.token === peerToken)
    if (!member) return

    members.value = members.value.filter(m => m.token !== peerToken)

    messages.value.push(sysMessage('disconnected', { nickname: member.nickname }))
  }

  const handlePeerJoined = (peerToken, channel) => {
    if (!currentRoom.value) return
    if (channel !== channelName.value) return
    if (peerToken === connectionStore.token) return

    // Upsert placeholder; el nickname real llega vía JOIN_ANNOUNCE/HEARTBEAT_ACK
    const existing = members.value.find(m => m.token === peerToken)
    if (existing) {
      existing.lastSeen = Date.now()
    } else {
      members.value.push({
        token: peerToken,
        nickname: peerToken,
        lastSeen: Date.now(),
        isMe: false
      })
    }

    // Saludar al recién llegado con HEARTBEAT_ACK para que aprenda nuestro nickname
    // sin esperar al primer heartbeat (30s) o JOIN_ANNOUNCE.
    const ackMsg = formatMessage('HEARTBEAT_ACK', {
      nickname: connectionStore.nickname,
      roomName: currentRoom.value,
      timestamp: Date.now()
    })
    connectionStore.sendMessage([peerToken], ackMsg).catch(() => {})
  }

  const handlePeerLeft = (peerToken, channel) => {
    if (!currentRoom.value) return
    if (channel !== channelName.value) return

    const member = members.value.find(m => m.token === peerToken)
    if (!member) return

    members.value = members.value.filter(m => m.token !== peerToken)

    messages.value.push(sysMessage('left', { nickname: member.nickname }))
  }

  const handleLeaveAnnounce = (fromToken, payload) => {
    if (payload.roomName !== currentRoom.value) return

    const sanitizedNickname = sanitizeNickname(payload.nickname)

    // Remove member
    members.value = members.value.filter(m => m.token !== fromToken)

    // System message
    messages.value.push(sysMessage('left', { nickname: sanitizedNickname }))
  }

  const handleHeartbeat = (fromToken, payload) => {
    if (payload.roomName !== currentRoom.value) return

    const sanitizedNickname = sanitizeNickname(payload.nickname)

    // Update or add member
    let member = members.value.find(m => m.token === fromToken)
    if (member) {
      member.nickname = sanitizedNickname
      member.lastSeen = Date.now()
    } else {
      members.value.push({
        token: fromToken,
        nickname: sanitizedNickname,
        lastSeen: Date.now(),
        isMe: false
      })
    }
  }

  const handleHeartbeatAck = (fromToken, payload) => {
    if (payload.roomName !== currentRoom.value) return

    const sanitizedNickname = sanitizeNickname(payload.nickname)

    // Update member
    let member = members.value.find(m => m.token === fromToken)
    if (member) {
      member.nickname = sanitizedNickname
      member.lastSeen = Date.now()
    } else {
      members.value.push({
        token: fromToken,
        nickname: sanitizedNickname,
        lastSeen: Date.now(),
        isMe: false
      })
    }
  }

  const refreshMembers = async () => {
    if (!channelName.value) return

    try {
      const tokens = await connectionStore.wsProxyClient.listChannel(channelName.value)
      const staleTime = Date.now() - 3 * 60 * 1000 // 3 minutes

      // Update or add members
      for (const token of tokens) {
        if (token === connectionStore.token) continue

        let member = members.value.find(m => m.token === token)
        if (!member) {
          members.value.push({
            token,
            nickname: token,
            lastSeen: Date.now(),
            isMe: false
          })
        } else {
          member.lastSeen = Date.now()
        }
      }

      // Prune stale members (not in channel AND not seen for 3+ min)
      members.value = members.value.filter(m => {
        if (m.isMe) return true
        if (tokens.includes(m.token)) return true
        if (m.lastSeen > staleTime) return true
        return false
      })

    } catch (error) {
      console.error('Refresh members error:', error)
    }
  }

  const sendHeartbeat = async () => {
    if (!currentRoom.value || !connectionStore.isConnected) return

    try {
      const tokens = await connectionStore.wsProxyClient.listChannel(channelName.value)
      const others = tokens.filter(t => t !== connectionStore.token)

      if (others.length === 0) return

      const msg = formatMessage('HEARTBEAT', {
        nickname: connectionStore.nickname,
        roomName: currentRoom.value,
        timestamp: Date.now()
      })

      await connectionStore.sendMessage(others, msg)
    } catch (error) {
      // Silently ignore heartbeat failures
    }
  }

  const startHeartbeat = () => {
    if (heartbeatInterval) return
    heartbeatInterval = setInterval(() => {
      sendHeartbeat()
    }, 30000) // 30 seconds
  }

  const stopHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
      heartbeatInterval = null
    }
  }

  const startMemberRefresh = () => {
    if (refreshInterval) return
    // Red de seguridad — los eventos joined/left/disconnected del proxy cubren tiempo real.
    refreshInterval = setInterval(() => {
      refreshMembers()
    }, 5 * 60 * 1000) // 5 minutos
  }

  const stopMemberRefresh = () => {
    if (refreshInterval) {
      clearInterval(refreshInterval)
      refreshInterval = null
    }
  }

  const ROOM_CHANNEL_PREFIX = 'chat_room_'
  const DEFAULT_ROOMS = ['general', 'random']

  const listPublicRooms = async () => {
    try {
      // Race: el componente se monta antes de que el WS termine el handshake.
      // Esperamos hasta 3 s a que el cliente esté conectado; si no lo está,
      // hacemos no-op silencioso (el polling de 3 s lo intentará de nuevo).
      if (!connectionStore.wsProxyClient.isConnected) {
        const start = Date.now()
        while (!connectionStore.wsProxyClient.isConnected && Date.now() - start < 3000) {
          await new Promise(r => setTimeout(r, 100))
        }
        if (!connectionStore.wsProxyClient.isConnected) return
      }
      const channels = await connectionStore.wsProxyClient.listChannels({ prefix: ROOM_CHANNEL_PREFIX })

      // Mapa nombre-de-sala → count desde el servidor
      const serverRooms = new Map()
      for (const ch of channels) {
        const name = ch.name.startsWith(ROOM_CHANNEL_PREFIX)
          ? ch.name.slice(ROOM_CHANNEL_PREFIX.length)
          : ch.name
        serverRooms.set(name, ch.count)
      }

      // Asegurar salas por defecto siempre visibles
      for (const def of DEFAULT_ROOMS) {
        if (!serverRooms.has(def)) serverRooms.set(def, 0)
      }

      // Mantener la sala actual si por algún motivo no aparece (ej: somos el único)
      if (currentRoom.value && !serverRooms.has(currentRoom.value)) {
        serverRooms.set(currentRoom.value, 1)
      }

      // Reconstruir el array preservando el orden: defaults primero, luego el resto ordenado alfabéticamente
      const others = [...serverRooms.keys()]
        .filter(n => !DEFAULT_ROOMS.includes(n))
        .sort()

      rooms.value = [...DEFAULT_ROOMS, ...others].map(name => ({
        name,
        memberCount: serverRooms.get(name) ?? 0
      }))
    } catch (error) {
      console.error('List rooms error:', error)
    }
  }

  return {
    currentRoom,
    rooms,
    messages,
    members,
    isInRoom,
    channelName,
    joinRoom,
    leaveRoom,
    createRoom,
    sendChatMessage,
    handleIncomingMessage,
    handlePeerDisconnected,
    handlePeerJoined,
    handlePeerLeft,
    refreshMembers,
    listPublicRooms,
    ratePeer,
    setPeerNickname,
    getReputation,
    refreshPeerInfo,
    refreshTrustMap,
    trustMap
  }
})
