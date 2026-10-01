// Launches the built app and drives it the way a person would, to catch what unit tests cannot: the
// main process wiring, the windows, the preload bridge and every app's first render.
//
//   npx electron-vite build && node scripts/smoke.mjs
//
// It uses a throwaway data folder (TEACHING_OS_DATA_DIR), never your real data. On Linux run it under
// xvfb (`xvfb-run -a node scripts/smoke.mjs`); on a Mac it opens real windows for a few seconds.
// Screenshots go to SMOKE_SHOTS (default: a temp folder) and are kept when a step fails.
// SMOKE_APP_BINARY runs a packaged app instead (for example release/mac-arm64/Teaching OS.app/
// Contents/MacOS/Teaching OS), which also proves the native SQLite module was packaged correctly.
/* global window, document -- the functions passed to evaluate() run inside the app's windows */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const APP = resolve(import.meta.dirname, '..')
const data = mkdtempSync(join(tmpdir(), 'tos-smoke-'))
const shots = process.env.SMOKE_SHOTS ?? join(data, 'shots')
mkdirSync(shots, { recursive: true })
const PASSCODE = 'smoke test passcode'
const LAUNCHER_APPS = ['Files', 'In-class Tools', 'Presenter']
const VAULT_APPS = [
  'Classes & Rosters',
  'Gradebook',
  'Advising',
  'Quizzes & Exams',
  'Lesson Planner',
  'Files',
  'Protected Files'
]

const electronBin =
  process.platform === 'darwin'
    ? join(APP, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : join(APP, 'node_modules/electron/dist/electron')

const problems = []
const watch = (page, name) => {
  page.on('pageerror', (err) => problems.push(`${name}: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`${name} console: ${msg.text()}`)
  })
}

let step = 'launch'
const log = (s) => {
  step = s
  console.log(`- ${s}`)
}
const check = (ok, what) => {
  if (!ok) throw new Error(what)
}

const packaged = process.env.SMOKE_APP_BINARY
const app = await electron.launch({
  executablePath: packaged ?? electronBin,
  args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(packaged ? [] : [APP])],
  env: { ...process.env, TEACHING_OS_DATA_DIR: data },
  timeout: 60_000
})
app.process().stderr.on('data', (d) => {
  for (const line of String(d).split('\n'))
    if (/\[ipc\].*failed|Uncaught|UnhandledPromiseRejection/.test(line))
      problems.push(`main: ${line}`)
})

/** Opens an app from the dock and waits for its window to appear. */
const openApp = async (page, name) => {
  const before = await page.locator('.window').count()
  await page
    .getByRole('navigation', { name: 'Apps' })
    .getByRole('button', { name, exact: true })
    .click()
  await page.waitForFunction((n) => document.querySelectorAll('.window').length > n, before)
}

let current = null
try {
  log('the everyday window opens')
  const launcher = await app.firstWindow()
  current = launcher
  watch(launcher, 'launcher')
  await launcher.getByRole('button', { name: 'Vault' }).waitFor({ timeout: 30_000 })

  log('each everyday app opens')
  for (const name of LAUNCHER_APPS) await openApp(launcher, name)
  await launcher.screenshot({ path: join(shots, '01-launcher.png') })

  log('the Vault opens and a passcode is chosen')
  const openVault = async () => {
    const [win] = await Promise.all([
      app.waitForEvent('window'),
      launcher.getByRole('button', { name: 'Vault' }).click()
    ])
    current = win
    watch(win, 'vault')
    return win
  }
  let vault = await openVault()
  await vault.getByLabel('New passcode').fill(PASSCODE)
  await vault.getByLabel('Repeat the passcode').fill(PASSCODE)
  await vault.locator('button[type=submit]').click()
  await vault.getByRole('button', { name: 'Lock' }).waitFor()

  log('each Vault app opens')
  for (const name of VAULT_APPS) await openApp(vault, name)
  await vault.screenshot({ path: join(shots, '02-vault.png') })

  log('a class made in the Vault reaches the everyday roster copy, names only')
  const classId = await vault.evaluate(async () => {
    const term = await window.api.terms.create({ name: 'Smoke term', isCurrent: true })
    const cls = await window.api.classes.create({
      termId: term.id,
      course: 'SMOKE 101',
      gradingMode: 'points'
    })
    const s = await window.api.students.create({ firstName: 'Ada', lastName: 'Lovelace' })
    await window.api.classes.enroll(cls.id, s.id)
    return cls.id
  })
  const copied = await launcher.evaluate((id) => window.api.directory.students(id), classId)
  check(
    JSON.stringify(copied.map((s) => Object.keys(s).sort())) === '[["id","name"]]' &&
      copied[0].name === 'Ada Lovelace',
    `roster copy was ${JSON.stringify(copied)}`
  )
  check(!('students' in (await launcher.evaluate(() => window.api))), 'launcher can see students')

  log('a delete is backed up first, and the Vault restores from a backup')
  const before = await vault.evaluate(() => window.api.vault.backups())
  await vault.evaluate((id) => window.api.classes.delete(id), classId)
  const after = await vault.evaluate(() => window.api.vault.backups())
  check(after.length === before.length + 1, 'no backup was taken before the delete')
  await vault.getByRole('button', { name: 'Teaching OS' }).click()
  await vault.getByRole('heading', { name: 'Restore the Vault' }).waitFor()
  await vault.screenshot({ path: join(shots, '03-vault-settings.png') })
  vault.on('dialog', (d) => d.accept())
  const closed = vault.waitForEvent('close')
  await vault.getByRole('button', { name: 'Restore…' }).first().click()
  await closed

  log('the Vault opens again on the restored data')
  vault = await openVault()
  await vault.getByLabel('Passcode').fill(PASSCODE)
  await vault.locator('button[type=submit]').click()
  await vault.getByRole('button', { name: 'Lock' }).waitFor()
  const classes = await vault.evaluate(() => window.api.classes.list())
  check(
    classes.some((c) => c.course === 'SMOKE 101'),
    'the deleted class did not come back'
  )

  log('locking closes the Vault window')
  const gone = vault.waitForEvent('close')
  await vault.getByRole('button', { name: 'Lock' }).click()
  await gone
  current = launcher

  check(problems.length === 0, `errors while running:\n  ${problems.join('\n  ')}`)
  console.log('Smoke test passed.')
  await app.close()
  rmSync(data, { recursive: true, force: true })
} catch (err) {
  console.error(`\nSmoke test failed at "${step}": ${err instanceof Error ? err.message : err}`)
  if (problems.length) console.error(`Also seen:\n  ${problems.join('\n  ')}`)
  await current?.screenshot({ path: join(shots, 'failed.png') }).catch(() => undefined)
  console.error(`Screenshots: ${shots} (${readdirSync(shots).join(', ')})`)
  await app.close().catch(() => undefined)
  process.exit(1)
}
