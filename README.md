# Dotrino Chat

> **Parte del ecosistema [Dotrino](https://dotrino.com).** Misión: aplicaciones que resuelven problemas comunes, respetando tu privacidad — sin anuncios, sin cookies, sin rastreo de datos, sin vender tu identidad a nadie.

## Filosofía

El eje del ecosistema **[Dotrino](https://dotrino.com)** es el **autohosteo** y el **control sobre la propia información**: qué comparto, cómo lo comparto y cuándo lo comparto.

### Manifiesto

> **Tu información, en tu servidor, bajo tus reglas.**
> Dotrino nace de una idea simple: lo que es tuyo, se queda contigo. Tú decides **qué** compartes, **cómo** lo compartes y **cuándo** lo compartes. Sin intermediarios, sin nubes ajenas, sin letra pequeña.
>
> Cada aplicación del ecosistema Dotrino vive donde tú quieras: tu propio servidor, tu propia infraestructura. Tus datos no viajan a empresas que los monetizan. Tú eres el dueño y el administrador. Compartes solo lo que eliges, con quien eliges, durante el tiempo que eliges.

### Tres pilares

> - **Qué comparto:** solo la información que decido exponer, nada más.
> - **Cómo lo comparto:** con el formato, el acceso y las condiciones que yo defino.
> - **Cuándo lo comparto:** en el momento que quiero, y lo retiro cuando quiero.
>
> Todo sobre infraestructura que tú controlas. Eso es autohosteo. Eso es soberanía digital.

---

Aplicación de chat multi-sala P2P-mesh sobre el proxy WebSocket de Dotrino. Vue 3 + Vite + Pinia.

🌐 Producción: **https://dotrino.github.io/simple-websocket-chat/**

## Características

- **Salas públicas** auto-descubiertas a través de `list_channels` con prefijo.
- **Sin host por sala**: todos los miembros son peers iguales, publicados en `chat_room_<nombre>`.
- **Real-time**: el proxy emite `joined` / `left` / `disconnected` a los miembros del canal.
- **Identidad cross-app** vía vault (mismo keypair en chat, chess, etc.).
- **End-to-end encryption** por destinatario: cada mensaje viaja como envelope ECDH(P-256) + AES-256-GCM. El proxy nunca ve plaintext.
- **Reputación firmada** con web of trust: ratings firmados con ECDSA P-256 que se intercambian automáticamente entre peers de una sala.
- **Cap de 20 personas por sala**: límite enforce en cliente (UX y CPU al hacer 19+ handshakes); el proxy mantiene su cap de 100 como fallback.
- **Mobile responsive** con vistas single-pane intercambiables (rooms / chat / members).
- **Tema claro/oscuro** según preferencia del sistema.

## Stack y dependencias

```jsonc
{
  "@dotrino/proxy-client": "^0.2.0",
  "@dotrino/identity":     "^0.5.0",
  "vue": "^3", "pinia": "^3"
}
```

Las dos primeras son las librerías de Dotrino publicadas en npm. Ver su documentación para detalles.

## Desarrollo

```bash
npm install
npm run dev          # http://localhost:5173/simple-websocket-chat/
npm run build        # genera dist/
```

`.env`:

```
VITE_WS_URL=wss://proxy.dotrino.com   # default si no se setea
```

Para apuntar a un proxy local: `VITE_WS_URL=ws://localhost:4001`.

## Arquitectura

### Stores (Pinia)

- **`connectionStore`** — conexión al proxy, token corto, nickname local. Wrapper sobre `getWebSocketProxyClient()`.
- **`roomStore`** — estado de la sala actual: mensajes, miembros, handshake de identidad, intercambio de reputación. Map reactivo `trustMap` (mis ratings emitidos) para pesar endorsements.

### Protocolo de mensajes

Wire format: `TYPE|JSON_PAYLOAD` viajando como `message` dentro del envelope del proxy.

| Type | Dirección | Propósito |
|------|-----------|-----------|
| `CHAT_ENC` | peer → peers verificados | Mensaje cifrado E2E (envelope `{iv, ct, wrap}`) |
| `CHAT_MSG` | (legacy) | Solo se acepta; nunca se emite. |
| `JOIN_ANNOUNCE` | newcomer → existing | "Acabo de entrar" |
| `LEAVE_ANNOUNCE` | leaver → peers | "Me voy" |
| `HEARTBEAT` / `HEARTBEAT_ACK` | all → all | Mantener visibilidad |
| `IDENTIFY_CHALLENGE` | a un peer | Reto firmado para verificar identidad |
| `IDENTIFY_RESPONSE` | reply | Firma + pubkey + **encryptionPubkey** |
| `RATING_QUERY` | broadcast en sala | "¿qué saben de este pubkey?" |
| `RATING_REPLY` | reply | Mi rating + endorsements firmadas |

### End-to-end encryption

Tras `IDENTIFY_RESPONSE` cada miembro guarda el `encryptionPubkey` ECDH del peer. Al enviar un mensaje:

1. El emisor genera una clave AES-256-GCM efímera `k` y un IV.
2. Cifra el plaintext con `k` (un solo `ciphertext`).
3. Para cada destinatario verificado, deriva `ECDH(myPriv, peerEncPub)` y envuelve `k` con esa clave (segundo AES-GCM con IV propio).
4. Emite `CHAT_ENC|{ envelope: {v:1, iv, ct, wrap}, nickname, roomName, ts }` al proxy con `to: [tokens verificados]`.

El receptor:

1. Toma `wrap[myToken]` para extraer su copia envuelta de `k`.
2. Deriva `ECDH(myPriv, senderEncPub)` y descifra `k`.
3. Descifra `ct` con `k` → plaintext.

Forward-secrecy a nivel de mensaje (cada `k` es nueva). Miembros sin handshake completo (`encryptionPubkey` ausente) son omitidos del `wrap`; recibirán mensajes futuros una vez verificados.

### Web of trust

1. Tras unirse a una sala, cada peer recibe `JOIN_ANNOUNCE` y dispara un `IDENTIFY_CHALLENGE` al recién llegado.
2. El recién llegado responde con `IDENTIFY_RESPONSE` (firmado por su llave privada en el vault). El peer verifica.
3. Una vez verificado el pubkey, el peer dispara `RATING_QUERY` al resto del cuarto.
4. Cada respuesta trae `mine` (rating propio firmado) + `endorsements` (ratings firmados de terceros que ese peer haya recolectado).
5. El vault verifica todas las firmas, dedupea por `(ratedBy, subject)`, y guarda hasta 50 endorsements por subject.
6. **Display**: rating propio = ★ amarillo. Si no hay propio, se computa promedio ponderado donde el peso de cada endorser es `miRating(endorser) / 5`. Endorsers no calificados → peso 0 → ignorados. Resultado = ★ azul (derivado).

### Componentes

- `NicknameModal` — gate inicial.
- `ConnectionStatus` — header con dot de conexión, token, `@nickname` (click → `UserSettingsModal`).
- `UserSettingsModal` — editar nickname, ver pubkey, exportar/importar identidad (JSON).
- `RoomList` — sidebar de salas, crear/refrescar.
- `ChatRoom` — área central: mensajes, input.
- `MemberList` — sidebar de miembros con badge de rating; hover muestra rating, click abre `PeerRatingModal`.
- `PeerRatingModal` — calificación 0–5, notas, lista de endorsements firmadas (filtradas a peers que tú calificas), suspicion modifier.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) publica `dist/` en GitHub Pages al hacer push a `main`.

## Troubleshooting

| Síntoma | Diagnóstico |
|---------|-------------|
| "WebSocket not connected" | Verifica `wss://proxy.dotrino.com` desde DevTools → Network. |
| Identity vault unreachable | El vault vive en `id.dotrino.com`. Requiere HTTPS para `crypto.subtle`. |
| No aparece rating al hover | El handshake aún no completó (puede tardar ~1s). |
| "No puedes enviarte mensajes a ti mismo" | Bug menor que aparece a veces al refrescar — los mensajes siguen funcionando. |

## Licencia

MIT
