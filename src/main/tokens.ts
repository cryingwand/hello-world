import { randomUUID } from 'node:crypto'
import { ValidationError } from './validate'

/**
 * Hands out opaque tokens for files the user picked, so the renderer never handles a path it did
 * not get from the main process. The oldest are forgotten so the map cannot grow without bound.
 */
export function createTokenStore(max = 20) {
  const files = new Map<string, string>()
  return {
    remember(path: string): string {
      const token = randomUUID()
      files.set(token, path)
      if (files.size > max) files.delete(files.keys().next().value as string)
      return token
    },
    get(token: unknown): string {
      const p = typeof token === 'string' ? files.get(token) : undefined
      if (!p) throw new ValidationError('That file is no longer open. Choose it again.')
      return p
    }
  }
}

export type TokenStore = ReturnType<typeof createTokenStore>
