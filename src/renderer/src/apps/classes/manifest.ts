import type { AppManifest } from '../types'
import ClassesApp from './ClassesApp'

const manifest: AppManifest = {
  id: 'classes',
  space: 'vault',
  name: 'Classes & Rosters',
  icon: 'users',
  component: ClassesApp,
  defaultSize: { w: 1040, h: 660 },
  minSize: { w: 640, h: 420 },
  handles: ['open-class'],
  studentData: true
}

export default manifest
