import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { APP_NAME, PREVIEW_APP_NAME } from '@shared/app-info'
import type { BuildInfo } from '@shared/build'
import {
  RELEASES_URL,
  isUpdateHost,
  offerOf,
  parseReleases,
  previewsOf,
  updateFor,
  type PublishedBuild,
  type ReleaseAsset,
  type UpdateStatus,
  type UpdateTask
} from '@shared/updates'
import type { Exec } from '../mac/exec'
import { ValidationError } from '../validate'

export interface UpdaterDeps {
  build: BuildInfo
  /** `process.arch`: which zip to download. */
  arch: string
  platform: string
  /** The running `.app`, or null when this is not a packaged Mac app (a development run). */
  bundlePath: string | null
  /** Where apps are installed: /Applications. */
  appsDir: string
  /** Downloads wait here until they are installed. */
  downloadDir: string
  /** Electron's `net.fetch`, so the Mac's proxy settings apply. */
  fetch: (url: string) => Promise<Response>
  exec: Exec
  /** Moves a file or folder to the Trash. */
  trash: (path: string) => Promise<void>
  presenting: () => boolean
  /**
   * Fresh, checked backups of both databases, returning their paths. Throws if either cannot be
   * taken: nothing is installed without one.
   */
  backup: () => Promise<{ data: string; vault: string | null }>
  /** The Vault's `vault.json` (passcode hash and settings), copied into a Preview's data. */
  vaultMetaPath: string
  /** The Preview app's data folder. */
  previewDataDir: string
  /** Starts the newly installed copy of this app and quits this one. */
  relaunch: () => void
  /** The status changed: tell the everyday window. */
  changed: () => void
  now?: () => Date
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_MS = 15_000
const PROGRESS_EVERY_MS = 300
const SAFE_ZIP = /^[A-Za-z0-9._-]+\.zip$/
/** Left in the Applications folder by an install; removed at the next launch. */
const LEFTOVER = /^\.tos-(update|old)-\d+(\.app)?$/

export const PREVIEW_META = 'preview.json'

const appFile = (channel: 'stable' | 'preview'): string =>
  `${channel === 'preview' ? PREVIEW_APP_NAME : APP_NAME}.app`

/**
 * Keeps Teaching OS up to date from the builds CI publishes (see `src/shared/updates.ts`), and
 * installs a branch's build as a separate Preview app that runs on a copy of the data.
 *
 * An install never runs a shell: the zip is checked against the published SHA-256, unpacked with
 * `ditto`, its signature checked with `codesign`, both databases are backed up, and only then is the
 * new app renamed into place next to the old one (which is kept until the next launch).
 */
export function createUpdater(deps: UpdaterDeps) {
  const now = (): Date => deps.now?.() ?? new Date()
  const isPreview = deps.build.channel === 'preview'
  const previewTarget = join(deps.appsDir, appFile('preview'))

  let builds: PublishedBuild[] = []
  let checking = false
  let checkedAt: string | null = null
  let error: string | null = null
  let task: UpdateTask | null = null
  let timers: ReturnType<typeof setTimeout>[] = []

  const cannotInstall = (): string | null => {
    if (deps.platform !== 'darwin') return 'Updates install on a Mac.'
    if (!deps.bundlePath)
      return 'This is a development copy. Updates install in the app in your Applications folder.'
    if (dirname(deps.bundlePath) !== deps.appsDir)
      return 'Move Teaching OS into your Applications folder to update it from here.'
    return null
  }

  const previewCopiedAt = (): string | null => {
    try {
      const raw = JSON.parse(readFileSync(join(deps.previewDataDir, PREVIEW_META), 'utf8')) as {
        copiedAt?: unknown
      }
      return typeof raw.copiedAt === 'string' ? raw.copiedAt : null
    } catch {
      return null
    }
  }

  const status = (): UpdateStatus => {
    const available = updateFor(builds, deps.build)
    return {
      build: deps.build,
      cannotInstall: cannotInstall(),
      checking,
      checkedAt,
      error,
      available: available ? offerOf(available) : null,
      // A Preview offers only newer builds of itself, never other previews.
      previews: isPreview ? [] : previewsOf(builds).map(offerOf),
      previewInstalled: !isPreview && existsSync(previewTarget),
      previewDataCopiedAt: previewCopiedAt(),
      task: task ? { ...task } : null
    }
  }

  const fetchChecked = async (url: string): Promise<Response> => {
    if (!isUpdateHost(url)) throw new Error(`Refusing to fetch ${url}`)
    const res = await deps.fetch(url)
    // Redirects are followed by Chromium; where it ended up must still be GitHub.
    if (res.url && !isUpdateHost(res.url))
      throw new Error(`Redirected away from GitHub: ${res.url}`)
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    return res
  }

  async function check(): Promise<UpdateStatus> {
    if (checking) return status()
    checking = true
    deps.changed()
    try {
      const res = await fetchChecked(RELEASES_URL)
      builds = parseReleases(await res.json(), deps.arch)
      error = null
    } catch (err) {
      console.warn('[update] check failed:', err)
      error = 'Could not reach GitHub to check for updates. Check the internet connection.'
    } finally {
      checking = false
      checkedAt = now().toISOString()
      deps.changed()
    }
    return status()
  }

  /** One install at a time, never while presenting, and only from the app in Applications. */
  const begin = (kind: UpdateTask['kind'], tag: string): void => {
    const why = cannotInstall()
    if (why) throw new ValidationError(why)
    if (deps.presenting()) throw new ValidationError('End the presentation first.')
    if (task) throw new ValidationError('An update is already being installed.')
    task = { kind, tag, step: 'download', received: 0, total: 0 }
    deps.changed()
  }
  const step = (s: UpdateTask['step']): void => {
    if (task) task = { ...task, step: s }
    deps.changed()
  }
  const finish = (): void => {
    task = null
    deps.changed()
  }

  async function download(asset: ReleaseAsset): Promise<string> {
    if (!SAFE_ZIP.test(asset.name)) throw new Error(`Unexpected file name ${asset.name}`)
    await mkdir(deps.downloadDir, { recursive: true })
    const zip = join(deps.downloadDir, asset.name)
    const res = await fetchChecked(asset.url)
    if (!res.body) throw new Error('The download was empty')
    const total = Number(res.headers.get('content-length')) || asset.size
    const hash = createHash('sha256')
    const file = await open(zip, 'w')
    let received = 0
    let told = 0
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        await file.write(value)
        received += value.byteLength
        const t = Date.now()
        if (task && t - told >= PROGRESS_EVERY_MS) {
          told = t
          task = { ...task, received, total }
          deps.changed()
        }
      }
    } finally {
      await file.close()
    }
    step('check')
    if (hash.digest('hex') !== asset.sha256) {
      await rm(zip, { force: true })
      throw new ValidationError(
        'The download did not match what was published, so nothing was installed. Try again.'
      )
    }
    return zip
  }

  /** Unpacks the app beside `target`, checks it, and swaps it in. The old copy is kept aside. */
  async function place(zip: string, target: string, expected: string): Promise<void> {
    const parent = dirname(target)
    const stamp = now().getTime()
    const staging = join(parent, `.tos-update-${stamp}`)
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging)
    try {
      await deps.exec('ditto', ['-x', '-k', zip, staging], { timeoutMs: 180_000 })
      const unpacked = join(staging, expected)
      const s = await stat(unpacked).catch(() => null)
      if (!s?.isDirectory()) throw new ValidationError(`The download did not hold ${expected}.`)
      await deps.exec('codesign', ['--verify', '--deep', unpacked], { timeoutMs: 180_000 })
      const old = join(parent, `.tos-old-${stamp}.app`)
      const hadOld = existsSync(target)
      if (hadOld) await rename(target, old)
      try {
        await rename(unpacked, target)
      } catch (err) {
        if (hadOld) await rename(old, target)
        throw err
      }
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }

  const backupFirst = async (): Promise<{ data: string; vault: string | null }> => {
    try {
      return await deps.backup()
    } catch (err) {
      console.error('[update] backup failed:', err)
      throw new ValidationError(
        'A backup could not be taken first, so nothing was installed. Check the backup folder in Settings.'
      )
    }
  }

  const previewRunning = async (): Promise<boolean> => {
    try {
      // By path: a process name is cut to 16 characters on macOS, too short for the Preview's.
      await deps.exec('pgrep', ['-f', `${PREVIEW_APP_NAME}.app/Contents/`])
      return true
    } catch {
      return false // pgrep exits 1 when nothing matches
    }
  }
  const assertPreviewQuit = async (): Promise<void> => {
    if (await previewRunning())
      throw new ValidationError(`Quit ${PREVIEW_APP_NAME} first, then try again.`)
  }

  /** A fresh copy of this app's data for the Preview, from checked backups. Backups are not copied. */
  async function copyData(): Promise<void> {
    const { data, vault } = await backupFirst()
    const staging = `${deps.previewDataDir}.copying`
    await rm(staging, { recursive: true, force: true })
    await mkdir(join(staging, 'vault'), { recursive: true })
    await copyFile(data, join(staging, 'data.sqlite'))
    if (vault) await copyFile(vault, join(staging, 'vault', 'vault.sqlite'))
    if (existsSync(deps.vaultMetaPath))
      await copyFile(deps.vaultMetaPath, join(staging, 'vault', 'vault.json'))
    await writeFile(
      join(staging, PREVIEW_META),
      JSON.stringify({ copiedAt: now().toISOString(), fromBuild: deps.build.number })
    )
    await rm(deps.previewDataDir, { recursive: true, force: true })
    await rename(staging, deps.previewDataDir)
  }

  return {
    status,
    check,

    /** Downloads the newer version, backs up, installs it over this app and restarts. */
    async install(): Promise<void> {
      const offer = updateFor(builds, deps.build)
      if (!offer) throw new ValidationError('There is no update to install. Check again first.')
      if (!offer.asset)
        throw new ValidationError("This version was not built for this Mac's processor.")
      begin('update', offer.tag)
      try {
        const zip = await download(offer.asset)
        step('backup')
        await backupFirst()
        step('install')
        await place(zip, deps.bundlePath as string, appFile(offer.channel))
        await rm(zip, { force: true })
      } catch (err) {
        finish()
        throw err
      }
      deps.relaunch()
    },

    /** Installs a branch's build as the Preview app, on a fresh copy of the data, and opens it. */
    async tryPreview(rawTag: unknown): Promise<void> {
      if (isPreview) throw new ValidationError('Try other versions from the real Teaching OS.')
      const tag = typeof rawTag === 'string' ? rawTag : ''
      const build = builds.find((b) => b.channel === 'preview' && b.tag === tag)
      if (!build) throw new ValidationError('That version is no longer available. Check again.')
      if (!build.asset)
        throw new ValidationError("This version was not built for this Mac's processor.")
      await assertPreviewQuit()
      begin('preview', tag)
      try {
        const zip = await download(build.asset)
        step('copy')
        await copyData()
        step('install')
        await place(zip, previewTarget, appFile('preview'))
        await rm(zip, { force: true })
        await deps.exec('open', [previewTarget])
      } finally {
        finish()
      }
    },

    /** Replaces the Preview's data with a fresh copy of the real data. */
    async refreshPreview(): Promise<void> {
      if (isPreview) throw new ValidationError('Refresh the copy from the real Teaching OS.')
      if (!existsSync(previewTarget)) throw new ValidationError('The Preview is not installed.')
      await assertPreviewQuit()
      begin('preview', '')
      step('copy')
      try {
        await copyData()
      } finally {
        finish()
      }
    },

    /** Moves the Preview app to the Trash and deletes its copy of the data. */
    async removePreview(): Promise<void> {
      if (isPreview) throw new ValidationError('Remove the Preview from the real Teaching OS.')
      await assertPreviewQuit()
      if (existsSync(previewTarget)) await deps.trash(previewTarget)
      await rm(deps.previewDataDir, { recursive: true, force: true })
      deps.changed()
    },

    /** Removes what an earlier install left beside the app. */
    async cleanUp(): Promise<void> {
      if (cannotInstall()) return
      for (const name of await readdir(deps.appsDir).catch(() => [] as string[])) {
        if (LEFTOVER.test(name))
          await rm(join(deps.appsDir, name), { recursive: true, force: true }).catch(() => {})
      }
      await rm(deps.downloadDir, { recursive: true, force: true }).catch(() => {})
    },

    /** Checks shortly after launch and then every few hours, never while presenting. */
    start(): void {
      void this.cleanUp()
      const run = (): void => {
        if (!deps.presenting()) void check()
      }
      const first = setTimeout(run, FIRST_CHECK_MS)
      const every = setInterval(run, CHECK_EVERY_MS)
      first.unref?.()
      every.unref?.()
      timers = [first, every]
    },

    dispose(): void {
      for (const t of timers) clearTimeout(t)
      timers = []
    }
  }
}

export type Updater = ReturnType<typeof createUpdater>

/** The `.app` folder the running executable is inside, or null outside a packaged Mac app. */
export function bundleOf(execPath: string, packaged: boolean, platform: string): string | null {
  if (!packaged || platform !== 'darwin') return null
  const app = dirname(dirname(dirname(execPath)))
  return basename(app).endsWith('.app') ? app : null
}
