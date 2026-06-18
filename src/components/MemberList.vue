<template>
  <div v-if="roomStore.isInRoom" class="member-list">
    <div class="member-header">
      <button class="small mobile-only back-btn" @click="$emit('back')" title="Back to chat">←</button>
      <h3>Members ({{ roomStore.members.length }})</h3>
    </div>

    <div class="member-items">
      <div
        v-for="member in sortedMembers"
        :key="member.token"
        :class="['member-item', { offline: isOffline(member), clickable: !member.isMe && !!member.pubkey }]"
        :title="!member.isMe && member.pubkey ? tooltipFor(member) : undefined"
        @click="!member.isMe && member.pubkey ? selectMember(member) : null"
      >
        <div class="member-info">
          <span class="online-dot" :class="{ offline: isOffline(member) }"></span>
          <div class="member-name-block">
            <span class="member-name">{{ displayName(member) }}</span>
            <span v-if="member.isMe" class="you-badge">(you)</span>
            <template v-else>
              <span
                v-if="ratingFor(member).value != null"
                class="rating-badge"
                :class="{ derived: ratingFor(member).source === 'derived' }"
              >
                ★ {{ ratingFor(member).value.toFixed(ratingFor(member).source === 'derived' ? 1 : 0) }}
              </span>
            </template>
          </div>
        </div>
        <span class="member-token">{{ member.token }}</span>
      </div>
    </div>

    <PeerRatingModal
      :member="selectedMember"
      @close="selectedMember = null"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoomStore } from '../stores/roomStore'
import { computeDerivedRating } from '../utils/rating'
import PeerRatingModal from './PeerRatingModal.vue'

defineEmits(['back'])

const roomStore = useRoomStore()
const selectedMember = ref(null)

const staleTime = 3 * 60 * 1000 // 3 minutes

const isOffline = (member) => {
  return !member.isMe && (Date.now() - member.lastSeen) > staleTime
}

const displayName = (member) => {
  return member.peer?.nickname || member.nickname
}

const ratingFor = (member) => {
  return computeDerivedRating(member.peer, roomStore.trustMap)
}

const tooltipFor = (member) => {
  const r = ratingFor(member)
  if (r.value == null) return 'Sin calificación — click para detalles'
  if (r.source === 'mine') return `Tu calificación: ${r.value}/5 — click para detalles`
  return `Reputación: ${r.value.toFixed(1)}/5 (${r.count} opiniones) — click para detalles`
}

onMounted(() => {
  roomStore.refreshTrustMap?.()
})

const selectMember = (member) => {
  selectedMember.value = member
}

const sortedMembers = computed(() => {
  return [...roomStore.members].sort((a, b) => {
    // Self first
    if (a.isMe) return -1
    if (b.isMe) return 1
    // Then by nickname alphabetically
    return (a.nickname || '').localeCompare(b.nickname || '')
  })
})
</script>

<style scoped>
.member-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-left: 1px solid var(--color-border);
  padding: var(--spacing-md);
  background-color: var(--color-surface);
  min-width: 180px;
  max-width: 240px;
  overflow: hidden;
}

.member-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.member-header h3 {
  margin: 0;
  font-size: 1.05em;
}

.mobile-only { display: none; }

@media (max-width: 768px) {
  .member-list {
    max-width: 100%;
    min-width: 0;
    border-left: none;
  }
  .mobile-only { display: inline-flex; }
}

.member-items {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.member-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-sm);
  border-radius: var(--border-radius-md);
  background-color: var(--color-background);
  transition: background-color 0.2s;
  font-size: 0.9em;
}

.member-item:hover {
  background-color: var(--color-surface-variant);
}

.member-item.clickable {
  cursor: pointer;
}

.rating-badge {
  font-size: 0.75em;
  background: rgba(245, 179, 1, 0.18);
  color: #d49a00;
  padding: 1px 6px;
  border-radius: 999px;
  white-space: nowrap;
}
.rating-badge.derived {
  background: rgba(52, 152, 219, 0.18);
  color: #2477b8;
}

.member-item.offline {
  opacity: 0.6;
}

.member-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 1;
  min-width: 0;
}

.online-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-success);
  flex-shrink: 0;
}

.online-dot.offline {
  background-color: var(--color-text-tertiary);
}

.member-name-block {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
}

.member-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.you-badge {
  font-size: 0.8em;
  color: var(--color-primary);
  white-space: nowrap;
}

.member-token {
  font-family: monospace;
  font-size: 0.8em;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  margin-left: auto;
  margin-left: 4px;
}
</style>
