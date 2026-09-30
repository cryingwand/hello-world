import type { AppManifest } from '../types'
import FilesApp from './FilesApp'

const manifest: AppManifest = {
  id: 'files',
  name: 'Files',
  icon: 'folder',
  component: FilesApp,
  defaultSize: { w: 1120, h: 700 },
  minSize: { w: 720, h: 460 },
  handles: ['attach-file', 'search-files'],
  // Student names in the attach UI are masked, spreadsheet previews and the attached-files tab are
  // hidden while presenting. Lesson PDFs, images and documents stay usable on the projector.
  presentationSafe: true
}

export default manifest
