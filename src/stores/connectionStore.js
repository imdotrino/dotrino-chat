import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getWebSocketProxyClient, identitySealing } from '@dotrino/proxy-client'
import { Identity } from '@dotrino/identity'
import { sanitizeNickname } from '../utils/sanitize'
import { getIdentity } from '../services/identity'

export const useConnectionStore = defineStore('connection', () => {
  // Get singleton WebSocket client
  const wsProxyClient = getWebSocketProxyClient()

  // State
  const token = ref(null)
  // La CITA: el código corto que sí se le puede enseñar a una persona (6
  // caracteres, caduca en minutos, un solo uso). `token` es la instancia con la
  // que se rutea internamente y no se muestra.
  const pairingCode = ref(null)
  let pairingTimer = null
  const isConnected = ref(false)
  const connectionError = ref(null)
  const wsUrl = ref(import.meta.env.VITE_WS_URL || 'wss://proxy.dotrino.com')
  // El nickname vive ÚNICAMENTE en el vault de identidad (id.dotrino.com). No
  // hay copia paralela en localStorage: la identidad es la única fuente de
  // verdad. Este ref es solo el espejo reactivo de `id.me.nickname`.
  const nickname = ref('')
  const nicknameSet = computed(() => nickname.value.trim().length > 0)
  // Mientras intentamos hidratar el nickname desde el vault no decidimos si
  // mostrar el NicknameModal (evita el flash del modal en el primer frame).
  const nicknameHydrated = ref(false)

  let handlersSetup = false

  // Actions
  /**
   * Conecta al transporte del ecosistema con el SELLADO PUESTO (CONVENCIONES §4.1).
   *
   * El proxio enruta pero no cifra. Hasta ahora todo lo dirigido —el apodo, quién entra
   * y sale, los latidos, y hasta las notas de calificación con el pubkey del calificado—
   * viajaba legible para quien opera el servidor. Ahora:
   *
   *   · `requireSealed: true` corta en las DOS direcciones: ni manda ni acepta nada
   *     dirigido en claro. Sellar solo de salida no sirve de nada — quien acepta texto
   *     plano se salta el sellado entero, y quien nunca leyó nada podría contestar sin
   *     sellar y colar un payload falso.
   *   · `myEncPub` es mi llave de cifrado; `identify` la anuncia sola, firmada, para que
   *     cualquiera que sepa mi pubkey pueda sellarme sin habernos emparejado nunca.
   *   · `sealing` es el puente de la bóveda: la llave privada NO está en la app, vive
   *     dentro del iframe de id.dotrino.com. El puente es del pilar, no de aquí.
   *
   * SIN BÓVEDA NO SE CONECTA. No hay con qué sellar ni con qué abrir, y hablar en claro
   * «mientras tanto» es justo el agujero que esto cierra.
   */
  const connect = async () => {
    try {
      connectionError.value = null

      const id = await getIdentity()
      if (!id) {
        isConnected.value = false
        connectionError.value = 'no-identity'
        return
      }

      wsProxyClient.updateConfig({
        url: wsUrl.value,
        requireSealed: true,
        myEncPub: await id.getEncryptionPubkey(),
        sealing: identitySealing(id, { app: 'dotrino-chat' }),
      })

      // Registrar handlers ANTES de connect para no perder el primer
      // evento 'token' que el lib emite al recibir el frame `connected`.
      if (!handlersSetup) {
        setupProxyEventHandlers()
        handlersSetup = true
      }

      const assignedToken = await wsProxyClient.connect()

      // Defensa extra por si alguna implementación futura emite token antes
      // del registro (no debería pasar con el orden de arriba).
      if (assignedToken && !token.value) token.value = assignedToken

      // La identidad de red es la de la bóveda (CLAUDE.md): así la del cable coincide
      // con la que firma, se habilita la cola offline y —lo que hace falta aquí— el
      // anuncio de la llave de cifrado sale firmado por quien dice ser.
      await wsProxyClient.identifyAs({
        publickey: id.me.publickey,
        sign: (data) => id.signData(data),
      })

      isConnected.value = true
    } catch (error) {
      connectionError.value = error.message
      isConnected.value = false
      console.error('Connection error:', error)
    }
  }

  const disconnect = () => {
    wsProxyClient.disconnect()
    isConnected.value = false
    token.value = null
  }

  // Guarda el nickname en el vault de identidad (única fuente de verdad). El ref
  // local se actualiza solo tras confirmar la escritura en el vault, para que no
  // exista nunca un nick "de chat" desincronizado de la identidad. Lanza si el
  // vault no está disponible: sin identidad no hay nickname.
  const setNickname = async (name) => {
    const clean = sanitizeNickname((name || '').trim())
    if (!clean) throw new Error('Nickname vacío')
    const id = await Identity.connect()
    try { await id?.ready?.() } catch (_) {}
    if (!id?.setMyNickname) throw new Error('Vault de identidad no disponible')
    await id.setMyNickname(clean)
    nickname.value = sanitizeNickname(id.me?.nickname || clean)
  }

  // Hidrata el nickname desde el vault al arrancar. La identidad es la ÚNICA
  // fuente: si trae nickname lo reflejamos; si no, queda vacío y la app exigirá
  // definirlo (NicknameModal) antes de cualquier acción.
  const hydrateNicknameFromVault = async () => {
    try {
      const id = await Identity.connect()
      // Garantizar que el handshake con el vault terminó antes de leer `me`:
      // si otro caller creó el singleton, connect() puede devolverlo con `me`
      // aún en null (carrera). ready() es idempotente.
      try { await id?.ready?.() } catch (_) {}
      let vaultNick = sanitizeNickname(id?.me?.nickname || '')
      if (!vaultNick) {
        // Migración única: el chat viejo guardaba el nick solo en
        // localStorage('chat_nickname'), nunca en el vault. Si existe ese nick
        // legado y el vault no lo tiene, lo subimos al vault (única fuente) y
        // borramos la copia local — así los usuarios existentes no tienen que
        // volver a teclearlo. Si el vault no responde, dejamos el legado para
        // reintentar en el próximo arranque.
        const legacy = sanitizeNickname(localStorage.getItem('chat_nickname') || '')
        if (legacy && id?.setMyNickname) {
          try {
            await id.setMyNickname(legacy)
            vaultNick = sanitizeNickname(id.me?.nickname || legacy)
            localStorage.removeItem('chat_nickname')
          } catch (e) {
            console.warn('Migración de nick legado al vault falló (reintenta luego):', e?.message || e)
          }
        }
      }
      nickname.value = vaultNick
    } catch (e) {
      console.warn('Vault no disponible para hidratar nickname:', e?.message || e)
    } finally {
      nicknameHydrated.value = true
    }
  }

  /**
   * Manda un mensaje dirigido SELLADO, uno por destinatario.
   *
   * Una envoltura por cabeza y no una para todos: cada identidad tiene su llave de
   * cifrado, así que un solo sobre solo lo abriría uno.
   *
   * NO LANZA POR UN DESTINATARIO SUELTO, y no se lo traga: devuelve a quién no se le
   * pudo mandar y por qué (`code`), para que la sala lo diga en pantalla. Lo que no
   * hace nunca es mandarlo en claro: si no se puede sellar, no sale.
   *
   * @returns {Promise<{ sent: string[], failed: Array<{token:string, code:string}> }>}
   */
  const sendMessage = async (toTokens, rawMessage) => {
    const tokens = Array.isArray(toTokens) ? toTokens : [toTokens]
    const sent = []
    const failed = []
    await Promise.all(tokens.map(async (t) => {
      const peerPubkey = wsProxyClient.pubkeyOfToken(t)
      if (!peerPubkey) {
        failed.push({ token: t, code: 'no-peer-identity' })
        return
      }
      try {
        await wsProxyClient.sendSealedTo(t, rawMessage, { peerPubkey })
        sent.push(t)
      } catch (error) {
        // Por `code`, nunca por la frase: `no-encpub` (no ha publicado con qué sellarle),
        // `encpub-unverified` (llegó una llave que esa identidad no firmó) y
        // `no-encpub-support` (el proxio es viejo) se arreglan de formas distintas.
        failed.push({ token: t, code: error?.code || 'unknown' })
        console.warn(`[chat] cannot seal to ${t}: ${error?.code || error?.message}`)
      }
    }))
    return { sent, failed }
  }

  /** Saludar a un token para saber de quién es: sin eso no hay a quién sellarle. */
  const greet = (tokens) => {
    const list = (Array.isArray(tokens) ? tokens : [tokens]).filter((t) => t && t !== token.value)
    if (!list.length) return
    try {
      wsProxyClient.helloTo(list)
    } catch (error) {
      console.warn('[chat] greeting failed:', error?.code || error?.message)
    }
  }

  /**
   * Pide una cita al proxio y la renueva sola antes de que caduque.
   * Si el proxio es viejo y no las conoce, se queda en null y la UI no muestra
   * código — mejor eso que enseñar una instancia de 24 caracteres como si fuera
   * algo que una persona puede dictar.
   */
  const refreshPairingCode = async () => {
    if (pairingTimer) { clearTimeout(pairingTimer); pairingTimer = null }
    try {
      const res = await wsProxyClient.requestPairingCode()
      pairingCode.value = res?.code || null
      const left = (res?.expiresAt || 0) - Date.now()
      if (left > 10000) {
        pairingTimer = setTimeout(refreshPairingCode, left - 5000)
      }
    } catch (_) {
      pairingCode.value = null
    }
  }

  const setupProxyEventHandlers = () => {
    wsProxyClient.on('token', (assignedToken) => {
      token.value = assignedToken
      // El identificador de conexión dejó de ser un código de 4 caracteres: hoy
      // es una instancia larga, cualificada por proxio, que no se le enseña a
      // nadie. Para mostrar (y compartir) hay que pedir una CITA, que es corta,
      // caduca en minutos y se quema al usarse.
      refreshPairingCode()
    })

    wsProxyClient.on('connect', () => {
      isConnected.value = true
      connectionError.value = null
    })

    wsProxyClient.on('disconnect', () => {
      isConnected.value = false
      token.value = null
      pairingCode.value = null
    })

    wsProxyClient.on('error', (error) => {
      connectionError.value = error.error || error.message || 'Unknown error'
      console.error('WebSocket error:', error)
    })

    wsProxyClient.on('message', (fromToken, payload, meta) => {
      // EL PILAR ES EL ÚNICO QUE ABRE EL SOBRE (§4.1): si abrieran los dos, el primero
      // que llega sin la llave lo descarta y el otro nunca ve nada. Aquí solo se
      // comprueba que VENÍA sellado.
      if (!meta?.sealed) {
        console.warn('[chat] dropped a directed message that was not sealed')
        return
      }
      // payload may be a parsed object or string. roomStore expects the raw string.
      const raw = typeof payload === 'string' ? payload : JSON.stringify(payload)
      // Lazy import to avoid circular dependency
      import('./roomStore.js').then(mod => {
        const roomStore = mod.useRoomStore()
        roomStore.handleIncomingMessage(fromToken, raw)
      }).catch(() => {})
    })

    // «Este token es de esta identidad». Lo dice el saludo del transporte, no un mensaje
    // de la app: el token es una dirección del proxio y no dice de quién es.
    wsProxyClient.on('peer_identity', (peerToken, publickey) => {
      import('./roomStore.js').then(mod => {
        const roomStore = mod.useRoomStore()
        roomStore.handlePeerIdentity(peerToken, publickey)
      }).catch(() => {})
    })

    wsProxyClient.on('peer_disconnected', (peerToken, channel) => {
      import('./roomStore.js').then(mod => {
        const roomStore = mod.useRoomStore()
        roomStore.handlePeerDisconnected(peerToken, channel)
      }).catch(() => {})
    })

    wsProxyClient.on('channel_joined', (channel, peerToken) => {
      import('./roomStore.js').then(mod => {
        const roomStore = mod.useRoomStore()
        roomStore.handlePeerJoined(peerToken, channel)
      }).catch(() => {})
    })

    wsProxyClient.on('channel_left', (channel, peerToken) => {
      import('./roomStore.js').then(mod => {
        const roomStore = mod.useRoomStore()
        roomStore.handlePeerLeft(peerToken, channel)
      }).catch(() => {})
    })

    wsProxyClient.on('reconnecting', (attempt, maxAttempts) => {
      console.log(`Reconnecting... (${attempt}/${maxAttempts})`)
    })

    wsProxyClient.on('reconnect_failed', (attempts) => {
      connectionError.value = `Failed to reconnect after ${attempts} attempts`
    })
  }

  // Export public API
  return {
    token,
    pairingCode,
    refreshPairingCode,
    isConnected,
    connectionError,
    wsUrl,
    nickname,
    nicknameSet,
    nicknameHydrated,
    connect,
    disconnect,
    setNickname,
    hydrateNicknameFromVault,
    sendMessage,
    greet,
    wsProxyClient
  }
})
