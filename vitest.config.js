import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{js,mjs}'],
    setupFiles: ['./test/setup.js'],
    globals: false
  }
})
