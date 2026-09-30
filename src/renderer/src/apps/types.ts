import type { ComponentType } from 'react'
import type { Intent, IntentType } from '@shared/intents'
import type { IconName } from '@renderer/components/Icon'

/** Props every app component receives from its window. */
export interface AppProps {
  windowId: string
  /** The most recent intent routed to this app, if any. */
  intent?: Intent
  /** Changes every time an intent is routed, even if the intent value is identical. */
  intentNonce?: number
}

/** The contract each `apps/<id>/manifest.ts` default-exports. */
/** Which window role hosts an app: the everyday launcher or the protected vault. */
export type Space = 'launcher' | 'vault'

export interface AppManifest {
  id: string
  /** Decides which shell shows the app. Anything touching student data belongs in `vault`. */
  space: Space
  name: string
  icon: IconName
  component: ComponentType<AppProps>
  defaultSize: { w: number; h: number }
  minSize?: { w: number; h: number }
  /** Intent types this app can open. */
  handles: IntentType[]
  /** False hides the app's windows while presentation mode is on. */
  presentationSafe: boolean
}
