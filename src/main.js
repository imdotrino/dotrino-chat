import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style/theme.css'
import './style.css'
import App from './App.vue'
import { createBackNav } from '@dotrino/nav'

// Navegación "volver" unificada del ecosistema (botón físico de Android / gesto
// de iOS / atrás del navegador / chevron del header → cierra modal o sale a
// dotrino.com).
createBackNav()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')

// Asidero para las pruebas de punta a punta (`test/sealed-chat.e2e.mjs`): la prueba que
// importa —que por el cable no viaje nada legible— necesita preguntarle al transporte
// por su token y provocar los fallos a propósito. No expone nada que no esté ya a mano
// en la página: los stores son del cliente y la llave privada vive en la bóveda.
import { useConnectionStore } from './stores/connectionStore'
import { useRoomStore } from './stores/roomStore'
window.dotrinoChat = {
  get connection () { return useConnectionStore() },
  get room () { return useRoomStore() },
  get client () { return useConnectionStore().wsProxyClient },
}
