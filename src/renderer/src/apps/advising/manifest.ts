import type { AppManifest } from '../types'
import AdvisingApp from './AdvisingApp'

const manifest: AppManifest = {
  id: 'advising',
  space: 'vault',
  name: 'Advising',
  icon: 'chat',
  component: AdvisingApp,
  defaultSize: { w: 1120, h: 700 },
  minSize: { w: 720, h: 440 },
  handles: ['open-advisee']
}

export default manifest
