import type { FileSearchQuery, FileSearchResponse, FileSearchResult } from '@shared/files'
import { baseName, dirName, kindOf } from '@shared/files'
import type { Exec } from './exec'
import type { ProtectedSnapshot } from '../protected'

const DEFAULT_LIMIT = 100
/** Stat at most this many candidates per search so a broad term cannot stall the UI. */
const MAX_CANDIDATES = 600

/** Escapes text for an MDQuery string literal. */
export function mdEscape(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/[\\"*]/g, '\\$&')
}

export function searchWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
}

/**
 * Builds the Spotlight query. Every word must match (AND). Case and diacritics are ignored (`cd`).
 * A word matches the display name or the real file name (the display name can leave out the
 * extension when Finder hides extensions, so "quiz.docx" would otherwise miss). With
 * `includeContents` the text inside files counts too.
 */
export function buildMdQuery(text: string, includeContents: boolean): string | null {
  const words = searchWords(text)
  if (words.length === 0) return null
  return words
    .map((w) => {
      const e = mdEscape(w)
      const name = `kMDItemDisplayName == "*${e}*"cd || kMDItemFSName == "*${e}*"cd`
      return includeContents ? `(${name} || kMDItemTextContent == "${e}"cd)` : `(${name})`
    })
    .join(' && ')
}

const NOISE_TOP_LEVEL = [
  '/System/',
  '/Library/',
  '/private/',
  '/usr/',
  '/opt/',
  '/bin/',
  '/sbin/',
  '/Applications/'
]
const NOISE_SEGMENT_SUFFIX = [
  '.app',
  '.photoslibrary',
  '.xcodeproj',
  '.framework',
  '.bundle',
  '.noindex'
]
/** Cloud storage lives under ~/Library but is exactly where a teacher's files are. */
const CLOUD_UNDER_LIBRARY = ['Mobile Documents', 'CloudStorage']

/** Case-insensitive prefix match on folder boundaries (APFS is case-insensitive by default). */
export function teachingFolderFor(path: string, folders: readonly string[]): string | null {
  const p = path.toLowerCase()
  for (const f of folders) {
    const folder = f.replace(/\/+$/, '').toLowerCase()
    if (p === folder || p.startsWith(`${folder}/`)) return f
  }
  return null
}

/** True for results nobody wants: hidden files, Office lock files, app internals, system folders. */
export function isNoisePath(path: string, home: string, folders: readonly string[]): boolean {
  const segments = path.split('/').filter(Boolean)
  if (segments.some((s) => s.startsWith('.'))) return true
  if (baseName(path).startsWith('~$')) return true
  if (teachingFolderFor(path, folders)) return false
  if (segments.includes('node_modules')) return true
  if (segments.some((s) => NOISE_SEGMENT_SUFFIX.some((suf) => s.toLowerCase().endsWith(suf))))
    return true
  const homeLib = `${home.replace(/\/+$/, '')}/Library/`
  if (path.startsWith(homeLib)) {
    const rest = path.slice(homeLib.length)
    return !CLOUD_UNDER_LIBRARY.some((c) => rest === c || rest.startsWith(`${c}/`))
  }
  return NOISE_TOP_LEVEL.some((prefix) => path.startsWith(prefix))
}

/** Lower is better: exact name, name starts with the search, words start words, contains, content-only. */
export function nameRank(name: string, words: readonly string[]): number {
  const dot = name.lastIndexOf('.')
  const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase()
  const q = words.join(' ').toLowerCase()
  if (base === q) return 0
  if (base.startsWith(q)) return 1
  const lower = words.map((w) => w.toLowerCase())
  const escape = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (lower.every((w) => new RegExp(`(^|[^a-z0-9])${escape(w)}`).test(base))) return 2
  if (lower.every((w) => base.includes(w))) return 3
  return 4
}

export interface SpotlightDeps {
  exec: Exec
  /** Null if the path is gone. */
  stat: (path: string) => Promise<{ isFile: boolean; size: number; mtimeMs: number } | null>
  home: string
  isMac: () => boolean
  /**
   * Protected folders. With `hide`, protected files are dropped before anything else so they cannot
   * use up result slots or show a name; without it they are kept and marked.
   */
  protection?: { snapshot: () => Promise<ProtectedSnapshot>; hide: boolean }
}

const lines = (stdout: string): string[] =>
  stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('/'))

export async function searchFiles(
  query: FileSearchQuery,
  teachingFolders: readonly string[],
  deps: SpotlightDeps
): Promise<FileSearchResponse> {
  const words = searchWords(query.text ?? '')
  const mdq = buildMdQuery(query.text ?? '', !!query.includeContents)
  if (!mdq) return { results: [], truncated: false }
  if (!deps.isMac())
    return {
      results: [],
      truncated: false,
      unavailable: 'File search uses Spotlight and only works on a Mac.'
    }
  if (query.teachingOnly && teachingFolders.length === 0) {
    return {
      results: [],
      truncated: false,
      unavailable: 'No teaching folders are set. Add them in Settings.'
    }
  }

  const runs: Promise<string[]>[] = teachingFolders.map((f) =>
    deps.exec('mdfind', ['-onlyin', f, mdq]).then((r) => lines(r.stdout))
  )
  if (!query.teachingOnly) runs.push(deps.exec('mdfind', [mdq]).then((r) => lines(r.stdout)))
  const settled = await Promise.allSettled(runs)

  const failures = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected')
  const found = new Set<string>()
  // Teaching-folder hits first so the candidate cap never starves them.
  for (const s of settled) if (s.status === 'fulfilled') for (const p of s.value) found.add(p)
  if (failures.length === settled.length) {
    const first = failures[0].reason as { message?: string; code?: string }
    const why =
      first.code === 'ENOENT'
        ? 'Spotlight (mdfind) was not found.'
        : `Spotlight search failed: ${first.message ?? 'unknown error'}`
    return { results: [], truncated: false, unavailable: why }
  }

  const snap = deps.protection ? await deps.protection.snapshot() : null
  const hide = !!deps.protection?.hide
  const candidates = [...found]
    .filter((p) => !isNoisePath(p, deps.home, teachingFolders))
    .filter((p) => !(hide && snap?.lexical(p)))
    .slice(0, MAX_CANDIDATES)
  const statted = await Promise.all(
    candidates.map(async (p) => ({ p, st: await deps.stat(p).catch(() => null) }))
  )

  // The strong check (symlinks, `..`) on what is left, which is at most MAX_CANDIDATES paths.
  const flagged = new Set<string>()
  if (snap) {
    await Promise.all(
      statted.map(async ({ p, st }) => {
        if (st?.isFile && (await snap.has(p))) flagged.add(p)
      })
    )
  }

  const results: FileSearchResult[] = []
  for (const { p, st } of statted) {
    if (!st || !st.isFile) continue
    if (hide && flagged.has(p)) continue
    const folder = teachingFolderFor(p, teachingFolders)
    results.push({
      path: p,
      name: baseName(p),
      dir: dirName(p),
      kind: kindOf(p),
      isTeaching: folder !== null,
      teachingFolder: folder,
      mtime: st.mtimeMs,
      size: st.size,
      ...(flagged.has(p) ? { isProtected: true } : {})
    })
  }

  const rank = new Map(results.map((r) => [r.path, nameRank(r.name, words)]))
  results.sort(
    (a, b) =>
      Number(b.isTeaching) - Number(a.isTeaching) ||
      (rank.get(a.path) ?? 4) - (rank.get(b.path) ?? 4) ||
      b.mtime - a.mtime ||
      a.name.localeCompare(b.name)
  )

  const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_LIMIT, 500))
  return {
    results: results.slice(0, limit),
    truncated: results.length > limit || found.size > MAX_CANDIDATES
  }
}
