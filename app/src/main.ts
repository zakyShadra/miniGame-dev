import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/main.css'
import { initTheme } from './lib/theme'

// Terapkan tema tersimpan sebelum mount (hindari kilat tema terang).
initTheme()

const app = createApp(App)

app.use(createPinia())

app.mount('#app')
