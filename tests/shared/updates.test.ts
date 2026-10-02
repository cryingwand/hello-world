import { describe, expect, it } from 'vitest'
import { LOCAL_BUILD, buildInfoFromEnv, previewTag, type BuildInfo } from '@shared/build'
import { isUpdateHost, parseReleases, previewsOf, updateFor } from '@shared/updates'
import { SHA, release } from './releaseFixture'

const stable = (number: number): BuildInfo => ({
  number,
  commit: 'c',
  channel: 'stable',
  branch: 'master',
  date: ''
})

describe('build info', () => {
  it('reads CI variables, and anything missing is a local build', () => {
    const now = new Date('2026-10-02T00:00:00Z')
    expect(
      buildInfoFromEnv(
        { TOS_BUILD_NUMBER: '42', TOS_CHANNEL: 'preview', TOS_COMMIT: 'abc', TOS_BRANCH: 'x' },
        now
      )
    ).toEqual({
      number: 42,
      commit: 'abc',
      channel: 'preview',
      branch: 'x',
      date: now.toISOString()
    })
    expect(buildInfoFromEnv({})).toEqual(LOCAL_BUILD)
    expect(buildInfoFromEnv({ TOS_BUILD_NUMBER: '0', TOS_CHANNEL: 'stable' })).toEqual(LOCAL_BUILD)
    expect(buildInfoFromEnv({ TOS_BUILD_NUMBER: '3', TOS_CHANNEL: 'beta' })).toEqual(LOCAL_BUILD)
  })

  it('makes a release tag from any branch name, the same way CI does', () => {
    expect(previewTag('claude/magical-cerf-xfaovl')).toBe('preview-claude-magical-cerf-xfaovl')
    expect(previewTag('Feature/Lesson Planner!')).toBe('preview-feature-lesson-planner')
  })
})

describe('reading releases', () => {
  it('reads builds, their notes and the zip for this Mac', () => {
    const [b] = parseReleases(
      [release({ tag: 'build-7', number: 7, channel: 'stable', notes: ['Fix A', 'Add B'] })],
      'arm64'
    )
    expect(b).toMatchObject({
      tag: 'build-7',
      number: 7,
      channel: 'stable',
      branch: 'master',
      notes: ['Fix A', 'Add B']
    })
    expect(b.asset).toMatchObject({ name: 'Teaching-OS-7-arm64.zip', sha256: SHA, size: 1234 })
  })

  it('has no zip for a processor nothing was built for', () => {
    const [b] = parseReleases([release({ tag: 'build-7', number: 7, channel: 'stable' })], 'x64')
    expect(b.asset).toBeNull()
  })

  it('ignores drafts, releases made by hand, bad checksums and downloads from elsewhere', () => {
    const builds = parseReleases(
      [
        release({ tag: 'build-1', number: 1, channel: 'stable', draft: true }),
        release({ tag: 'manual', number: 2, channel: 'stable', marker: null }),
        release({
          tag: 'build-3',
          number: 3,
          channel: 'stable',
          marker: '<!-- tos-build {oops -->'
        }),
        release({ tag: 'build-4', number: 4, channel: 'stable', sha256: 'not-a-hash' }),
        release({
          tag: 'build-5',
          number: 5,
          channel: 'stable',
          url: 'https://evil.example/x.zip'
        }),
        'nonsense',
        null
      ],
      'arm64'
    )
    expect(builds.map((b) => b.tag)).toEqual(['build-4', 'build-5'])
    expect(builds.every((b) => b.asset === null)).toBe(true)
    expect(parseReleases({ message: 'rate limited' }, 'arm64')).toEqual([])
  })

  it('offers the newest stable build above this one, never a preview', () => {
    const builds = parseReleases(
      [
        release({ tag: 'build-9', number: 9, channel: 'stable' }),
        release({ tag: 'build-12', number: 12, channel: 'stable' }),
        release({ tag: 'preview-x', number: 20, channel: 'preview' })
      ],
      'arm64'
    )
    expect(updateFor(builds, stable(10))?.tag).toBe('build-12')
    expect(updateFor(builds, stable(12))).toBeNull()
    expect(updateFor(builds, LOCAL_BUILD)?.tag).toBe('build-12')
  })

  it('offers a Preview only newer builds of its own branch', () => {
    const builds = parseReleases(
      [
        release({ tag: 'build-30', number: 30, channel: 'stable' }),
        release({ tag: 'preview-claude-a', number: 21, channel: 'preview', branch: 'claude/a' }),
        release({ tag: 'preview-claude-b', number: 25, channel: 'preview', branch: 'claude/b' })
      ],
      'arm64'
    )
    const me: BuildInfo = {
      number: 20,
      commit: '',
      channel: 'preview',
      branch: 'claude/a',
      date: ''
    }
    expect(updateFor(builds, me)?.tag).toBe('preview-claude-a')
    expect(updateFor(builds, { ...me, number: 21 })).toBeNull()
    expect(previewsOf(builds).map((b) => b.tag)).toEqual(['preview-claude-b', 'preview-claude-a'])
  })

  it('talks only to GitHub, over https', () => {
    expect(isUpdateHost('https://api.github.com/repos/x')).toBe(true)
    expect(isUpdateHost('https://github.com/x/releases/download/a.zip')).toBe(true)
    expect(isUpdateHost('https://objects.githubusercontent.com/a')).toBe(true)
    expect(isUpdateHost('https://release-assets.githubusercontent.com/a')).toBe(true)
    expect(isUpdateHost('http://github.com/x')).toBe(false)
    expect(isUpdateHost('https://github.com.evil.example/x')).toBe(false)
    expect(isUpdateHost('https://evilgithubusercontent.com/x')).toBe(false)
    expect(isUpdateHost('not a url')).toBe(false)
  })
})
