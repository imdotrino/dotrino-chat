import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue({
      template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith('dotrino-') } },
    }),
  ],
  base: './',
  server: {
    port: 5174,
    open: true
  }
})
