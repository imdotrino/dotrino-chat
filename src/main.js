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
