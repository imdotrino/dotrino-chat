<template>
  <div class="room-list">
    <div class="room-header">
      <h3>Rooms</h3>
      <button @click="refreshRooms" class="small" title="Refresh room list">↻</button>
    </div>

    <div class="room-create">
      <input
        v-model="newRoomName"
        type="text"
        placeholder="Create new room"
        maxlength="32"
        @keyup.enter="createRoom"
        class="create-input"
      />
      <button @click="createRoom" class="small">+</button>
    </div>

    <div class="room-items">
      <div
        v-for="room in roomStore.rooms"
        :key="room.name"
        :class="['room-item', { active: roomStore.currentRoom === room.name }]"
      >
        <div class="room-info">
          <span class="room-name">#{{ room.name }}</span>
          <span class="member-count">({{ room.memberCount }})</span>
        </div>
        <button @click="joinRoomClick(room.name)" class="small join-btn">
          Join
        </button>
      </div>
    </div>

    <div v-if="error" class="error">{{ error }}</div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoomStore } from '../stores/roomStore'

const roomStore = useRoomStore()

const newRoomName = ref('')
const error = ref('')

let pollInterval = null

onMounted(() => {
  roomStore.listPublicRooms()
  // Poll periódico para mantener counts y descubrir salas creadas por otros
  pollInterval = setInterval(() => {
    roomStore.listPublicRooms()
  }, 3000)
})

onUnmounted(() => {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
})

const refreshRooms = async () => {
  await roomStore.listPublicRooms()
}

const createRoom = async () => {
  const name = newRoomName.value.trim()
  if (!name) {
    error.value = 'Room name required'
    return
  }

  try {
    await roomStore.createRoom(name)
    newRoomName.value = ''
    error.value = ''
  } catch (e) {
    error.value = e.message
  }
}

const joinRoomClick = async (name) => {
  try {
    await roomStore.joinRoom(name)
    error.value = ''
  } catch (e) {
    error.value = e.message
  }
}
</script>

<style scoped>
.room-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-right: 1px solid var(--color-border);
  padding: var(--spacing-md);
  background-color: var(--color-surface);
  min-width: 200px;
  max-width: 280px;
  overflow: hidden;
}

@media (max-width: 768px) {
  .room-list {
    max-width: 100%;
    min-width: 0;
    border-right: none;
  }
  .create-input { font-size: 16px; }
  .room-item { padding: var(--spacing-md); }
  .join-btn { padding: var(--spacing-xs) var(--spacing-sm); font-size: 0.85em; }
}

.room-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);
}

.room-header h3 {
  margin: 0;
  font-size: 1.1em;
}

button.small {
  padding: 0.3em 0.6em;
  font-size: 0.9em;
}

.room-create {
  display: flex;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.create-input {
  flex: 1;
  padding: 0.4em 0.6em;
  font-size: 0.9em;
}

.room-items {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.room-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-sm);
  border-radius: var(--border-radius-md);
  background-color: var(--color-background);
  transition: background-color 0.2s;
  cursor: pointer;
}

.room-item:hover {
  background-color: var(--color-surface-variant);
}

.room-item.active {
  background-color: var(--color-primary);
  color: var(--color-text-on-primary);
}

.room-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 1;
  min-width: 0;
}

.room-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.member-count {
  font-size: 0.85em;
  opacity: 0.7;
  white-space: nowrap;
}

.room-item.active .member-count {
  color: var(--color-text-on-primary);
}

.join-btn {
  padding: 0.2em 0.5em;
  font-size: 0.8em;
  white-space: nowrap;
}

.error {
  color: var(--color-error);
  font-size: 0.85em;
  padding: var(--spacing-sm);
  background-color: rgba(220, 53, 69, 0.1);
  border-radius: var(--border-radius-sm);
  margin-top: var(--spacing-sm);
}
</style>
