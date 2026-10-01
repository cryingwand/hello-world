import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { MIN_PASSCODE_LENGTH } from '@shared/vault'

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>

export interface ScryptParams {
  N: number
  r: number
  p: number
  keylen: number
}

/** About 100 ms and 32 MB on a current Mac: slow enough to blunt guessing, fast enough to unlock. */
export const DEFAULT_SCRYPT: ScryptParams = { N: 1 << 15, r: 8, p: 1, keylen: 32 }

export interface PasscodeRecord {
  v: 1
  salt: string
  hash: string
  params: ScryptParams
}

const derive = (passcode: string, salt: Buffer, p: ScryptParams): Promise<Buffer> =>
  scrypt(passcode.normalize('NFKC'), salt, p.keylen, {
    N: p.N,
    r: p.r,
    p: p.p,
    maxmem: 128 * p.N * p.r * 2
  })

/** Only a salted scrypt hash is ever stored, never the passcode. */
export async function hashPasscode(
  passcode: string,
  params: ScryptParams = DEFAULT_SCRYPT
): Promise<PasscodeRecord> {
  const salt = randomBytes(16)
  const hash = await derive(passcode, salt, params)
  return { v: 1, salt: salt.toString('base64'), hash: hash.toString('base64'), params }
}

/** Constant-time comparison. A malformed record never verifies. */
export async function verifyPasscode(passcode: string, record: PasscodeRecord): Promise<boolean> {
  try {
    if (record.v !== 1 || typeof record.salt !== 'string' || typeof record.hash !== 'string')
      return false
    const expected = Buffer.from(record.hash, 'base64')
    if (expected.length !== record.params.keylen) return false
    const actual = await derive(passcode, Buffer.from(record.salt, 'base64'), record.params)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/** A user-facing reason the passcode is not acceptable, or null if it is. */
export function passcodeProblem(passcode: unknown): string | null {
  if (typeof passcode !== 'string') return 'Enter a passcode.'
  if (passcode.length < MIN_PASSCODE_LENGTH)
    return `Use at least ${MIN_PASSCODE_LENGTH} characters.`
  if (passcode.length > 200) return 'That passcode is too long.'
  if (/^(.)\1+$/.test(passcode)) return 'Use more than one repeated character.'
  return null
}
