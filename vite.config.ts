import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { claudeWatcher } from './src/watcher/claudeWatcher'

export default defineConfig({
  plugins: [react(), claudeWatcher()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 4300, strictPort: false },
})
