import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { buildInfoFromEnv } from './src/shared/build'

// CI stamps each published build with its number and channel (see src/shared/build.ts).
const build = buildInfoFromEnv(process.env)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __TOS_BUILD__: JSON.stringify(build) },
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@apps': resolve('src/renderer/src/apps')
      }
    }
  }
})
