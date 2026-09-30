import { createElement } from 'react'
import AppPlaceholder from '@renderer/components/AppPlaceholder'
import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'gradebook',
  name: 'Gradebook',
  icon: 'grid',
  component: () => createElement(AppPlaceholder, { name: 'Gradebook' }),
  defaultSize: { w: 900, h: 600 },
  minSize: { w: 480, h: 320 },
  handles: ['open-student', 'record-score'],
  presentationSafe: false
}

export default manifest
