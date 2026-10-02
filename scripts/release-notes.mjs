#!/usr/bin/env node
// Writes the body of a published build's GitHub release: what changed, one "- " line per commit, then
// the marker line the in-app updater reads (src/shared/updates.ts). CI runs it after packaging:
//
//   node scripts/release-notes.mjs <zip> > notes.md
//
// It reads TOS_BUILD_NUMBER, TOS_COMMIT, TOS_CHANNEL and TOS_BRANCH. For a stable build the notes are
// the commits since the last published one; for a preview, the branch's commits not yet on master.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'

const zip = process.argv[2]
if (!zip) {
  console.error('Usage: node scripts/release-notes.mjs <zip>')
  process.exit(1)
}
const env = process.env
const channel = env.TOS_CHANNEL
if (channel !== 'stable' && channel !== 'preview') {
  console.error('TOS_CHANNEL must be stable or preview')
  process.exit(1)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const tryGit = (...args) => {
  try {
    return git(...args)
  } catch {
    return ''
  }
}

const since =
  channel === 'stable'
    ? tryGit('tag', '--list', 'build-*', '--sort=-v:refname').split('\n')[0]
    : tryGit('rev-parse', '--verify', '--quiet', 'origin/master') && 'origin/master'
const range = since ? [`${since}..HEAD`] : ['-n', '10', 'HEAD']
const subjects = tryGit('log', '--no-merges', '--format=%s', ...range)
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s !== '')
  .slice(0, 30)

const bytes = readFileSync(zip)
const marker = {
  number: Number(env.TOS_BUILD_NUMBER),
  commit: env.TOS_COMMIT ?? '',
  channel,
  branch: env.TOS_BRANCH ?? '',
  date: new Date().toISOString(),
  assets: {
    [process.arch]: {
      name: basename(zip),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: statSync(zip).size
    }
  }
}

const lines = subjects.length > 0 ? subjects.map((s) => `- ${s}`) : ['- Small fixes']
process.stdout.write(`${lines.join('\n')}\n\n<!-- tos-build ${JSON.stringify(marker)} -->\n`)
