import type { AppManifest } from '../types'
import QuizzesApp from './QuizzesApp'

const manifest: AppManifest = {
  id: 'quizzes',
  space: 'vault',
  name: 'Quizzes & Exams',
  icon: 'quiz',
  component: QuizzesApp,
  defaultSize: { w: 1120, h: 700 },
  minSize: { w: 720, h: 440 },
  handles: ['open-quiz']
}

export default manifest
