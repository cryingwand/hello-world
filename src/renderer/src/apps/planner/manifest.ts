import type { AppManifest } from '../types'
import PlannerApp from './PlannerApp'

const manifest: AppManifest = {
  id: 'planner',
  space: 'vault',
  name: 'Lesson Planner',
  icon: 'lessons',
  component: PlannerApp,
  defaultSize: { w: 1160, h: 720 },
  minSize: { w: 760, h: 460 },
  handles: []
}

export default manifest
