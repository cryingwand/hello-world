import type { AppManifest } from '../types'
import VaultFilesApp from './VaultFilesApp'

const manifest: AppManifest = {
  id: 'vault-files',
  name: 'Files',
  space: 'vault',
  icon: 'folder',
  component: VaultFilesApp,
  defaultSize: { w: 1120, h: 700 },
  minSize: { w: 720, h: 460 },
  handles: ['attach-file', 'search-files'],
  presentationSafe: false
}

export default manifest
