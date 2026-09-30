import { createElement } from 'react'
import AppPlaceholder from '@renderer/components/AppPlaceholder'
import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'classes',
  name: 'Classes & Rosters',
  icon: 'users',
  component: () => createElement(AppPlaceholder, { name: 'Classes & Rosters' }),
  defaultSize: { w: 900, h: 600 },
  minSize: { w: 480, h: 320 },
  handles: ['open-class'],
  presentationSafe: true
}

export default manifest
