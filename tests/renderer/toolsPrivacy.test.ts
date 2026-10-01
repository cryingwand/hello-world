import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The In-class Tools run in the launcher, which can be on the projector, and work from names the teacher
 * pasted in. The promise is that those names stay in memory. This scans the app's own source for anything
 * that could keep or send them, so adding one is a failing test rather than a quiet leak. The one way out
 * is to the Stage, on the teacher's say-so, and only through `stageLink.ts`.
 */
const STAGE_LINK = 'stageLink.ts'
const STAGE_CALLS = ['stage.state', 'stage.showTool', 'stage.setTimer', 'onStageState']
const dir = join(process.cwd(), 'src/renderer/src/apps/tools')
const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f))

const FORBIDDEN: [RegExp, string][] = [
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bindexedDB\b/, 'indexedDB'],
  // Only the read-only, names-only roster copy, and the Stage calls in stageLink.ts (checked below).
  [
    /\bwindow\.api\b(?!\.directory\.(?:classes|students)\(|\.stage\.(?:state|showTool|setTimer)\(|\.onStageState\()/,
    'window.api other than directory.classes/students and the Stage link'
  ],
  [/\bfetch\s*\(/, 'fetch'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bsendBeacon\b/, 'sendBeacon'],
  [/\bdocument\.cookie\b/, 'cookies'],
  [/\bconsole\.(log|info|warn|error|debug)\b/, 'console output']
]

describe('In-class Tools keep names in memory only', () => {
  it('finds the app files it is meant to scan', () => {
    expect(files).toEqual(expect.arrayContaining(['ToolsApp.tsx', 'namesStore.ts', 'manifest.ts']))
  })

  for (const file of files.length > 0 ? files : ['(none)']) {
    it(`${file} uses no storage, network, console or data API beyond the roster copy`, () => {
      const source = readFileSync(join(dir, file), 'utf8')
        // Comments may talk about these things; only code is checked.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      for (const [pattern, name] of FORBIDDEN) {
        expect(pattern.test(source), `${file} must not use ${name}`).toBe(false)
      }
    })
  }

  const callsIn = (file: string): string[] =>
    [...readFileSync(join(dir, file), 'utf8').matchAll(/window\.api\.(\w+)(?:\.(\w+))?/g)].map(
      (m) => (m[2] ? `${m[1]}.${m[2]}` : m[1])
    )

  it('can only reach the roster through the read-only names copy', () => {
    const calls = files.filter((f) => f !== STAGE_LINK).flatMap(callsIn)
    expect(new Set(calls)).toEqual(new Set(['directory.classes', 'directory.students']))
  })

  it('sends names only to the Stage, and only from stageLink.ts', () => {
    expect(files).toContain(STAGE_LINK)
    expect(new Set(callsIn(STAGE_LINK))).toEqual(new Set(STAGE_CALLS))
  })

  it('lives in the launcher, which cannot reach vault data', async () => {
    const manifest = readFileSync(join(dir, 'manifest.ts'), 'utf8')
    expect(manifest).toMatch(/space:\s*'launcher'/)
  })
})
