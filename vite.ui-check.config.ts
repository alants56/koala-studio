import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 临时视觉检查：把渲染层组件单独打包成静态页面，用 Electron 离屏截图。
export default defineConfig({
  base: './',
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react({}), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  build: {
    outDir: resolve(__dirname, '.ui-check-dist'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'src/renderer/ui-check.html') }
  }
})
