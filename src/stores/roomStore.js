import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { samePubkey } from '@dotrino/proxy-client'
import { useConnectionStore } from './connectionStore'
import { sanitizeMessage, sanitizeNickname } from '../utils/sanitize'
import { loadHistory, persistMessage } from '../services/store'
// Identidad y reputación viven en services/ (singletons compartidos con el
// <dotrino-topbar>, que es el dueño del modal "Mi perfil").
import { getIdentity } from '../services/identity'
import { getReputation } from '../services/reputation'

/**
 * @typedef {import('../types').Room} Room
 * @typedef {import('../types').Member} Member
 * @typedef {import('../types').ChatMessage} ChatMessage
 * @typedef {import('../types').RoomMessage} RoomMessage
 * @typedef {import('../types').CodedError} CodedError
 * @typedef {import('../types').PresencePayload} PresencePayload
 * @typedef {import('../types').ChatEncPayload} ChatEncPayload
 * @typedef {import('../types').ChallengePayload} ChallengePayload
 * @typedef {import('../types').IdentifyResponsePayload} IdentifyResponsePayload
 * @typedef {import('../types').RatingQueryPayload} RatingQueryPayload
 * @typedef {import('../types').RatingReplyPayload} RatingReplyPayload
 * @typedef {import('@dotrino/identity').PeerInfo} PeerInfo
 * @typedef {import('@dotrino/identity').SignedRating} SignedRating
 * @typedef {import('@dotrino/identity').ChallengeResponse} ChallengeResponse
 */

export const useRoomStore = defineStore('room', () => {
  const connectionStore = useConnectionStore()

  // State
  const currentRoom = ref(/** @type {string | null} */ (null))
  const rooms = ref(/** @type {Room[]} */ ([
    { name: 'general', memberCount: 0 },
    { name: 'random', memberCount: 0 }
  ]))
  const messages = ref(/** @type {RoomMessage[]} */ ([]))
  const members = ref(/** @type {Member[]} */ ([]))
  // Map<pubkey, rating> de peers que yo he calificado, usado para pesar endorsements.
  const trustMap = ref(/** @type {Map<string, number>} */ (new Map()))
  const isInRoom = computed(() => !!currentRoom.value)
  const channelName = computed(() => currentRoom.value ? `chat_room_${currentRoom.value}` : null)

  /** @type {ReturnType<typeof setInterval> | null} */
  let refreshInterval = null
  /** @type {ReturnType<typeof setInterval> | null} */
  let heartbeatInterval = null

  // QUÉ ESPERA A QUÉ. Un token es una dirección del proxio y no dice de quién es, así
  // que hasta que su dueño conteste el saludo no hay a quién sellarle. Lo que iba a
  // salir para ese token se guarda aquí y sale entero en cuanto se sabe — en vez de
  // perderse o, peor, mandarse en claro «porque todavía no se sabe».
  /** @type {Map<string, string[]>} */
  const pending = new Map() // token -> [raw]
  const PENDING_MAX = 8
  // Avisos ya dados (token|code), para no repetir el mismo en cada latido.
  /** @type {Set<string>} */
  const warned = new Set()

  // Message protocol helpers
  /**
   * @param {string} type
   * @param {unknown} payload
   * @returns {string}
   */
  const formatMessage = (type, payload) => {
    return `${type}|${JSON.stringify(payload)}`
  }

  /**
   * Lo que llega es de otra punta: el payload queda sin tipar hasta que cada handler
   * lo trate como su forma (y compruebe lo que usa).
   * @param {string} raw
   * @returns {{ type: string | null, payload: unknown }}
   */
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
  /**
   * @param {string} key
   * @param {Record<string, string | number>} [params]
   * @returns {import('../types').SystemMessage}
   */
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
  /**
   * @param {string} code
   * @param {Record<string, string | number>} [params]
   * @returns {CodedError}
   */
  const roomError = (code, params) => Object.assign(new Error(code), { code, params })

  /**
   * Manda algo dirigido a varios tokens, SELLADO, y se hace cargo de lo que no salió.
   *
   *   · a quien todavía no ha dicho quién es (`no-peer-identity`) se le guarda el
   *     mensaje: el saludo está en camino y sale entero cuando llegue;
   *   · a quien no se le puede sellar por otro motivo, NO se le manda nada y se dice en
   *     la sala, una vez por motivo. Callarlo dejaría a esa persona en la lista sin
   *     recibir nada, que es exactamente el fallo mudo que el ecosistema paga caro.
   *
   * @param {string | null | Array<string | null>} tokens
   * @param {string} raw
   * @returns {Promise<{ sent: string[], failed: Array<{ token: string, code: string }> }>}
   */
  const sendSealedToPeers = async (tokens, raw) => {
    const list = /** @type {string[]} */ ((Array.isArray(tokens) ? tokens : [tokens]).filter(Boolean))
    if (!list.length) return { sent: [], failed: [] }
    const res = await connectionStore.sendMessage(list, raw)
    for (const { token, code } of res.failed) {
      if (code === 'no-peer-identity') {
        queueForToken(token, raw)
        continue
      }
      const warnKey = `${token}|${code}`
      if (warned.has(warnKey)) continue
      warned.add(warnKey)
      const member = members.value.find(m => m.token === token)
      messages.value.push(sysMessage('peerUnreachable', {
        nickname: member?.nickname || '', code
      }))
    }
    return res
  }

  /**
   * Quien se va deja de estar esperando: su token no vuelve.
   * @param {string} token
   */
  const forgetPeer = (token) => {
    pending.delete(token)
    for (const warnKey of [...warned]) if (warnKey.startsWith(token + '|')) warned.delete(warnKey)
  }

  /**
   * @param {string} token
   * @param {string} raw
   */
  const queueForToken = (token, raw) => {
    const cola = pending.get(token) || []
    // Tope: si alguien nunca contesta el saludo, su cola no puede crecer sin fin.
    if (cola.length >= PENDING_MAX) cola.shift()
    cola.push(raw)
    pending.set(token, cola)
  }

  /**
   * Ya se sabe de quién es ese token: se apunta y sale lo que estaba esperando.
   * La pubkey del saludo NO está verificada —no hace falta: mentir solo consigue que te
   * sellen a una llave que no puedes abrir—, y el reto de identidad que viene después
   * la confirma.
   *
   * @param {string} peerToken
   * @param {string} publickey
   */
  const handlePeerIdentity = (peerToken, publickey) => {
    if (!publickey || peerToken === connectionStore.token) return
    const member = members.value.find(m => m.token === peerToken)
    if (member) {
      if (!member.pubkey) member.pubkey = publickey
      member.lastSeen = Date.now()
    } else if (currentRoom.value) {
      members.value.push({
        token: peerToken,
        nickname: peerToken,
        pubkey: publickey,
        lastSeen: Date.now(),
        isMe: false
      })
    }
    // Retar a quien acaba de decir quién es: el saludo da la dirección, el reto da la
    // prueba (y con ella la llave con la que se cifra el texto del chat).
    challengePeer(peerToken)
    const cola = pending.get(peerToken)
    if (cola && cola.length) {
      pending.delete(peerToken)
      for (const raw of cola) sendSealedToPeers([peerToken], raw)
    }
  }

  // Actions
  /** @param {string} roomName */
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
        if (/** @type {CodedError | undefined} */ (e)?.code === 'roomFull') throw e
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
            type: /** @type {const} */ ('chat'),
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

      // El canal es PÚBLICO por diseño —es la lista de quién está en la sala— y por eso
      // §4.1 lo exime del sellado. Justo por eso va VACÍO: el apodo es del usuario y
      // aquí se quedaba escrito en el proxio a la vista. Lo que hace falta saber de
      // cada uno viaja sellado, y de quién es cada token lo dice el saludo.
      await connectionStore.wsProxyClient.publish(targetChannel)

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
        // PRIMERO EL SALUDO, que es lo que dice de quién es cada token; el anuncio va
        // sellado detrás. A quien todavía no haya contestado, se le guarda y sale solo
        // cuando conteste: el apodo no se manda en claro «mientras tanto».
        connectionStore.greet(others)
        await sendSealedToPeers(others, joinMsg)
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
    const channel = `chat_room_${currentRoom.value}`

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
        await sendSealedToPeers(others, leaveMsg)
      }

      // Unpublish
      await connectionStore.wsProxyClient.unpublish(channel)

      // Clean up
      stopHeartbeat()
      stopMemberRefresh()
      pending.clear()
      warned.clear()

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

  /** @param {string} roomName */
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

  /** @param {string} text */
  const sendChatMessage = async (text) => {
    if (!currentRoom.value || !connectionStore.isConnected || !text.trim()) {
      return
    }

    const trimmed = text.trim()

    try {
      // Solo destinatarios verificados (con encryptionPubkey conocida).
      // Los demás peers verán el mensaje cuando completen el handshake.
      const recipients = members.value
        .filter(/** @returns {m is Member & { token: string, encryptionPubkey: string }} */
          (m) => !m.isMe && !!m.token && !!m.encryptionPubkey)
        .map(m => ({ token: m.token, encryptionPubkey: m.encryptionPubkey }))

      if (recipients.length === 0) {
        messages.value.push(sysMessage('noVerifiedMembers'))
        return
      }

      const id = await getIdentity()
      if (!id) throw new Error('identity vault not available: cannot encrypt')

      const envelope = await id.encrypt(recipients, trimmed)

      // DOS CAPAS, y cada una hace algo distinto (no es lo que §4.1 llama «dos capas
      // abriendo el mismo sobre»: ésa es una, la del pilar, que aquí no se toca):
      //
      //   · el SOBRE DEL TRANSPORTE, que pone `sendSealedToPeers` más abajo, es lo que
      //     hace que el proxio no vea NADA — tampoco el apodo, que es lo que hasta ahora
      //     viajaba al lado del texto cifrado. Un sobre cerrado con el remitente escrito
      //     por fuera no es privacidad.
      //   · este sobre de la bóveda, cifrado con MI llave de cifrado hacia la suya,
      //     prueba además QUIÉN lo escribió: el sellado del transporte es efímero, así
      //     que cualquiera puede sellarte algo diciendo que es de otro; esto no se puede
      //     falsificar sin la privada del remitente.
      const msg = formatMessage('CHAT_ENC', {
        envelope,
        nickname: connectionStore.nickname,
        roomName: currentRoom.value,
        timestamp: Date.now()
      })

      await sendSealedToPeers(recipients.map(r => r.token), msg)

      // Echo local (el remitente nunca cifra para sí mismo)
      /** @type {ChatMessage} */
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

  /**
   * @param {string} fromToken
   * @param {string} rawMessage
   */
  const handleIncomingMessage = (fromToken, rawMessage) => {
    if (!currentRoom.value) return

    const { type, payload } = parseMessage(rawMessage)
    if (!payload) return

    switch (type) {
      case 'CHAT_ENC':
        handleEncryptedChatMessage(fromToken, /** @type {ChatEncPayload} */ (payload))
        break
      case 'JOIN_ANNOUNCE':
        handleJoinAnnounce(fromToken, /** @type {PresencePayload} */ (payload))
        break
      case 'LEAVE_ANNOUNCE':
        handleLeaveAnnounce(fromToken, /** @type {PresencePayload} */ (payload))
        break
      case 'HEARTBEAT':
        handleHeartbeat(fromToken, /** @type {PresencePayload} */ (payload))
        break
      case 'HEARTBEAT_ACK':
        handleHeartbeatAck(fromToken, /** @type {PresencePayload} */ (payload))
        break
      case 'IDENTIFY_CHALLENGE':
        handleIdentifyChallenge(fromToken, /** @type {ChallengePayload} */ (payload))
        break
      case 'IDENTIFY_RESPONSE':
        handleIdentifyResponse(fromToken, /** @type {IdentifyResponsePayload} */ (payload))
        break
      case 'RATING_QUERY':
        handleRatingQuery(fromToken, /** @type {RatingQueryPayload} */ (payload))
        break
      case 'RATING_REPLY':
        handleRatingReply(fromToken, /** @type {RatingReplyPayload} */ (payload))
        break
    }
  }

  // ---- Identity handshake -------------------------------------------------

  /** @param {string} peerToken */
  const challengePeer = async (peerToken) => {
    const id = await getIdentity()
    if (!id) return
    if (peerToken === connectionStore.token) return
    try {
      const { nonce } = await id.makeChallenge()
      const msg = formatMessage('IDENTIFY_CHALLENGE', { nonce })
      await sendSealedToPeers([peerToken], msg)
    } catch (e) {
      console.warn('challengePeer failed:', e)
    }
  }

  /**
   * @param {string} fromToken
   * @param {ChallengePayload} payload
   */
  const handleIdentifyChallenge = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.nonce) return
    try {
      const response = await id.signChallenge(payload.nonce)
      const msg = formatMessage('IDENTIFY_RESPONSE', response)
      await sendSealedToPeers([fromToken], msg)
    } catch (e) {
      console.warn('signChallenge failed:', e)
    }
  }

  /**
   * @param {string} fromToken
   * @param {IdentifyResponsePayload} payload
   */
  const handleIdentifyResponse = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.publickey) return
    try {
      // La bóveda comprueba nonce y firma: si faltan, la verificación no da `ok`.
      const result = await id.verifyResponse(/** @type {ChallengeResponse} */ (payload))
      if (!result.ok || !result.publickey) return
      const member = members.value.find(m => m.token === fromToken)
      // EL SALUDO NO ESTÁ FIRMADO; ESTO SÍ. Si dijo ser uno y prueba ser otro, no es un
      // desajuste que arreglar: es alguien intentando que le sellemos lo de otro. Se
      // descarta y se dice, en vez de quedarnos con el último que habló.
      if (member?.pubkey && !samePubkey(member.pubkey, result.publickey)) {
        console.warn(`[chat] ${fromToken} greeted as one identity and proved another`)
        members.value = members.value.filter(m => m.token !== fromToken)
        return
      }
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
   *
   * @param {string} subjectPubkey
   * @param {string} excludeToken
   */
  const requestRatingsForSubject = (subjectPubkey, excludeToken) => {
    if (!subjectPubkey) return
    const targets = members.value
      .filter(m => !m.isMe && m.token !== excludeToken && m.pubkey)
      .map(m => m.token)
    if (targets.length === 0) return
    const queryId = crypto.randomUUID()
    const msg = formatMessage('RATING_QUERY', { queryId, subject: subjectPubkey })
    sendSealedToPeers(targets, msg)
  }

  /**
   * @param {string} fromToken
   * @param {RatingQueryPayload} payload
   */
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
      await sendSealedToPeers([fromToken], reply)
    } catch (e) {
      console.warn('handleRatingQuery failed:', e)
    }
  }

  /**
   * @param {string} fromToken
   * @param {RatingReplyPayload} payload
   */
  const handleRatingReply = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.subject || !Array.isArray(payload?.endorsements)) return
    const fromMember = members.value.find(m => m.token === fromToken)
    const askerPubkey = fromMember?.pubkey || null
    try {
      /** @type {SignedRating[]} */
      const all = []
      if (payload.mine && payload.mine.subject === payload.subject) {
        all.push(payload.mine)
      }
      for (const e of payload.endorsements) {
        if (e && e.subject === payload.subject) all.push(e)
      }
      if (all.length === 0) return
      await id.mergeEndorsements(payload.subject, all, askerPubkey ?? undefined)
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

  /**
   * Set a rating for a peer and refresh local cache.
   * @param {string} pubkey
   * @param {number} rating
   * @param {string} [notes]
   * @returns {Promise<PeerInfo>}
   */
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

  /**
   * Set a custom nickname for a peer.
   * @param {string} pubkey
   * @param {string} nickname
   * @returns {Promise<PeerInfo>}
   */
  const setPeerNickname = async (pubkey, nickname) => {
    const id = await getIdentity()
    if (!id) throw new Error('Identity vault not available')
    const updated = await id.setNickname(pubkey, nickname)
    for (const m of members.value) {
      if (m.pubkey === pubkey) m.peer = updated
    }
    return updated
  }

  /**
   * @param {string} fromToken
   * @param {ChatEncPayload} payload
   */
  const handleEncryptedChatMessage = async (fromToken, payload) => {
    if (!payload?.envelope) return
    if (payload.roomName && payload.roomName !== currentRoom.value) return

    const id = await getIdentity()
    if (!id) {
      console.warn('identity vault not available: cannot decrypt the message')
      return
    }

    const sender = members.value.find(m => m.token === fromToken)
    const senderEncryptionPubkey = sender?.encryptionPubkey
    if (!senderEncryptionPubkey) {
      console.warn(`no encryptionPubkey for ${fromToken}: cannot decrypt`)
      return
    }

    let plaintext
    try {
      const myToken = connectionStore.token
      if (!myToken) throw new Error('not connected: no token to decrypt for')
      const result = await id.decrypt(senderEncryptionPubkey, myToken, payload.envelope)
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

    /** @type {ChatMessage} */
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

  /**
   * @param {string} fromToken
   * @param {PresencePayload} payload
   */
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
    sendSealedToPeers([fromToken], heartbeatMsg)
  }

  /**
   * @param {string} peerToken
   * @param {string} [channel]
   */
  const handlePeerDisconnected = (peerToken, channel) => {
    if (!currentRoom.value) return
    // Si vino con canal, ignorar si no es el de esta sala
    if (channel && channel !== channelName.value) return

    const member = members.value.find(m => m.token === peerToken)
    if (!member) return

    members.value = members.value.filter(m => m.token !== peerToken)
    forgetPeer(peerToken)

    messages.value.push(sysMessage('disconnected', { nickname: member.nickname }))
  }

  /**
   * @param {string} peerToken
   * @param {string} [channel]
   */
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

    // El saludo del transporte primero: hasta saber de quién es ese token no hay a
    // quién sellarle, y el apodo no sale en claro por ir antes.
    connectionStore.greet(peerToken)

    // Y el HEARTBEAT_ACK, para que aprenda nuestro apodo sin esperar al primer latido
    // (30 s) ni al JOIN_ANNOUNCE. Si todavía no ha contestado el saludo, se guarda.
    const ackMsg = formatMessage('HEARTBEAT_ACK', {
      nickname: connectionStore.nickname,
      roomName: currentRoom.value,
      timestamp: Date.now()
    })
    sendSealedToPeers([peerToken], ackMsg)
  }

  /**
   * @param {string} peerToken
   * @param {string} [channel]
   */
  const handlePeerLeft = (peerToken, channel) => {
    if (!currentRoom.value) return
    if (channel !== channelName.value) return

    const member = members.value.find(m => m.token === peerToken)
    if (!member) return

    members.value = members.value.filter(m => m.token !== peerToken)
    forgetPeer(peerToken)

    messages.value.push(sysMessage('left', { nickname: member.nickname }))
  }

  /**
   * @param {string} fromToken
   * @param {PresencePayload} payload
   */
  const handleLeaveAnnounce = (fromToken, payload) => {
    if (payload.roomName !== currentRoom.value) return

    const sanitizedNickname = sanitizeNickname(payload.nickname)

    // Remove member
    members.value = members.value.filter(m => m.token !== fromToken)

    // System message
    messages.value.push(sysMessage('left', { nickname: sanitizedNickname }))
  }

  /**
   * @param {string} fromToken
   * @param {PresencePayload} payload
   */
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

  /**
   * @param {string} fromToken
   * @param {PresencePayload} payload
   */
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
        // A quien no ha dicho todavía de quién es su token, se le saluda: sin eso no se
        // le puede sellar nada y se quedaría en la lista sin recibir ni mandar.
        if (!connectionStore.wsProxyClient.pubkeyOfToken(token)) connectionStore.greet(token)
      }

      // Prune stale members (not in channel AND not seen for 3+ min)
      members.value = members.value.filter(m => {
        if (m.isMe) return true
        if (m.token && tokens.includes(m.token)) return true
        if (m.lastSeen > staleTime) return true
        return false
      })

    } catch (error) {
      console.error('Refresh members error:', error)
    }
  }

  const sendHeartbeat = async () => {
    if (!currentRoom.value || !connectionStore.isConnected) return
    const channel = `chat_room_${currentRoom.value}`

    try {
      const tokens = await connectionStore.wsProxyClient.listChannel(channel)
      const others = tokens.filter(t => t !== connectionStore.token)

      if (others.length === 0) return

      const msg = formatMessage('HEARTBEAT', {
        nickname: connectionStore.nickname,
        roomName: currentRoom.value,
        timestamp: Date.now()
      })

      await sendSealedToPeers(others, msg)
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
    handlePeerIdentity,
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
