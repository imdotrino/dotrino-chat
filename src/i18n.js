// Bilingüe es/en (CONVENCIONES §9). Español neutro / tuteo, SIN voseo.
// Lenguaje llano (§9.1): contamos lo que pasa, no cómo está hecho por dentro.
//
// El idioma lo manda el <dotrino-topbar>: él lo guarda en 'dotrino.lang' y
// avisa con el evento 'dotrino-lang'. Esta app NO tiene toggle ni clave
// propios; aquí solo repetimos su misma forma de resolverlo para el primer
// render (el topbar puede no haber montado todavía).

export function detectLang () {
  try {
    const saved = localStorage.getItem('dotrino.lang')
    if (saved === 'es' || saved === 'en') return saved
  } catch (_) { /* modo privado: caemos al idioma del navegador */ }
  return (navigator.language || 'es').toLowerCase().startsWith('en') ? 'en' : 'es'
}

export const messages = {
  es: {
    status: {
      connected: 'Conectado',
      disconnected: 'Sin conexión',
      connecting: 'Conectando…',
      reconnect: 'Reconectar',
      codeLabel: 'Tu código:',
    },
    rooms: {
      title: 'Salas',
      refresh: 'Actualizar la lista de salas',
      createPlaceholder: 'Crea una sala',
      create: 'Crear sala',
      join: 'Entrar',
      nameRequired: 'Escribe un nombre para la sala',
    },
    chat: {
      backToRooms: 'Salas',
      members: (n) => `Personas (${n})`,
      leave: 'Salir',
      placeholder: 'Escribe un mensaje… (Enter para enviar, Shift+Enter para otra línea)',
      send: 'Enviar',
      empty: '👈 Elige una sala para empezar a conversar',
    },
    // Avisos de la conversación. El store guarda la clave y sus datos; el texto
    // se arma aquí, así los avisos ya escritos cambian de idioma con la app.
    system: {
      youJoined: ({ room }) => `Entraste a #${room}`,
      youLeft: ({ room }) => `Saliste de #${room}`,
      joined: ({ nickname }) => `${nickname} entró`,
      left: ({ nickname }) => `${nickname} salió`,
      disconnected: ({ nickname }) => `${nickname} se desconectó`,
      noVerifiedMembers: () => 'Nadie más en la sala puede leer tu mensaje todavía. Espera unos segundos.',
      sendFailed: () => 'No se pudo enviar tu mensaje. Inténtalo de nuevo.',
    },
    errors: {
      roomFull: ({ max }) => `La sala está llena (máximo ${max} personas). Prueba con otra.`,
      badRoomName: () => 'El nombre admite de 1 a 32 caracteres: letras minúsculas, números y guiones.',
      generic: () => 'Algo salió mal. Inténtalo de nuevo.',
    },
    nick: {
      title: 'Te damos la bienvenida a Dotrino Chat',
      subtitle: 'Elige un apodo para empezar',
      placeholder: 'Tu apodo (3 a 20 caracteres)',
      saving: 'Guardando…',
      submit: 'Entrar al chat',
      tooShort: 'El apodo necesita al menos 3 caracteres',
      tooLong: 'El apodo admite máximo 20 caracteres',
      invalid: 'Usa solo letras, números y guion bajo',
      saveFailed: 'No se pudo guardar tu apodo. Inténtalo de nuevo.',
    },
    members: {
      title: (n) => `Personas (${n})`,
      back: 'Volver al chat',
      you: '(tú)',
      tip: {
        none: 'Sin opiniones todavía — pulsa para ver más',
        mine: ({ value }) => `Tu nota: ${value}/5 — pulsa para ver más`,
        derived: ({ value, count }) =>
          `Nota de tu gente: ${value}/5 (${count} ${count === 1 ? 'opinión' : 'opiniones'}) — pulsa para ver más`,
      },
    },
    peer: {
      close: 'Cerrar',
      codeLabel: 'Código:',
      unverified: 'Todavía no sabemos quién es. Espera unos segundos…',
      nickLabel: 'Cómo quieres llamarle',
      nickPlaceholder: 'Solo tú ves este nombre',
      suspicion: ({ made, known }) =>
        `⚠ Ha preguntado por ${made} personas y solo conocías a ${known}. Ten cuidado.`,
    },
  },

  en: {
    status: {
      connected: 'Connected',
      disconnected: 'Offline',
      connecting: 'Connecting…',
      reconnect: 'Reconnect',
      codeLabel: 'Your code:',
    },
    rooms: {
      title: 'Rooms',
      refresh: 'Refresh the room list',
      createPlaceholder: 'Create a room',
      create: 'Create room',
      join: 'Join',
      nameRequired: 'Type a name for the room',
    },
    chat: {
      backToRooms: 'Rooms',
      members: (n) => `People (${n})`,
      leave: 'Leave',
      placeholder: 'Type a message… (Enter to send, Shift+Enter for a new line)',
      send: 'Send',
      empty: '👈 Pick a room to start chatting',
    },
    system: {
      youJoined: ({ room }) => `You joined #${room}`,
      youLeft: ({ room }) => `You left #${room}`,
      joined: ({ nickname }) => `${nickname} joined`,
      left: ({ nickname }) => `${nickname} left`,
      disconnected: ({ nickname }) => `${nickname} dropped off`,
      noVerifiedMembers: () => 'Nobody else in the room can read your message yet. Give it a few seconds.',
      sendFailed: () => 'Your message did not go through. Try again.',
    },
    errors: {
      roomFull: ({ max }) => `This room is full (${max} people max). Try another one.`,
      badRoomName: () => 'Names take 1 to 32 characters: lowercase letters, numbers and hyphens.',
      generic: () => 'Something went wrong. Try again.',
    },
    nick: {
      title: 'Welcome to Dotrino Chat',
      subtitle: 'Pick a nickname to get started',
      placeholder: 'Your nickname (3 to 20 characters)',
      saving: 'Saving…',
      submit: 'Join the chat',
      tooShort: 'Your nickname needs at least 3 characters',
      tooLong: 'Your nickname can be 20 characters at most',
      invalid: 'Use letters, numbers and underscore only',
      saveFailed: 'Your nickname could not be saved. Try again.',
    },
    members: {
      title: (n) => `People (${n})`,
      back: 'Back to chat',
      you: '(you)',
      tip: {
        none: 'No ratings yet — tap for details',
        mine: ({ value }) => `You rated them ${value}/5 — tap for details`,
        derived: ({ value, count }) =>
          `${value}/5 from your circle (${count} ${count === 1 ? 'opinion' : 'opinions'}) — tap for details`,
      },
    },
    peer: {
      close: 'Close',
      codeLabel: 'Code:',
      unverified: 'We do not know who this is yet. Give it a few seconds…',
      nickLabel: 'What you call them',
      nickPlaceholder: 'Only you see this name',
      suspicion: ({ made, known }) =>
        `⚠ They asked about ${made} people and you only knew ${known}. Be careful.`,
    },
  },
}

/**
 * Texto de un aviso de la conversación (`{ key, params }` del roomStore).
 * Si llegara un aviso viejo con el texto ya armado, lo respetamos.
 */
export function systemText (t, msg) {
  const fn = msg?.key && t.system[msg.key]
  return fn ? fn(msg.params || {}) : (msg?.text || '')
}

/**
 * Texto de un error del roomStore. Los errores viajan con `code` + `params`
 * (el `message` es para el log), así la UI elige el idioma.
 */
export function errorText (t, e) {
  const fn = e?.code && t.errors[e.code]
  return fn ? fn(e.params || {}) : t.errors.generic()
}
