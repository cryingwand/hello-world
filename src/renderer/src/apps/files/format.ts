import { dirName } from '@shared/files'

/** The last two folders are enough to tell two "Unit 3.pdf" files apart at a glance. */
export function shortDir(path: string): string {
  const parts = dirName(path).split('/').filter(Boolean)
  return parts.length <= 2 ? `/${parts.join('/')}` : `…/${parts.slice(-2).join('/')}`
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const when = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
