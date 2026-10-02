import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = join(__dirname, '..', '..', 'src', 'renderer', 'src')
const read = (name: string): string => readFileSync(join(src, name), 'utf8')

describe('Carrel tokens', () => {
  it('loads carrel.css before the app stylesheet', () => {
    const main = read('main.tsx')
    const carrel = main.indexOf("import './carrel.css'")
    const styles = main.indexOf("import './styles.css'")
    expect(carrel).toBeGreaterThan(-1)
    expect(styles).toBeGreaterThan(carrel)
  })

  it('does not redefine the old colour names outside carrel.css', () => {
    // styles.css loads later at equal specificity, so a value left there would silently beat the
    // token for every space (the Vault's accent included).
    const defined = read('styles.css').match(
      /^\s*--(bg|panel|panel-2|line|text|muted|accent)\s*:/gm
    )
    expect(defined).toBeNull()
  })

  it('selects the space and theme from the role the main process decided', () => {
    const main = read('main.tsx')
    expect(main).toContain('window.api.role')
    expect(main).toContain('dataset.space')
    expect(main).toContain('dataset.theme')
  })
})
