/** Releases shaped like the GitHub API's answer, with the marker line CI writes. */
export const SHA = 'a'.repeat(64)

/** A release as the GitHub API returns it, with CI's marker line. */
export function release(opts: {
  tag: string
  number: number
  channel: 'stable' | 'preview'
  branch?: string
  notes?: string[]
  arch?: string
  sha256?: string
  url?: string
  marker?: string | null
  draft?: boolean
}): Record<string, unknown> {
  const arch = opts.arch ?? 'arm64'
  const name = `Teaching-OS-${opts.number}-${arch}.zip`
  const marker =
    opts.marker === undefined
      ? `<!-- tos-build ${JSON.stringify({
          number: opts.number,
          commit: 'abc123',
          channel: opts.channel,
          branch: opts.branch ?? (opts.channel === 'stable' ? 'master' : 'claude/x'),
          date: '2026-10-02T10:00:00Z',
          assets: { [arch]: { name, sha256: opts.sha256 ?? SHA, size: 1000 } }
        })} -->`
      : (opts.marker ?? '')
  return {
    tag_name: opts.tag,
    name: opts.tag,
    draft: opts.draft ?? false,
    prerelease: opts.channel === 'preview',
    published_at: '2026-10-02T10:05:00Z',
    body: [...(opts.notes ?? ['One change']).map((n) => `- ${n}`), '', marker].join('\n'),
    assets: [
      {
        name,
        size: 1234,
        browser_download_url:
          opts.url ??
          `https://github.com/cryingwand/hello-world/releases/download/${opts.tag}/${name}`
      }
    ]
  }
}
