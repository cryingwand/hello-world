import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BuildInfo } from '../../src/shared/build'
import { RELEASES_URL } from '../../src/shared/updates'
import type { Exec } from '../../src/main/mac/exec'
import { bundleOf, createUpdater, type UpdaterDeps } from '../../src/main/update/updater'
import { release } from '../shared/releaseFixture'

const ZIP = Buffer.from('pretend this is a zip of the app')
const ZIP_SHA = createHash('sha256').update(ZIP).digest('hex')

const STABLE_10: BuildInfo = {
  number: 10,
  commit: 'c',
  channel: 'stable',
  branch: 'master',
  date: ''
}

let dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

function setup(
  opts: {
    build?: BuildInfo
    releases?: unknown[]
    sha256?: string
    presenting?: boolean
    backupFails?: boolean
    previewRunning?: boolean
    bundle?: 'applications' | 'elsewhere' | 'none'
  } = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'tos-update-'))
  dirs.push(root)
  const appsDir = join(root, 'Applications')
  mkdirSync(appsDir)
  const own = join(appsDir, 'Teaching OS.app')
  mkdirSync(own)
  writeFileSync(join(own, 'which'), 'old')
  const elsewhere = join(root, 'Downloads', 'Teaching OS.app')
  mkdirSync(elsewhere, { recursive: true })

  const backupDir = join(root, 'backups')
  mkdirSync(backupDir)
  writeFileSync(join(backupDir, 'data-1.sqlite'), 'public db')
  writeFileSync(join(backupDir, 'vault-1.sqlite'), 'vault db')
  const vaultMeta = join(root, 'data', 'vault', 'vault.json')
  mkdirSync(join(root, 'data', 'vault'), { recursive: true })
  writeFileSync(vaultMeta, '{"hash":"x"}')

  const releases = opts.releases ?? [
    release({ tag: 'build-12', number: 12, channel: 'stable', sha256: opts.sha256 ?? ZIP_SHA }),
    release({
      tag: 'preview-claude-x',
      number: 15,
      channel: 'preview',
      branch: 'claude/x',
      sha256: ZIP_SHA
    })
  ]
  const calls: string[] = []
  const fetch = vi.fn(async (url: string) => {
    calls.push(`fetch ${url}`)
    if (url === RELEASES_URL) return new Response(JSON.stringify(releases))
    return new Response(ZIP)
  })
  const opened: string[] = []
  const exec: Exec = async (cmd, args) => {
    calls.push(cmd)
    if (cmd === 'ditto') {
      // Unpacks a stable or preview app, depending on which zip it was given.
      const name = args[2].includes('-15-') ? 'Teaching OS Preview.app' : 'Teaching OS.app'
      mkdirSync(join(args[3], name, 'Contents'), { recursive: true })
      writeFileSync(join(args[3], name, 'which'), 'new')
    }
    if (cmd === 'pgrep' && !opts.previewRunning) throw new Error('exit 1')
    if (cmd === 'open') opened.push(args[0])
    return { stdout: '', stderr: '' }
  }
  const trashed: string[] = []
  const relaunch = vi.fn()
  const deps: UpdaterDeps = {
    build: opts.build ?? STABLE_10,
    arch: 'arm64',
    platform: 'darwin',
    bundlePath: opts.bundle === 'none' ? null : opts.bundle === 'elsewhere' ? elsewhere : own,
    appsDir,
    downloadDir: join(root, 'data', 'updates'),
    fetch,
    exec,
    trash: async (p) => {
      trashed.push(p)
    },
    presenting: () => opts.presenting ?? false,
    backup: async () => {
      calls.push('backup')
      if (opts.backupFails) throw new Error('disk full')
      return { data: join(backupDir, 'data-1.sqlite'), vault: join(backupDir, 'vault-1.sqlite') }
    },
    vaultMetaPath: vaultMeta,
    previewDataDir: join(root, 'preview-data'),
    relaunch,
    changed: () => undefined,
    now: () => new Date('2026-10-02T12:00:00Z')
  }
  return {
    updater: createUpdater(deps),
    deps,
    root,
    appsDir,
    own,
    calls,
    relaunch,
    opened,
    trashed
  }
}

describe('checking for updates', () => {
  it('offers a newer stable version and lists versions being worked on', async () => {
    const { updater } = setup()
    const s = await updater.check()
    expect(s.error).toBeNull()
    expect(s.available).toMatchObject({ tag: 'build-12', number: 12, installable: true })
    expect(s.previews.map((p) => p.tag)).toEqual(['preview-claude-x'])
    expect(s.cannotInstall).toBeNull()
  })

  it('says so, in plain words, when GitHub cannot be reached', async () => {
    const { updater, deps } = setup()
    deps.fetch = async () => {
      throw new Error('ENOTFOUND')
    }
    const s = await createUpdater(deps).check()
    expect(s.error).toMatch(/Could not reach GitHub/)
    expect(s.available).toBeNull()
    expect(updater.status().available).toBeNull()
  })

  it('will not follow a redirect away from GitHub', async () => {
    const { deps } = setup()
    deps.fetch = async () => {
      const res = new Response('[]')
      Object.defineProperty(res, 'url', { value: 'https://evil.example/releases' })
      return res
    }
    expect((await createUpdater(deps).check()).error).toMatch(/Could not reach GitHub/)
  })
})

describe('installing an update', () => {
  it('downloads, checks, backs up, swaps the app in and restarts', async () => {
    const { updater, own, appsDir, calls, relaunch, deps } = setup()
    await updater.check()
    await updater.install()
    expect(readFileSync(join(own, 'which'), 'utf8')).toBe('new')
    // The old copy waits beside it until the next launch, then is removed.
    const aside = readdirSync(appsDir).filter((n) => n.startsWith('.tos-old-'))
    expect(aside).toHaveLength(1)
    expect(readFileSync(join(appsDir, aside[0], 'which'), 'utf8')).toBe('old')
    // The backup comes before anything is moved, and the signature is checked.
    expect(calls.filter((c) => !c.startsWith('fetch'))).toEqual(['backup', 'ditto', 'codesign'])
    expect(relaunch).toHaveBeenCalledOnce()
    expect(existsSync(deps.downloadDir) ? readdirSync(deps.downloadDir) : []).toEqual([])
    await updater.cleanUp()
    expect(readdirSync(appsDir)).toEqual(['Teaching OS.app'])
  })

  it('refuses a download that does not match its checksum, and changes nothing', async () => {
    const { updater, own, calls, relaunch } = setup({ sha256: 'b'.repeat(64) })
    await updater.check()
    await expect(updater.install()).rejects.toThrow(/did not match/)
    expect(readFileSync(join(own, 'which'), 'utf8')).toBe('old')
    expect(calls).not.toContain('backup')
    expect(relaunch).not.toHaveBeenCalled()
    expect(updater.status().task).toBeNull()
  })

  it('installs nothing when the backup fails', async () => {
    const { updater, own, relaunch } = setup({ backupFails: true })
    await updater.check()
    await expect(updater.install()).rejects.toThrow(/backup could not be taken/)
    expect(readFileSync(join(own, 'which'), 'utf8')).toBe('old')
    expect(relaunch).not.toHaveBeenCalled()
  })

  it('refuses while presenting, outside Applications and in a development run', async () => {
    const presenting = setup({ presenting: true })
    await presenting.updater.check()
    await expect(presenting.updater.install()).rejects.toThrow(/End the presentation/)

    const elsewhere = setup({ bundle: 'elsewhere' })
    await elsewhere.updater.check()
    expect(elsewhere.updater.status().cannotInstall).toMatch(/Applications folder/)
    await expect(elsewhere.updater.install()).rejects.toThrow(/Applications folder/)

    const dev = setup({ bundle: 'none' })
    await dev.updater.check()
    expect(dev.updater.status().cannotInstall).toMatch(/development copy/)
    await expect(dev.updater.install()).rejects.toThrow(/development copy/)
  })

  it('has nothing to install when this is the newest version', async () => {
    const { updater } = setup({ build: { ...STABLE_10, number: 12 } })
    await updater.check()
    await expect(updater.install()).rejects.toThrow(/no update/)
  })

  it('finds the app inside a packaged Mac app only', () => {
    expect(
      bundleOf('/Applications/Teaching OS.app/Contents/MacOS/Teaching OS', true, 'darwin')
    ).toBe('/Applications/Teaching OS.app')
    expect(bundleOf('/x/node_modules/electron/dist/electron', false, 'darwin')).toBeNull()
    expect(bundleOf('/opt/teaching-os/teaching-os', true, 'linux')).toBeNull()
  })
})

describe('the Preview', () => {
  it('installs beside the real app, with a copy of the data from fresh backups', async () => {
    const { updater, appsDir, own, opened, deps } = setup()
    await updater.check()
    await updater.tryPreview('preview-claude-x')
    const preview = join(appsDir, 'Teaching OS Preview.app')
    expect(readFileSync(join(preview, 'which'), 'utf8')).toBe('new')
    expect(readFileSync(join(own, 'which'), 'utf8')).toBe('old')
    expect(opened).toEqual([preview])
    const data = deps.previewDataDir
    expect(readFileSync(join(data, 'data.sqlite'), 'utf8')).toBe('public db')
    expect(readFileSync(join(data, 'vault', 'vault.sqlite'), 'utf8')).toBe('vault db')
    expect(readFileSync(join(data, 'vault', 'vault.json'), 'utf8')).toBe('{"hash":"x"}')
    expect(existsSync(join(data, 'backups'))).toBe(false)
    const s = updater.status()
    expect(s.previewInstalled).toBe(true)
    expect(s.previewDataCopiedAt).toBe('2026-10-02T12:00:00.000Z')
  })

  it('asks for the Preview to be quit before replacing it or its data', async () => {
    const { updater } = setup({ previewRunning: true })
    await updater.check()
    await expect(updater.tryPreview('preview-claude-x')).rejects.toThrow(/Quit Teaching OS Preview/)
    await expect(updater.removePreview()).rejects.toThrow(/Quit Teaching OS Preview/)
  })

  it('refuses a version that is no longer listed', async () => {
    const { updater } = setup()
    await updater.check()
    await expect(updater.tryPreview('preview-gone')).rejects.toThrow(/no longer available/)
  })

  it('removes the app to the Trash and deletes its copy of the data', async () => {
    const { updater, appsDir, trashed, deps } = setup()
    await updater.check()
    await updater.tryPreview('preview-claude-x')
    await updater.removePreview()
    expect(trashed).toEqual([join(appsDir, 'Teaching OS Preview.app')])
    expect(existsSync(deps.previewDataDir)).toBe(false)
  })

  it('in the Preview itself: offers newer builds of its branch only, and tries nothing else', async () => {
    const { updater } = setup({
      build: { number: 14, commit: '', channel: 'preview', branch: 'claude/x', date: '' }
    })
    const s = await updater.check()
    expect(s.available?.tag).toBe('preview-claude-x')
    expect(s.previews).toEqual([])
    await expect(updater.tryPreview('preview-claude-x')).rejects.toThrow(/real Teaching OS/)
  })
})
