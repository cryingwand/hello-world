import { LOCAL_BUILD, type BuildInfo } from '@shared/build'

// Replaced at build time by electron.vite.config.ts from CI's TOS_* variables.
declare const __TOS_BUILD__: BuildInfo | undefined

/** This build's number and channel. Tests and unstamped builds are `local`. */
export const BUILD: BuildInfo = typeof __TOS_BUILD__ === 'undefined' ? LOCAL_BUILD : __TOS_BUILD__

/** The Preview app runs a version still being worked on, against a copy of the data. */
export const IS_PREVIEW = BUILD.channel === 'preview'
