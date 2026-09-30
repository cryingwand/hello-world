import type { AppManifest } from '../types'
import GradebookApp from './GradebookApp'

const manifest: AppManifest = {
  id: 'gradebook',
  space: 'vault',
  name: 'Gradebook',
  icon: 'grid',
  component: GradebookApp,
  defaultSize: { w: 1180, h: 700 },
  minSize: { w: 640, h: 420 },
  handles: ['open-student', 'record-score']
}

export default manifest
