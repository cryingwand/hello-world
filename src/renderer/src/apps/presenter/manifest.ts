import type { AppManifest } from '../types'
import PresenterApp from './PresenterApp'

const manifest: AppManifest = {
  id: 'presenter',
  name: 'Presenter',
  space: 'launcher',
  icon: 'screen',
  component: PresenterApp,
  defaultSize: { w: 980, h: 660 },
  minSize: { w: 680, h: 440 },
  handles: [],
  presentationSafe: true
}

export default manifest
