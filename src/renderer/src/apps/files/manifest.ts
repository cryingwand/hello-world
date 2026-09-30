import { createElement } from 'react'
import AppPlaceholder from '@renderer/components/AppPlaceholder'
import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'files',
  name: 'Files',
  icon: 'folder',
  component: () => createElement(AppPlaceholder, { name: 'Files' }),
  defaultSize: { w: 900, h: 600 },
  minSize: { w: 480, h: 320 },
  handles: ['attach-file'],
  presentationSafe: true
}

export default manifest
