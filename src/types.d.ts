// Formas de datos del chat que se repiten entre stores, servicios y vistas.

import type { EnvelopeV1, PeerInfo, SignedRating, ChallengeResponse } from '@dotrino/identity'

/** Una sala de la lista (directorio público del proxio). */
export interface Room {
  name: string
  memberCount: number
}

/** Alguien en la sala actual (yo incluido, con `isMe`). */
export interface Member {
  /** Dirección del proxio. La mía puede ser null mientras no hay conexión. */
  token: string | null
  nickname: string
  /** Pubkey de firma: la dice el saludo y la confirma el reto. */
  pubkey?: string
  /** Llave de cifrado verificada por el reto; sin ella no se le cifra el texto. */
  encryptionPubkey?: string | null
  /** Lo que mi bóveda sabe de esa identidad (calificación, apodo propio). */
  peer?: PeerInfo | null
  lastSeen: number
  isMe: boolean
}

/** Un mensaje de chat ya en claro en este cliente. */
export interface ChatMessage {
  id: string
  from: string | null
  nickname: string
  type: 'chat'
  text: string
  timestamp: number
  isMe: boolean
  /** Viene del historial persistido, no de esta sesión. */
  historic?: boolean
}

/** Aviso de la conversación: la vista lo traduce por `key` (src/i18n.js). */
export interface SystemMessage {
  id: string
  from: 'system'
  type: 'system'
  key: string
  params?: Record<string, string | number>
  timestamp: number
}

export type RoomMessage = ChatMessage | SystemMessage

/** Error con código estable; el texto de cara al usuario lo pone la vista. */
export interface CodedError extends Error {
  code?: string
  params?: Record<string, string | number>
}

// ---- Protocolo entre peers (`TIPO|json`, siempre sellado por el transporte) ----
// Lo que llega es de otra punta: cada handler comprueba lo que usa.

export interface PresencePayload {
  nickname?: string
  roomName?: string
  timestamp?: number
}

export interface ChatEncPayload extends PresencePayload {
  envelope?: EnvelopeV1
}

export interface ChallengePayload {
  nonce?: string
}

export type IdentifyResponsePayload = Partial<ChallengeResponse>

export interface RatingQueryPayload {
  queryId?: string
  subject?: string
}

export interface RatingReplyPayload extends RatingQueryPayload {
  mine?: SignedRating | null
  endorsements?: SignedRating[]
}

// ---- Textos de la UI (src/i18n.js) ----

export type Lang = 'es' | 'en'

/** Datos de un aviso o de un error: la clave dice cuáles lleva. */
export type MsgParams = Record<string, string | number | undefined>
export type MsgFn = (params: MsgParams) => string

export interface Messages {
  status: {
    connected: string
    disconnected: string
    connecting: string
    reconnect: string
    codeLabel: string
    noIdentity: string
  }
  rooms: {
    title: string
    refresh: string
    createPlaceholder: string
    create: string
    join: string
    nameRequired: string
  }
  chat: {
    backToRooms: string
    members: (n: number) => string
    leave: string
    placeholder: string
    send: string
    empty: string
  }
  system: Record<string, MsgFn>
  errors: Record<string, MsgFn> & { generic: () => string }
  nick: {
    title: string
    subtitle: string
    placeholder: string
    saving: string
    submit: string
    tooShort: string
    tooLong: string
    invalid: string
    saveFailed: string
  }
  members: {
    title: (n: number) => string
    back: string
    you: string
    tip: {
      none: string
      mine: MsgFn
      derived: MsgFn
    }
  }
  peer: {
    close: string
    codeLabel: string
    unverified: string
    nickLabel: string
    nickPlaceholder: string
    suspicion: MsgFn
  }
}

declare global {
  interface Window {
    /** Asidero de las pruebas de punta a punta (src/main.js). */
    dotrinoChat?: {
      readonly connection: ReturnType<typeof import('./stores/connectionStore').useConnectionStore>
      readonly room: ReturnType<typeof import('./stores/roomStore').useRoomStore>
      readonly client: import('@dotrino/proxy-client').WebSocketProxyClient
    }
  }
}
