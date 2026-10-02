import { previewTag, type BuildInfo } from './build'

/**
 * Updates come from this repository's GitHub releases, which CI publishes (.github/workflows/ci.yml):
 * `build-<n>` for each version merged to master, and one `preview-<branch>` prerelease per branch
 * being worked on, replaced on every push. A release's body ends with a machine-readable line CI
 * writes, `<!-- tos-build {...} -->`, holding the build's number, branch and each zip's checksum, so
 * one request lists everything and the download can be checked before anything is installed.
 */
export const RELEASES_URL =
  'https://api.github.com/repos/cryingwand/hello-world/releases?per_page=50'

/** Hosts the updater may talk to: the API, and where release downloads are served from. */
export const UPDATE_HOSTS = ['api.github.com', 'github.com'] as const
export const UPDATE_HOST_SUFFIX = '.githubusercontent.com'

export function isUpdateHost(url: string): boolean {
  let host: string
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    host = u.hostname.toLowerCase()
  } catch {
    return false
  }
  return (UPDATE_HOSTS as readonly string[]).includes(host) || host.endsWith(UPDATE_HOST_SUFFIX)
}

export interface ReleaseAsset {
  name: string
  url: string
  size: number
  sha256: string
}

/** One published build, as this Mac sees it. */
export interface PublishedBuild {
  tag: string
  title: string
  number: number
  commit: string
  channel: 'stable' | 'preview'
  branch: string
  date: string
  /** What changed, one line each. */
  notes: string[]
  /** The zip for this Mac's processor, or null if none was published for it. */
  asset: ReleaseAsset | null
}

/** What the Settings window shows about a build that can be installed. */
export interface UpdateOffer {
  tag: string
  title: string
  number: number
  branch: string
  date: string
  notes: string[]
  size: number
  /** False when nothing was built for this Mac's processor. */
  installable: boolean
}

export interface UpdateTask {
  kind: 'update' | 'preview'
  tag: string
  step: 'download' | 'check' | 'backup' | 'copy' | 'install'
  received: number
  total: number
}

export interface UpdateStatus {
  build: BuildInfo
  /** Why this copy cannot replace itself (a development run, say), or null if it can. */
  cannotInstall: string | null
  checking: boolean
  checkedAt: string | null
  error: string | null
  /** A newer version of this app, if there is one. */
  available: UpdateOffer | null
  /** Versions being worked on that can be tried in the Preview app, newest first. */
  previews: UpdateOffer[]
  /** The Preview app is installed. */
  previewInstalled: boolean
  /** When the Preview's copy of the data was made, if it has one. */
  previewDataCopiedAt: string | null
  /** A download or install in progress. */
  task: UpdateTask | null
}

const MARKER = /<!--\s*tos-build\s+(\{.*?\})\s*-->/s
const MAX_NOTES = 30

interface RawRelease {
  tag_name?: unknown
  name?: unknown
  body?: unknown
  draft?: unknown
  published_at?: unknown
  assets?: unknown
}

interface RawMarker {
  number?: unknown
  commit?: unknown
  channel?: unknown
  branch?: unknown
  date?: unknown
  assets?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The "- " lines of a release body, before the marker. */
function notesOf(body: string): string[] {
  return body
    .replace(MARKER, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter((l) => l !== '')
    .slice(0, MAX_NOTES)
}

function assetFor(raw: RawRelease, marker: RawMarker, arch: string): ReleaseAsset | null {
  const listed = (marker.assets ?? {}) as Record<string, unknown>
  const want = Object.prototype.hasOwnProperty.call(listed, arch)
    ? (listed[arch] as { name?: unknown; sha256?: unknown; size?: unknown })
    : null
  if (!want || typeof want.name !== 'string' || typeof want.sha256 !== 'string') return null
  if (!/^[0-9a-f]{64}$/.test(want.sha256)) return null
  const uploaded = Array.isArray(raw.assets) ? (raw.assets as Record<string, unknown>[]) : []
  const file = uploaded.find((a) => a['name'] === want.name)
  const url = file ? str(file['browser_download_url']) : ''
  if (!file || !isUpdateHost(url)) return null
  const size = typeof file['size'] === 'number' ? file['size'] : Number(want.size) || 0
  return { name: want.name, url, size, sha256: want.sha256 }
}

/**
 * Reads the GitHub releases API's answer. Releases without CI's marker (made by hand), drafts and
 * anything malformed are left out rather than trusted.
 */
export function parseReleases(json: unknown, arch: string): PublishedBuild[] {
  if (!Array.isArray(json)) return []
  const out: PublishedBuild[] = []
  for (const raw of json as RawRelease[]) {
    if (!raw || typeof raw !== 'object' || raw.draft === true) continue
    const body = str(raw.body)
    const m = MARKER.exec(body)
    if (!m) continue
    let marker: RawMarker
    try {
      marker = JSON.parse(m[1]) as RawMarker
    } catch {
      continue
    }
    const number = marker.number
    const channel = marker.channel
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) continue
    if (channel !== 'stable' && channel !== 'preview') continue
    const tag = str(raw.tag_name)
    if (tag === '') continue
    out.push({
      tag,
      title: str(raw.name) || tag,
      number,
      commit: str(marker.commit),
      channel,
      branch: str(marker.branch),
      date: str(marker.date) || str(raw.published_at),
      notes: notesOf(body),
      asset: assetFor(raw, marker, arch)
    })
  }
  return out
}

/**
 * The build this app should offer to update to: the newest stable build above its own number, or,
 * for a Preview, the newest build of the same branch's preview.
 */
export function updateFor(builds: PublishedBuild[], current: BuildInfo): PublishedBuild | null {
  const candidates =
    current.channel === 'preview'
      ? builds.filter((b) => b.channel === 'preview' && b.tag === previewTag(current.branch))
      : builds.filter((b) => b.channel === 'stable')
  let best: PublishedBuild | null = null
  for (const b of candidates) {
    if (b.number > current.number && (!best || b.number > best.number)) best = b
  }
  return best
}

/** The previews that can be tried, newest first. */
export function previewsOf(builds: PublishedBuild[]): PublishedBuild[] {
  return builds.filter((b) => b.channel === 'preview').sort((a, b) => b.number - a.number)
}

export function offerOf(b: PublishedBuild): UpdateOffer {
  return {
    tag: b.tag,
    title: b.title,
    number: b.number,
    branch: b.branch,
    date: b.date,
    notes: b.notes,
    size: b.asset?.size ?? 0,
    installable: b.asset !== null
  }
}
