<template>
  <div v-if="open" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <button class="close-btn" @click="$emit('close')" aria-label="Close">×</button>

      <h3 class="modal-title">Tu identidad</h3>

      <div class="row">
        <label>Nickname</label>
        <input
          v-model="nickname"
          type="text"
          maxlength="20"
          placeholder="Cómo te ven los demás"
          @input="onNicknameInput"
        />
        <small v-if="nicknameStatus" class="status">{{ nicknameStatus }}</small>
      </div>

      <div class="row">
        <label>Tu pubkey</label>
        <code class="pubkey">{{ shortPubkey }}</code>
      </div>

      <div class="row">
        <label>Backup de identidad</label>
        <p class="hint">
          La llave privada vive solo en tu navegador. Exporta el archivo si quieres
          conservarla o trasladarla a otro dispositivo.
        </p>
        <div class="actions-row">
          <button class="primary" @click="onExport" :disabled="busy">
            Exportar identidad
          </button>
          <button @click="onImportClick" :disabled="busy">
            Importar identidad
          </button>
          <input
            ref="fileInput"
            type="file"
            accept="application/json"
            style="display:none"
            @change="onImportFile"
          />
        </div>
        <small v-if="ioStatus" :class="['status', { error: ioError }]">
          {{ ioStatus }}
        </small>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Identity } from '@dotrino/identity'
import { useConnectionStore } from '../stores/connectionStore'

const props = defineProps({
  open: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const connectionStore = useConnectionStore()
const fileInput = ref(null)

const nickname = ref(connectionStore.nickname || '')
const nicknameStatus = ref('')
const ioStatus = ref('')
const ioError = ref(false)
const busy = ref(false)
const myPubkey = ref('')

let nicknameTimer = null

const shortPubkey = computed(() => {
  if (!myPubkey.value) return '—'
  const k = myPubkey.value
  return k.length > 80 ? k.slice(0, 40) + '…' + k.slice(-20) : k
})

watch(() => props.open, (open) => {
  if (open) {
    nickname.value = connectionStore.nickname || ''
    nicknameStatus.value = ''
    ioStatus.value = ''
    ioError.value = false
    Identity.connect().then(id => {
      myPubkey.value = id.me?.publickey || ''
    }).catch(() => {
      myPubkey.value = ''
    })
  }
})

const onNicknameInput = () => {
  if (nicknameTimer) clearTimeout(nicknameTimer)
  nicknameTimer = setTimeout(saveNickname, 500)
}

const saveNickname = async () => {
  const v = (nickname.value || '').trim()
  if (v.length < 3) {
    nicknameStatus.value = 'Mínimo 3 caracteres'
    return
  }
  try {
    // setNickname ya escribe en el vault de identidad (única fuente de verdad).
    await connectionStore.setNickname(v)
    nicknameStatus.value = 'Guardado'
  } catch (_) {
    nicknameStatus.value = 'No se pudo guardar en tu identidad'
  }
  setTimeout(() => { nicknameStatus.value = '' }, 1500)
}

const onExport = async () => {
  busy.value = true
  ioError.value = false
  ioStatus.value = ''
  try {
    const id = await Identity.connect()
    const blob = await id.exportIdentity()
    const text = JSON.stringify(blob, null, 2)
    const file = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = `dotrino-identity-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    ioStatus.value = 'Identidad exportada'
  } catch (e) {
    ioError.value = true
    ioStatus.value = 'No se pudo exportar: ' + (e.message || e)
  } finally {
    busy.value = false
  }
}

const onImportClick = () => {
  fileInput.value?.click()
}

const onImportFile = async (event) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!confirm('Importar reemplazará tu identidad actual. ¿Continuar?')) return
  busy.value = true
  ioError.value = false
  ioStatus.value = ''
  try {
    const text = await file.text()
    const blob = JSON.parse(text)
    const id = await Identity.connect()
    const result = await id.importIdentity(blob)
    myPubkey.value = result.me?.publickey || ''
    if (result.me?.nickname) {
      // La identidad importada ya trae el nickname en el vault; solo reflejamos.
      nickname.value = result.me.nickname
      await connectionStore.hydrateNicknameFromVault()
    }
    ioStatus.value = 'Identidad importada. Recarga la página para que todas las apps vean la nueva identidad.'
  } catch (e) {
    ioError.value = true
    ioStatus.value = 'Archivo inválido: ' + (e.message || e)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
  padding: var(--spacing-md);
}
.modal {
  background: var(--color-card-bg);
  color: var(--color-text);
  border-radius: var(--border-radius-lg);
  padding: var(--spacing-lg);
  width: 100%; max-width: 460px;
  box-shadow: var(--shadow-lg);
  position: relative;
  max-height: 90vh;
  overflow-y: auto;
}
.close-btn {
  position: absolute; top: 0.5rem; right: 0.5rem;
  background: transparent; border: none; font-size: 1.5rem;
  color: var(--color-text-secondary); cursor: pointer; padding: 0.25rem 0.5rem;
}
.modal-title { margin: 0 0 var(--spacing-md); }
.row { margin-bottom: var(--spacing-md); display: flex; flex-direction: column; gap: 0.35rem; }
.row label { font-size: 0.85em; color: var(--color-text-secondary); }
.row input { font-size: 16px; }
.hint { font-size: 0.85em; color: var(--color-text-secondary); margin: 0; }
.pubkey {
  background: var(--color-surface-variant);
  padding: 0.4rem 0.6rem;
  border-radius: var(--border-radius-sm);
  font-size: 0.8em;
  word-break: break-all;
}
.actions-row { display: flex; gap: var(--spacing-sm); flex-wrap: wrap; }
.actions-row button { padding: 0.5rem 1rem; }
.status { font-size: 0.8em; color: var(--color-text-secondary); }
.status.error { color: var(--color-error); }
</style>
