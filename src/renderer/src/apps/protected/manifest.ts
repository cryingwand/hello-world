import type { AppManifest } from '../types'
import ProtectedApp from './ProtectedApp'

const manifest: AppManifest = {
  id: 'protected',
  name: 'Protected Files',
  space: 'vault',
  icon: 'lock',
  component: ProtectedApp,
  defaultSize: { w: 1120, h: 700 },
  minSize: { w: 720, h: 460 },
  handles: []
}

export default manifest
