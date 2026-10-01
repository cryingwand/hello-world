import type { AppManifest } from '../types'
import CalendarApp from './CalendarApp'

const manifest: AppManifest = {
  id: 'calendar',
  name: 'Calendar',
  space: 'launcher',
  icon: 'calendar',
  component: CalendarApp,
  defaultSize: { w: 1100, h: 700 },
  minSize: { w: 760, h: 460 },
  handles: []
}

export default manifest
