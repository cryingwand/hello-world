import { describe, expect, it } from 'vitest'
import { MAX_STAGE_ITEMS, STAGE_KINDS, isStageKind, stageKeyAction, stageUrl } from '@shared/stage'

describe('stage keys', () => {
  const key = (
    k: string,
    extra: object = {},
    kind: 'pdf' | 'image' | 'docx' | 'text' | null = 'image'
  ) => stageKeyAction({ key: k, ...extra }, kind)

  it('escape ends, B or . blanks', () => {
    expect(key('Escape')).toBe('end')
    expect(key('Escape', {}, 'pdf')).toBe('end')
    for (const k of ['b', 'B', '.']) expect(key(k)).toBe('blank')
    expect(key('b', { meta: true })).toBeNull() // Cmd+B is not ours
    expect(key('b', { control: true })).toBeNull()
  })

  it('brackets and Ctrl/Cmd-arrows move between files, whatever is showing', () => {
    for (const kind of ['pdf', 'image', 'docx', 'text', null] as const) {
      expect(key(']', {}, kind)).toBe('next')
      expect(key('[', {}, kind)).toBe('previous')
      expect(key('ArrowRight', { control: true }, kind)).toBe('next')
      expect(key('ArrowLeft', { meta: true }, kind)).toBe('previous')
    }
  })

  it('arrows, space and page keys move between files unless a PDF is showing', () => {
    for (const k of ['ArrowRight', 'ArrowDown', 'PageDown', ' ']) {
      expect(key(k, {}, 'image')).toBe('next')
      expect(key(k, {}, 'text')).toBe('next')
      expect(key(k, {}, 'pdf')).toBeNull() // the PDF viewer keeps them for paging
    }
    for (const k of ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']) {
      expect(key(k, {}, 'docx')).toBe('previous')
      expect(key(k, {}, 'pdf')).toBeNull()
    }
  })

  it('leaves everything else to the page, and never claims Alt combinations', () => {
    expect(key('a')).toBeNull()
    expect(key('Enter')).toBeNull()
    expect(key('Escape', { alt: true })).toBeNull()
    expect(key(']', { alt: true })).toBeNull()
    expect(key('ArrowRight', { meta: true, alt: true })).toBeNull()
  })
})

describe('stage kinds', () => {
  it('shows PDFs, images, Word and text, and nothing that needs another app', () => {
    expect([...STAGE_KINDS]).toEqual(['pdf', 'image', 'docx', 'text'])
    for (const k of ['pptx', 'spreadsheet', 'rtf', 'other'] as const)
      expect(isStageKind(k)).toBe(false)
  })

  it('addresses files by index, never by path', () => {
    expect(stageUrl(3, 1700000000123.9)).toBe('tos-file://stage/3?v=1700000000123')
    expect(stageUrl(0, 5)).not.toContain('/Users')
    expect(MAX_STAGE_ITEMS).toBeGreaterThan(10)
  })
})
