<template>
  <NicknameModal />

  <div class="app-container" :data-mobile-view="mobileView">
    <ConnectionStatus />

    <div class="main-layout">
      <RoomList class="panel panel-rooms" />
      <ChatRoom
        class="panel panel-chat"
        @back="mobileView = 'rooms'"
        @show-members="mobileView = 'members'"
      />
      <MemberList
        class="panel panel-members"
        @back="mobileView = 'chat'"
      />
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import { useConnectionStore } from './stores/connectionStore'
import { useRoomStore } from './stores/roomStore'
import NicknameModal from './components/NicknameModal.vue'
import ConnectionStatus from './components/ConnectionStatus.vue'
import RoomList from './components/RoomList.vue'
import ChatRoom from './components/ChatRoom.vue'
import MemberList from './components/MemberList.vue'

const connectionStore = useConnectionStore()
const roomStore = useRoomStore()

// Vista activa en mobile: 'rooms' | 'chat' | 'members'
const mobileView = ref('rooms')

watch(() => roomStore.isInRoom, (inRoom) => {
  mobileView.value = inRoom ? 'chat' : 'rooms'
})

onMounted(async () => {
  // Hidratar el nickname desde el vault ANTES de decidir si mostramos el
  // NicknameModal: si ya tenés identidad con nickname, no te lo volvemos a pedir.
  await connectionStore.hydrateNicknameFromVault()
  try {
    await connectionStore.connect()
  } catch (error) {
    console.error('Failed to connect:', error)
  }
})
</script>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  width: 100%;
}

.main-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
  background-color: var(--color-background);
}

.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

@media (max-width: 768px) {
  .main-layout {
    position: relative;
  }
  .panel {
    display: none;
    flex: 1;
    width: 100%;
    max-width: 100%;
  }
  .app-container[data-mobile-view='rooms'] .panel-rooms { display: flex; }
  .app-container[data-mobile-view='chat'] .panel-chat { display: flex; }
  .app-container[data-mobile-view='members'] .panel-members { display: flex; }
}
</style>
