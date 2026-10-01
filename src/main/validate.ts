/** Thrown for bad input; the message is safe to show to the user. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function reqStr(v: unknown, field: string, max = 200): string {
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`)
  const t = v.trim()
  if (!t) throw new ValidationError(`${field} is required`)
  if (t.length > max) throw new ValidationError(`${field} is too long`)
  return t
}

export function optStr(v: unknown, field: string, max = 200): string {
  if (v == null) return ''
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`)
  const t = v.trim()
  if (t.length > max) throw new ValidationError(`${field} is too long`)
  return t
}

export function id(v: unknown, field = 'id'): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
    throw new ValidationError(`${field} must be a valid id`)
  }
  return v
}

export function num(v: unknown, field: string, min = 0): number {
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new ValidationError(`${field} must be a number`)
  if (v < min) throw new ValidationError(`${field} must be at least ${min}`)
  return v
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`)
  }
  return v as T
}

/** YYYY-MM-DD or null. */
export function dateOrNull(v: unknown, field: string): string | null {
  if (v == null || v === '') return null
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new ValidationError(`${field} must be a date like 2026-09-30`)
  }
  return v
}

export function tags(v: unknown): string[] {
  if (v == null) return []
  if (!Array.isArray(v)) throw new ValidationError('tags must be a list')
  const out = new Set<string>()
  for (const t of v) {
    if (typeof t !== 'string') throw new ValidationError('tags must be text')
    const clean = t.trim().toLowerCase()
    if (clean) out.add(clean)
  }
  return [...out].sort()
}

/** Escapes LIKE wildcards so user text is matched literally (use with ESCAPE '\'). */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`
}
