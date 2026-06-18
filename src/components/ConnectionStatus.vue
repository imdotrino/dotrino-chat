<template>
  <div class="connection-status">
    <div class="status-left">
      <dotrino-back class="cc-back"></dotrino-back>
      <h1>💬 Dotrino Chat</h1>
    </div>

    <div class="status-center">
      <div class="status-indicator" :class="statusClass">
        <span class="dot"></span>
        {{ statusText }}
      </div>
    </div>

    <div class="status-right">
      <div v-if="connectionStore.token" class="token-display">
        <span class="label">Token:</span>
        <span class="token">{{ connectionStore.token }}</span>
      </div>

      <button
        v-if="!connectionStore.isConnected"
        @click="reconnect"
        class="small"
      >
        Reconnect
      </button>

      <button class="profile-btn" data-testid="my-profile" @click="openMyProfile" title="Mi perfil" aria-label="Mi perfil">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
        </svg>
      </button>

      <dotrino-support href="https://ko-fi.com/dotrino" repo="imdotrino/dotrino-chat" discord="https://discord.gg/D648uq7cth"></dotrino-support>
    </div>

    <!-- Mi perfil (botón del header, a la izquierda de la moneda): mismo Web
         Component compartido en modo self con mi identidad del vault. -->
    <dotrino-profile
      v-if="myProfilePk"
      :ref="bindMyProfile"
      modal
      mode="self"
      :style="profileTheme"
      :pubkey="myProfilePk"
      :name="connectionStore.nickname || ''"
      @cc-profile-close="myProfilePk = null"
    ></dotrino-profile>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useConnectionStore } from '../stores/connectionStore'
import { useRoomStore } from '../stores/roomStore'
import '@dotrino/profile'
import { useBackLayer } from '@dotrino/nav/vue'

const connectionStore = useConnectionStore()
const roomStore = useRoomStore()

// "Mi perfil": botón del header (a la izquierda de la moneda de soporte) que abre
// el MISMO Web Component compartido en modo self con mi identidad del vault.
const myProfilePk = ref(null)
async function openMyProfile () {
  const pk = await roomStore.getMyPubkey()
  if (pk) myProfilePk.value = pk
}
function bindMyProfile (el) {
  if (!el) return
  roomStore.getProfileProvider().then((p) => { if (p) el.provider = p })
}
useBackLayer(myProfilePk, { onClose: () => { myProfilePk.value = null } })
const profileTheme = {
  '--ccp-bg': 'var(--color-card-bg)', '--ccp-bg-2': 'var(--color-surface)',
  '--ccp-bg-3': 'var(--color-surface-variant)', '--ccp-bg-4': 'var(--color-border-light)',
  '--ccp-border': 'var(--color-border)', '--ccp-text': 'var(--color-text)',
  '--ccp-muted': 'var(--color-text-secondary)', '--ccp-accent': 'var(--color-primary)',
  '--ccp-accent-2': 'var(--color-primary-dark)', '--ccp-derived': '#d49a00', '--ccp-gold': '#f5b301',
  '--ccp-online': 'var(--color-success)', '--ccp-affinity': 'var(--color-secondary)',
  '--ccp-input-bg': 'var(--color-background)', '--ccp-radius': '10px',
}

const statusText = computed(() => {
  if (connectionStore.isConnected) return 'Connected'
  if (connectionStore.connectionError) return 'Disconnected'
  return 'Connecting...'
})

const statusClass = computed(() => {
  if (connectionStore.isConnected) return 'connected'
  if (connectionStore.connectionError) return 'error'
  return 'connecting'
})

const reconnect = () => {
  connectionStore.connect()
}
</script>

<style scoped>
.connection-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--color-header-bg);
  color: var(--color-text-on-primary);
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
}

.status-left { display: flex; align-items: center; gap: 8px; }
.status-left .cc-back { color: var(--color-text-on-primary, #fff); --cc-back-size: 34px; margin-left: -6px; }
.status-left h1 {
  margin: 0;
  font-size: 1.5em;
  color: white;
}

.status-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: 0.95em;
  font-weight: 500;
}

.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: #fff;
}

.status-indicator.connected .dot {
  background-color: #34ce57;
}

.status-indicator.error .dot {
  background-color: #dc3545;
  animation: pulse 1s infinite;
}

.status-indicator.connecting .dot {
  background-color: #ffc107;
  animation: pulse 0.6s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.status-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.token-display,
.nickname-display {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: 0.9em;
}

/* "Mi perfil": botón circular a la izquierda de la moneda de soporte. */
.profile-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; padding: 0; flex-shrink: 0;
  background: rgba(255, 255, 255, 0.12); color: white;
  border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 50%; cursor: pointer;
  transition: background 0.2s;
}
.profile-btn svg { width: 18px; height: 18px; display: block; }
.profile-btn:hover { background: rgba(255, 255, 255, 0.25); }

.label {
  opacity: 0.9;
}

.token {
  font-family: monospace;
  font-weight: bold;
  background-color: rgba(255, 255, 255, 0.2);
  padding: 2px 8px;
  border-radius: 4px;
}

button.small {
  padding: 0.4em 0.8em;
  font-size: 0.85em;
  background-color: rgba(255, 255, 255, 0.2);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

button.small:hover {
  background-color: rgba(255, 255, 255, 0.3);
}

@media (max-width: 768px) {
  .connection-status {
    padding: var(--spacing-sm) var(--spacing-md);
    gap: var(--spacing-sm);
  }
  .status-left h1 {
    font-size: 1.05em;
    white-space: nowrap;
  }
  .status-center {
    flex: 0;
  }
  .status-indicator {
    font-size: 0.75em;
  }
  .status-right {
    gap: var(--spacing-sm);
    font-size: 0.8em;
  }
  .token-display {
    display: none;
  }
  .nickname-display .label {
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: inline-block;
  }
}
</style>
