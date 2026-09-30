import { contextBridge } from 'electron'

// The typed `window.api` surface is built out in the data-layer step.
contextBridge.exposeInMainWorld('api', {
  platform: process.platform
})
