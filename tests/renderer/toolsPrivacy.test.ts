import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The In-class Tools run in the launcher, which can be on the projector, and work from names the teacher
 * pasted in. The promise is that those names stay in memory. This scans the app's own source for anything
 * that could keep or send them, so adding one is a failing test rather than a quiet leak.
 */
const dir = join(process.cwd(), 'src/renderer/src/apps/tools')
const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f))

const FORBIDDEN: [RegExp, string][] = [
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bindexedDB\b/, 'indexedDB'],
  // Only the read-only, names-only roster copy may be called; every other method is off limits.
  [
    /\bwindow\.api\b(?!\.directory\.(?:classes|students)\()/,
    'window.api other than directory.classes/students'
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

  it('can only reach the roster through the read-only names copy', () => {
    const all = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
    const calls = [...all.matchAll(/window\.api\.(\w+)\.(\w+)/g)].map((m) => `${m[1]}.${m[2]}`)
    expect(new Set(calls)).toEqual(new Set(['directory.classes', 'directory.students']))
  })

  it('lives in the launcher, which cannot reach vault data', async () => {
    const manifest = readFileSync(join(dir, 'manifest.ts'), 'utf8')
    expect(manifest).toMatch(/space:\s*'launcher'/)
  })
})
