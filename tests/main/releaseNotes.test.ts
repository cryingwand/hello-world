import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseReleases } from '../../src/shared/updates'

const SCRIPT = resolve(__dirname, '../../scripts/release-notes.mjs')

describe('the release notes CI writes', () => {
  it('are read back by the app: notes, number, branch and the checksum of the zip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tos-notes-'))
    try {
      const zip = join(dir, 'Teaching-OS-41-arm64.zip')
      writeFileSync(zip, 'zip bytes')
      const body = execFileSync('node', [SCRIPT, zip], {
        encoding: 'utf8',
        env: {
          ...process.env,
          TOS_BUILD_NUMBER: '41',
          TOS_CHANNEL: 'preview',
          TOS_COMMIT: 'abc',
          TOS_BRANCH: 'claude/a "quoted" branch'
        }
      })
      const arch = process.arch
      const [b] = parseReleases(
        [
          {
            tag_name: 'preview-x',
            name: 'Preview',
            body,
            assets: [
              {
                name: 'Teaching-OS-41-arm64.zip',
                size: 9,
                browser_download_url:
                  'https://github.com/cryingwand/hello-world/releases/download/x/a.zip'
              }
            ]
          }
        ],
        arch
      )
      expect(b).toMatchObject({
        number: 41,
        channel: 'preview',
        branch: 'claude/a "quoted" branch'
      })
      expect(b.notes.length).toBeGreaterThan(0)
      expect(b.asset?.sha256).toBe(createHash('sha256').update('zip bytes').digest('hex'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
