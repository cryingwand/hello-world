import type { AppManifest } from '../types'
import ToolsApp from './ToolsApp'

const manifest: AppManifest = {
  id: 'tools',
  name: 'In-class Tools',
  space: 'launcher',
  icon: 'timer',
  component: ToolsApp,
  defaultSize: { w: 900, h: 640 },
  minSize: { w: 620, h: 440 },
  handles: []
}

export default manifest
