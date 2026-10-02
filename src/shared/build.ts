/**
 * Which build this is. CI stamps it in (`TOS_*` environment variables, see electron.vite.config.ts):
 * `stable` for a version merged to master, `preview` for a branch still being worked on. Anything built
 * on a Mac with `npm run install:mac`, or run with `npm run dev`, is `local` and numbered 0, so every
 * published build is newer than it.
 */
export type BuildChannel = 'stable' | 'preview' | 'local'

export interface BuildInfo {
  /** CI's run number: higher is newer. 0 for a local build. */
  number: number
  commit: string
  channel: BuildChannel
  /** The git branch it was built from ('' for a local build). */
  branch: string
  /** ISO time it was built. */
  date: string
}

export const LOCAL_BUILD: BuildInfo = {
  number: 0,
  commit: '',
  channel: 'local',
  branch: '',
  date: ''
}

const CHANNELS: readonly BuildChannel[] = ['stable', 'preview', 'local']

/** Reads the `TOS_*` variables CI sets. Anything missing or malformed gives a local build. */
export function buildInfoFromEnv(
  env: Record<string, string | undefined>,
  now: Date = new Date()
): BuildInfo {
  const number = Number(env['TOS_BUILD_NUMBER'])
  const channel = env['TOS_CHANNEL'] as BuildChannel
  if (!Number.isInteger(number) || number <= 0 || !CHANNELS.includes(channel)) return LOCAL_BUILD
  return {
    number,
    commit: env['TOS_COMMIT'] ?? '',
    channel,
    branch: env['TOS_BRANCH'] ?? '',
    date: now.toISOString()
  }
}

/** The release tag of a branch's preview. GitHub tags allow little, so anything else becomes '-'. */
export function previewTag(branch: string): string {
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `preview-${slug}`
}
