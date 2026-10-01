import type { AppManifest } from '../types'
import LibraryApp from './LibraryApp'

const manifest: AppManifest = {
  id: 'library',
  name: 'Files',
  space: 'launcher',
  icon: 'folder',
  component: LibraryApp,
  defaultSize: { w: 1120, h: 700 },
  minSize: { w: 720, h: 460 },
  handles: ['search-files', 'open-path']
}

export default manifest
