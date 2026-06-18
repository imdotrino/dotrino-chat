<template>
  <div v-if="roomStore.isInRoom" class="chat-room">
    <!-- Header -->
    <div class="chat-header">
      <button class="small mobile-only back-btn" @click="$emit('back')" title="Rooms">←</button>
      <h2>#{{ roomStore.currentRoom }}</h2>
      <button class="small mobile-only members-btn" @click="$emit('show-members')" :title="`Members (${roomStore.members.length})`">
        👥 {{ roomStore.members.length }}
      </button>
      <button @click="leaveRoom" class="danger small">Leave</button>
    </div>

    <!-- Messages -->
    <div ref="messagesContainer" class="messages">
      <div
        v-for="msg in roomStore.messages"
        :key="msg.id"
        :class="['message', msg.type]"
      >
        <div v-if="msg.type === 'system'" class="system-message">
          <em>{{ msg.text }}</em>
        </div>

        <div v-else class="chat-message" :class="{ own: msg.isMe }">
          <div class="message-header">
            <span class="nickname">{{ msg.nickname }}</span>
            <span class="timestamp">{{ formatTime(msg.timestamp) }}</span>
          </div>
          <div class="message-body">{{ msg.text }}</div>
        </div>
      </div>
    </div>

    <!-- Input -->
    <div class="chat-input-area">
      <textarea
        v-model="inputText"
        placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
        @keydown="handleKeydown"
        class="chat-input"
        rows="2"
      ></textarea>
      <button @click="sendMessage" class="primary" :disabled="!inputText.trim()">
        Send
      </button>
    </div>
  </div>

  <div v-else class="no-room">
    <p>👈 Select a room to start chatting</p>
  </div>
</template>

<script setup>
import { ref, onUpdated, nextTick } from 'vue'
import { useRoomStore } from '../stores/roomStore'

defineEmits(['back', 'show-members'])

const roomStore = useRoomStore()

const inputText = ref('')
const messagesContainer = ref(null)

const handleKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

const sendMessage = async () => {
  const text = inputText.value
  if (!text.trim()) return

  try {
    await roomStore.sendChatMessage(text)
    inputText.value = ''
    await scrollToBottom()
  } catch (error) {
    console.error('Send failed:', error)
  }
}

const leaveRoom = async () => {
  await roomStore.leaveRoom()
}

const scrollToBottom = async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

onUpdated(() => {
  scrollToBottom()
})
</script>

<style scoped>
.chat-room {
  display: flex;
  flex-direction: column;
  height: 100%;
  flex: 1;
  background-color: var(--color-background);
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.chat-header h2 {
  margin: 0;
  flex: 1;
}

button.danger {
  padding: 0.4em 0.8em;
  font-size: 0.9em;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-md) var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.message {
  display: flex;
  animation: fadeIn 0.2s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message.system {
  justify-content: center;
  padding: var(--spacing-xs) 0;
}

.system-message {
  color: var(--color-text-tertiary);
  font-size: 0.9em;
}

.chat-message {
  max-width: 80%;
}

.chat-message.own {
  align-self: flex-end;
}

.message-header {
  display: flex;
  gap: var(--spacing-sm);
  margin-bottom: 2px;
  font-size: 0.85em;
}

.nickname {
  font-weight: 600;
  color: var(--color-primary);
}

.timestamp {
  color: var(--color-text-tertiary);
}

.message-body {
  background-color: var(--color-surface);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius-md);
  word-wrap: break-word;
  white-space: pre-wrap;
  line-height: 1.4;
  color: var(--color-text);
}

.chat-message.own .message-body {
  background-color: var(--color-primary);
  color: var(--color-text-on-primary);
}

.chat-input-area {
  display: flex;
  gap: var(--spacing-sm);
  padding: var(--spacing-md) var(--spacing-lg);
  border-top: 1px solid var(--color-border);
  background-color: var(--color-surface);
  flex-shrink: 0;
}

.chat-input {
  flex: 1;
  padding: var(--spacing-sm) var(--spacing-md);
  font-family: inherit;
  font-size: 1em;
  resize: vertical;
  max-height: 150px;
}

.chat-input-area button {
  padding: var(--spacing-sm) var(--spacing-lg);
  height: fit-content;
}

.no-room {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  flex: 1;
  color: var(--color-text-secondary);
  font-size: 1.2em;
}

.mobile-only { display: none; }

@media (max-width: 768px) {
  .mobile-only { display: inline-flex; }
  .chat-header {
    padding: var(--spacing-sm) var(--spacing-md);
    gap: var(--spacing-sm);
  }
  .chat-header h2 {
    font-size: 1.05em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .back-btn, .members-btn {
    flex-shrink: 0;
  }
  .messages {
    padding: var(--spacing-sm) var(--spacing-md);
  }
  .chat-message { max-width: 85%; }
  .chat-input-area {
    padding: var(--spacing-sm);
    gap: var(--spacing-xs);
    padding-bottom: calc(var(--spacing-sm) + env(safe-area-inset-bottom, 0));
  }
  .chat-input {
    font-size: 16px; /* evita zoom en iOS */
    padding: var(--spacing-sm);
    rows: 1;
  }
  .chat-input-area button {
    padding: var(--spacing-sm) var(--spacing-md);
  }
}
</style>
