import './style.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

const app = createApp(App)
const pinia = createPinia()

// Pinia must be installed before the router so route guards can use stores.
app.use(pinia)
app.use(router)

app.mount('#app')
