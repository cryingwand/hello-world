import type { AppManifest } from '../types'
import ClassesApp from './ClassesApp'

const manifest: AppManifest = {
  id: 'classes',
  name: 'Classes & Rosters',
  icon: 'users',
  component: ClassesApp,
  defaultSize: { w: 1040, h: 660 },
  minSize: { w: 640, h: 420 },
  handles: ['open-class'],
  // Student names are masked inside via <Sensitive>, so the window itself may stay up.
  presentationSafe: true
}

export default manifest
