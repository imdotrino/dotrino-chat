import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getWebSocketProxyClient } from '@dotrino/proxy-client'
import { Identity } from '@dotrino/identity'
import { sanitizeNickname } from '../utils/sanitize'

export const useConnectionStore = defineStore('connection', () => {
  // Get singleton WebSocket client
  const wsProxyClient = getWebSocketProxyClient()

  // State
  const token = ref(null)
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
  const connect = async () => {
    try {
      connectionError.value = null
      wsProxyClient.updateConfig({ url: wsUrl.value })

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

  const sendMessage = async (toTokens, rawMessage) => {
    try {
      await wsProxyClient.send(toTokens, rawMessage)
    } catch (error) {
      console.error('Send error:', error)
      throw error
    }
  }

  const setupProxyEventHandlers = () => {
    wsProxyClient.on('token', (assignedToken) => {
      token.value = assignedToken
    })

    wsProxyClient.on('connect', () => {
      isConnected.value = true
      connectionError.value = null
    })

    wsProxyClient.on('disconnect', () => {
      isConnected.value = false
      token.value = null
    })

    wsProxyClient.on('error', (error) => {
      connectionError.value = error.error || error.message || 'Unknown error'
      console.error('WebSocket error:', error)
    })

    wsProxyClient.on('message', (fromToken, payload) => {
      // payload may be a parsed object or string. roomStore expects the raw string.
      const raw = typeof payload === 'string' ? payload : JSON.stringify(payload)
      // Lazy import to avoid circular dependency
      import('./roomStore.js').then(mod => {
        const roomStore = mod.useRoomStore()
        roomStore.handleIncomingMessage(fromToken, raw)
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
    wsProxyClient
  }
})
