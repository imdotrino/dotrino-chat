<template>
  <NicknameModal :t="t" />

  <div class="app-container" :data-mobile-view="mobileView">
    <!-- Barra superior estándar del ecosistema (CONVENCIONES §5): marca, volver,
         idioma, perfil (§6.1) y moneda de soporte (§6) vienen en el componente.
         La app solo aporta sus acciones por el slot. -->
    <dotrino-topbar
      ref="topbarRef"
      brand="Dotrino Chat"
      icon="./icon.svg"
      brand-href="./"
      profile
      :lang.attr="lang"
      support-href="https://ko-fi.com/dotrino"
      support-repo="imdotrino/dotrino-chat"
      support-discord="https://discord.gg/D648uq7cth"
      @dotrino-lang="onLang"
    >
      <ConnectionStatus :t="t" />
    </dotrino-topbar>

    <div class="main-layout">
      <RoomList class="panel panel-rooms" :t="t" />
      <ChatRoom
        class="panel panel-chat"
        :t="t"
        @back="mobileView = 'rooms'"
        @show-members="mobileView = 'members'"
      />
      <MemberList
        class="panel panel-members"
        :t="t"
        :lang="lang"
        @back="mobileView = 'chat'"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch, watchEffect } from 'vue'
import { useConnectionStore } from './stores/connectionStore'
import { useRoomStore } from './stores/roomStore'
import { detectLang, messages } from './i18n'
import '@dotrino/topbar'
import { getIdentity } from './services/identity'
import { getReputation } from './services/reputation'
import NicknameModal from './components/NicknameModal.vue'
import ConnectionStatus from './components/ConnectionStatus.vue'
import RoomList from './components/RoomList.vue'
import ChatRoom from './components/ChatRoom.vue'
import MemberList from './components/MemberList.vue'

const connectionStore = useConnectionStore()
const roomStore = useRoomStore()

// --- Idioma (CONVENCIONES §9) ----------------------------------------------
// El <dotrino-topbar> es el dueño del toggle y de la preferencia: la app solo
// arranca con el mismo criterio y luego obedece su evento 'dotrino-lang'.
const lang = ref(detectLang())
const t = computed(() => messages[lang.value])
watch(lang, (l) => { document.documentElement.lang = l }, { immediate: true })
const onLang = (e) => {
  const l = e?.detail?.lang
  if (l === 'es' || l === 'en') lang.value = l
}

// Vista activa en mobile: 'rooms' | 'chat' | 'members'
const mobileView = ref('rooms')

watch(() => roomStore.isInRoom, (inRoom) => {
  mobileView.value = inRoom ? 'chat' : 'rooms'
})

// --- Topbar del ecosistema --------------------------------------------------
// El topbar es el dueño del botón y del modal "Mi perfil": le pasamos los
// pilares (identity + reputation) por propiedad JS y él arma el provider, el
// avatar del perfil activo y el modal. La app no reimplementa nada de eso.
const topbarRef = ref(null)
const identityInst = ref(null)
const reputationInst = ref(null)

// Tema del modal de perfil, acorde a la paleta de la app (theme.css).
const profileTheme = {
  '--ccp-bg': 'var(--color-card-bg)', '--ccp-bg-2': 'var(--color-surface)',
  '--ccp-bg-3': 'var(--color-surface-variant)', '--ccp-bg-4': 'var(--color-border-light)',
  '--ccp-border': 'var(--color-border)', '--ccp-text': 'var(--color-text)',
  '--ccp-muted': 'var(--color-text-secondary)', '--ccp-accent': 'var(--color-primary)',
  '--ccp-accent-2': 'var(--color-primary-dark)', '--ccp-derived': '#d49a00', '--ccp-gold': '#f5b301',
  '--ccp-online': 'var(--color-success)', '--ccp-affinity': 'var(--color-secondary)',
  '--ccp-input-bg': 'var(--color-background)', '--ccp-radius': '10px',
}

watchEffect(() => {
  const tb = topbarRef.value
  if (!tb) return
  tb.identity = identityInst.value ?? null
  tb.reputation = reputationInst.value ?? null
  tb.profileTheme = profileTheme
})

onMounted(async () => {
  // Hidratar el nickname desde el vault ANTES de decidir si mostramos el
  // NicknameModal: si ya tienes identidad con nickname, no te lo volvemos a pedir.
  await connectionStore.hydrateNicknameFromVault()
  identityInst.value = await getIdentity()
  if (identityInst.value) reputationInst.value = await getReputation()
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

/* Topbar del ecosistema con la paleta de la app (el componente viene oscuro/
   morado por defecto). Mantiene el degradado de marca y el texto blanco del
   header anterior; no encoge en el layout en columna. */
dotrino-topbar {
  flex-shrink: 0;
  --dotrino-topbar-bg: var(--color-header-bg);
  --dotrino-topbar-text: var(--color-text-on-primary);
  --dotrino-topbar-muted: rgba(255, 255, 255, 0.85);
  --dotrino-topbar-border: rgba(255, 255, 255, 0.25);
  --dotrino-topbar-accent: rgba(255, 255, 255, 0.3);
  --dotrino-topbar-accent-text: var(--color-text-on-primary);
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
