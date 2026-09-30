import { execFile } from 'node:child_process'

export interface ExecResult {
  stdout: string
  stderr: string
}

export type Exec = (
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number; maxBuffer?: number }
) => Promise<ExecResult>

/**
 * Runs a program without a shell, so file names and search text can never be interpreted as commands.
 * `TEACHING_OS_BIN_<NAME>` swaps in a different executable; the automated UI tests use it to stand in
 * for mdfind, open and osascript on a machine that is not a Mac.
 */
export const defaultExec: Exec = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const bin = process.env[`TEACHING_OS_BIN_${cmd.toUpperCase()}`] ?? cmd
    execFile(
      bin,
      args,
      {
        timeout: opts?.timeoutMs ?? 15_000,
        maxBuffer: opts?.maxBuffer ?? 16 * 1024 * 1024,
        encoding: 'utf8'
      },
      (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stdout, stderr }))
        else resolve({ stdout, stderr })
      }
    )
  })

/** Spotlight, `open -a` and System Events exist only on macOS (or under the test override). */
export const isMac = (): boolean =>
  process.platform === 'darwin' || process.env['TEACHING_OS_FORCE_MAC'] === '1'
