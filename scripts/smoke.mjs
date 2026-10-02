// Launches the built app and drives it the way a person would, to catch what unit tests cannot: the
// main process wiring, the windows, the preload bridge, every app's first render, the canvas desktop,
// the Vault and its backups, the lesson builder, and the Stage with the In-class Tools on it.
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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const APP = resolve(import.meta.dirname, '..')
const data = mkdtempSync(join(tmpdir(), 'tos-smoke-'))
const shots = process.env.SMOKE_SHOTS ?? join(data, 'shots')
mkdirSync(shots, { recursive: true })
const PASSCODE = 'smoke test passcode'
const LAUNCHER_APPS = ['Files', 'Calendar', 'In-class Tools', 'Presenter']

// A pretend home folder, so the folder browser and the desktop never touch real files.
const home = join(data, 'home')
for (const d of ['Desktop', 'Documents/PHIL 101/Week 1', 'Downloads'])
  mkdirSync(join(home, d), { recursive: true })
for (const f of ['Documents/PHIL 101/syllabus.pdf', 'Documents/PHIL 101/notes.md'])
  writeFileSync(join(home, f), 'smoke')
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
// A build stamped as a preview (TOS_CHANNEL=preview at build time) refuses to change the Mac's files
// and calendar, so those steps check the refusal instead.
const previewBuild = process.env.SMOKE_EXPECT_PREVIEW === '1'
const app = await electron.launch({
  executablePath: packaged ?? electronBin,
  args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(packaged ? [] : [APP])],
  env: {
    ...process.env,
    HOME: home,
    TEACHING_OS_DATA_DIR: data,
    // Calendar goes through osascript; a stand-in answers instead, so no permission prompt can block.
    TEACHING_OS_FORCE_MAC: '1',
    TEACHING_OS_BIN_OSASCRIPT: join(APP, 'scripts/fake-osascript.mjs'),
    TOS_FAKE_CALENDAR: join(data, 'calendar.json')
  },
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

/**
 * Presses a key on the Stage the way a keyboard does. Playwright's own key presses skip Electron's
 * before-input-event, which is where the Stage handles its keys, so they would prove nothing.
 */
const stageKey = (keyCode) =>
  app.evaluate(({ BrowserWindow }, code) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle().endsWith('Stage'))
    win?.webContents.sendInputEvent({ type: 'keyDown', keyCode: code })
    // Escape can end the Stage on the way down, closing the window before the key comes up.
    if (win && !win.isDestroyed()) win.webContents.sendInputEvent({ type: 'keyUp', keyCode: code })
  }, keyCode)

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

  log('the desktop canvas zooms out, frames every window and back to 100%')
  const zoomLabel = launcher.getByRole('button', { name: 'Actual size' })
  await launcher.getByRole('button', { name: 'Zoom out' }).click()
  check((await zoomLabel.innerText()) === '80%', `zoomed to ${await zoomLabel.innerText()}`)
  await launcher.getByRole('button', { name: 'Show everything' }).click()
  const framed = await launcher.evaluate(() => {
    const desk = document.querySelector('.desktop').getBoundingClientRect()
    return [...document.querySelectorAll('.window')].every((w) => {
      const r = w.getBoundingClientRect()
      return r.left >= desk.left - 1 && r.right <= desk.right + 1 && r.top >= desk.top - 1
    })
  })
  check(framed, 'Fit left a window off screen')
  await zoomLabel.click()
  check((await zoomLabel.innerText()) === '100%', 'did not go back to 100%')

  log('Files browses folders and moves a file by dragging it onto a folder')
  const files = launcher.locator('.window[data-app=library]')
  await launcher
    .getByRole('navigation', { name: 'Apps' })
    .getByRole('button', { name: 'Files', exact: true })
    .click()
  await files.locator('.place', { hasText: 'Documents' }).click()
  await files.locator('.result-main', { hasText: 'PHIL 101' }).dblclick()
  await files
    .locator('.result-main', { hasText: 'notes.md' })
    .dragTo(files.locator('.result-main', { hasText: 'Week 1' }))
  if (previewBuild) {
    // The Preview's data is a copy, but these are the Mac's real files: the move is refused.
    await files.getByText(/Not in the Preview/).waitFor()
    check(existsSync(join(home, 'Documents/PHIL 101/notes.md')), 'the Preview moved a real file')
  } else {
    await files.locator('.result-main', { hasText: 'notes.md' }).waitFor({ state: 'detached' })
    check(existsSync(join(home, 'Documents/PHIL 101/Week 1/notes.md')), 'notes.md did not move')
  }

  log('a file is pinned to the desktop, and an area is made on the canvas')
  await files.locator('.result-main', { hasText: 'syllabus.pdf' }).click({ button: 'right' })
  await launcher.getByRole('menuitem', { name: 'Pin to desktop' }).click()
  await launcher.locator('.desk-file', { hasText: 'syllabus.pdf' }).waitFor()
  const deskBox = await launcher.locator('.desktop').boundingBox()
  await launcher.mouse.click(deskBox.x + 20, deskBox.y + deskBox.height - 40, { button: 'right' })
  await launcher.getByRole('menuitem', { name: 'New area here' }).click()
  await launcher.getByRole('textbox', { name: 'Area name' }).fill('Monday')
  await launcher.keyboard.press('Enter')
  await launcher.locator('.desk-area-label', { hasText: 'Monday' }).waitFor()
  await launcher.getByRole('button', { name: 'Show everything' }).click()
  await launcher.screenshot({ path: join(shots, '01b-desk.png') })

  log('Calendar shows the week and adds an event through a dialog')
  await launcher
    .getByRole('navigation', { name: 'Apps' })
    .getByRole('button', { name: 'Calendar', exact: true })
    .click()
  const cal = launcher.locator('.window[data-app=calendar]')
  await cal.getByRole('button', { name: '+ Event' }).click()
  await launcher.getByRole('textbox', { name: 'Title' }).fill('Smoke office hours')
  const today = await launcher.evaluate(() => {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })
  const form = launcher.getByRole('dialog', { name: 'New event' })
  await form.getByLabel('Date', { exact: true }).fill(today)
  await form.getByLabel('From', { exact: true }).fill('10:00')
  await form.getByLabel('To', { exact: true }).fill('11:00')
  // A real click: a dialog's buttons must work inside a window on the canvas.
  await launcher.getByRole('button', { name: 'Add', exact: true }).click()
  if (previewBuild) {
    // The Preview works on a copy of the data, but the calendar is the real one: refused.
    await form.getByText(/Not in the Preview/).waitFor()
    await form.getByRole('button', { name: 'Cancel' }).click()
  } else {
    await cal.locator('.cal-event', { hasText: 'Smoke office hours' }).waitFor()
  }

  log('Settings shows this version and where updates come from')
  await launcher.locator('.topbar .brand').click()
  const settings = launcher.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('heading', { name: 'Updates' }).waitFor()
  await settings.getByRole('button', { name: 'Check now' }).waitFor()
  check(
    (await settings.getByRole('heading', { name: 'Try work in progress' }).count()) ===
      (previewBuild ? 0 : 1),
    'the Preview offers other previews, or the real app does not'
  )
  if (previewBuild) {
    check(
      (await launcher.locator('.preview-badge').textContent()).includes('Preview of'),
      'the Preview does not say it is one'
    )
  }
  await settings.getByRole('button', { name: 'Done' }).click()

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

  log('a lesson built from blocks fills the to-do list')
  // Already open: the dock brings it to the front and into view.
  await vault
    .getByRole('navigation', { name: 'Apps' })
    .getByRole('button', { name: 'Lesson Planner', exact: true })
    .click()
  const planner = vault.locator('.window[data-app=planner]')
  await planner.locator('.titlebar').dblclick() // maximized, so nothing is off the edge of the canvas
  // Through the dialog, with a real click: buttons in a dialog over the canvas must work.
  await planner.getByRole('button', { name: '+ Unit' }).click()
  await vault.getByRole('textbox', { name: 'Title' }).fill('Smoke unit')
  await vault.getByRole('button', { name: 'Create', exact: true }).click()
  await planner.locator('.side-item', { hasText: 'Smoke unit' }).waitFor()
  await vault.evaluate(async () => {
    const unit = (await window.api.units.list()).find((u) => u.title === 'Smoke unit')
    await window.api.lessons.create({ unitId: unit.id, title: 'Smoke lesson', classMinutes: 50 })
  })
  await planner.locator('.side-item', { hasText: 'Smoke unit' }).click()
  await planner.locator('.pl-open', { hasText: 'Smoke lesson' }).click()
  await planner.getByRole('button', { name: /^Lecture/ }).click()
  await planner.getByRole('button', { name: /^Reading/ }).click()
  await planner.locator('.block-card').nth(1).waitFor()
  await planner.getByRole('tab', { name: 'To-do' }).click()
  await planner.getByText('Choose the reading').waitFor()
  check(
    (await planner.locator('.todo .task-row').count()) === 3,
    'the to-do list does not hold the prep for a lecture and a reading'
  )
  await vault.screenshot({ path: join(shots, '02-planner-todo.png') })
  await planner.getByRole('tab', { name: 'Units' }).click()

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

  log('the Stage opens, and the In-class Tools put a timer, a pick and groups on it')
  const [stage] = await Promise.all([
    app.waitForEvent('window'),
    launcher.evaluate(() => window.api.stage.start())
  ])
  watch(stage, 'stage')
  const tools = launcher.getByRole('navigation', { name: 'Apps' })
  await tools.getByRole('button', { name: 'In-class Tools', exact: true }).click()
  await launcher.getByRole('tab', { name: 'Timer' }).click()
  await launcher.getByRole('button', { name: 'Show on the Stage' }).click()
  await stage.locator('.stage-timer').waitFor()
  await launcher.getByRole('button', { name: 'Start', exact: true }).click()

  await launcher.getByRole('tab', { name: 'Groups' }).click()
  await launcher
    .getByRole('textbox', { name: /Names, one per line/ })
    .fill('Ada\nBen\nCy\nDi\nEd\nFlo')
  await launcher.getByRole('button', { name: 'Make groups' }).click()
  await launcher.getByRole('button', { name: 'Show on the Stage' }).click()
  await stage.locator('.stage-group').first().waitFor()
  const groups = await stage.locator('.stage-group').count()
  check(groups === 4, `expected 4 groups on the Stage, saw ${groups}`)
  check((await stage.locator('.stage-timer').count()) === 1, 'the timer left the Stage')
  await stage.screenshot({ path: join(shots, '04-stage-groups.png') })

  await launcher.getByRole('tab', { name: 'Picker' }).click()
  await launcher.getByLabel('Show each pick on the Stage').check()
  await launcher.getByRole('button', { name: 'Pick someone' }).click()
  await stage.locator('.stage-pick').waitFor()
  const picked = await stage.locator('.stage-pick').innerText()
  check(['Ada', 'Ben', 'Cy', 'Di', 'Ed', 'Flo'].includes(picked), `picked ${picked}`)
  await stageKey('Escape') // puts the pick away, keeps the Stage
  await stage.locator('.stage-pick').waitFor({ state: 'detached' })
  check(await launcher.evaluate(() => window.api.stage.state().then((s) => s.active)), 'Esc ended')

  const ended = stage.waitForEvent('close')
  await stageKey('Escape')
  await ended
  const stageAfter = await launcher.evaluate(() => window.api.stage.state())
  check(
    !stageAfter.active && !stageAfter.tool && !stageAfter.timer,
    'the Stage kept tools after ending'
  )

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
