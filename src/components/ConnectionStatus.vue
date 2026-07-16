<template>
  <!-- Estado de conexión: acción propia de la app; vive DENTRO del slot del
       <dotrino-topbar>. La marca, el volver, el idioma, el perfil y la moneda
       de soporte los pone el topbar del ecosistema (CONVENCIONES §5). -->
  <div class="connection-status">
    <div class="status-indicator" :class="statusClass">
      <span class="dot"></span>
      {{ statusText }}
    </div>

    <div v-if="connectionStore.token" class="token-display">
      <span class="label">{{ t.status.codeLabel }}</span>
      <span class="token">{{ connectionStore.token }}</span>
    </div>

    <button
      v-if="!connectionStore.isConnected"
      @click="reconnect"
      class="small"
    >
      {{ t.status.reconnect }}
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useConnectionStore } from '../stores/connectionStore'

const props = defineProps({
  t: { type: Object, required: true }
})

const connectionStore = useConnectionStore()

const statusText = computed(() => {
  if (connectionStore.isConnected) return props.t.status.connected
  if (connectionStore.connectionError) return props.t.status.disconnected
  return props.t.status.connecting
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
/* Contenido slotteado del topbar: hereda el color del texto de la barra. */
.connection-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  min-width: 0;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: 0.95em;
  font-weight: 500;
  white-space: nowrap;
}

.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: #fff;
  flex-shrink: 0;
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

.token-display {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: 0.9em;
}

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
    gap: var(--spacing-sm);
    font-size: 0.8em;
  }
  .status-indicator {
    font-size: 0.75em;
  }
  .token-display {
    display: none;
  }
}
</style>
