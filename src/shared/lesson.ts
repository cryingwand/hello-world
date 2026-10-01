/** Most lessons one unit may hold. */
export const MAX_LESSONS = 500

/** Lessons shown under "Coming up". */
export const UPCOMING_LIMIT = 30

/**
 * The non-blank lines of a typed block, trimmed. A list marker the teacher typed ("- ", "1. ") is
 * dropped, because the slide adds its own bullet and a typed one would show twice.
 */
export function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, '').trim())
    .filter((l) => l !== '')
}

/**
 * Splits bullets over as many slides as they need so none overflows. A slide holds `budget` lines
 * of text; a bullet longer than `perLine` characters wraps, so it counts as more than one. A single
 * bullet too long for a whole slide still gets a slide of its own, since it cannot be cut.
 */
export function chunkBullets(lines: string[], budget = 8, perLine = 70): string[][] {
  const slides: string[][] = []
  let current: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = Math.max(1, Math.ceil(line.length / perLine))
    if (current.length > 0 && used + cost > budget) {
      slides.push(current)
      current = []
      used = 0
    }
    current.push(line)
    used += cost
  }
  if (current.length > 0) slides.push(current)
  return slides
}
