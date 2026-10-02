import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Stage is the one window the audience sees, so its look is held to a few hard rules
 * (docs/design/carrel-handoff.md): its own colours come from tokens (no hex, no accent), its text is
 * sized in viewport units from the --stage-* tokens, never px, and nothing animates but a fade.
 */
const css = readFileSync(
  join(__dirname, '..', '..', 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '')

// The Presenter's own controls (in the launcher) share the `.stage-` prefix; they are not the Stage.
const LAUNCHER_ONLY = /^\.stage-(status|controls)\b/

const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), body: m[2] }))
  .filter((r) => /^\.stage\b/.test(r.selector) && !LAUNCHER_ONLY.test(r.selector))

describe("the Stage's styles", () => {
  it('finds the Stage rules', () => {
    expect(rules.length).toBeGreaterThan(8)
  })

  it('use no hex or rgb colours and no accent', () => {
    for (const r of rules) {
      expect(r.body, r.selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(r.body, r.selector).not.toMatch(/\brgba?\(/)
      expect(r.body, r.selector).not.toMatch(/var\(--accent/)
    }
  })

  it('size text in viewport units or --stage-* tokens, never px', () => {
    for (const r of rules) {
      const sizes = [...r.body.matchAll(/(?:^|[;\s])font(?:-size)?\s*:\s*([^;]+)/g)].map(
        (m) => m[1]
      )
      for (const v of sizes) expect(v, `${r.selector}: ${v}`).not.toMatch(/\d\s*px/)
    }
  })

  it('use Palatino (the serif token) and nothing else', () => {
    for (const r of rules) {
      const families = [...r.body.matchAll(/font-family\s*:\s*([^;]+)/g)].map((m) => m[1].trim())
      for (const f of families) expect(f, r.selector).toBe('var(--font-serif)')
    }
  })

  it('do not scale, bounce or flash', () => {
    for (const r of rules) {
      expect(r.body, r.selector).not.toMatch(/transform\s*:/)
      expect(r.body, r.selector).not.toMatch(/steps\(/)
    }
    expect(css).not.toContain('stage-pop')
  })
})
