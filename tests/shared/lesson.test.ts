import { describe, expect, it } from 'vitest'
import { chunkBullets, linesOf } from '@shared/lesson'

describe('linesOf', () => {
  it('keeps one entry per non-blank line, trimmed', () => {
    expect(linesOf('  Warm-up \n\n\nDiscuss  \r\nExit ticket\n')).toEqual([
      'Warm-up',
      'Discuss',
      'Exit ticket'
    ])
  })

  it('drops list markers that were typed, since the slide adds its own bullet', () => {
    expect(linesOf('- one\n* two\n• three\n1. four\n2) five\n10. six')).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
      'six'
    ])
  })

  it('leaves a number or dash that is part of the text', () => {
    expect(linesOf('2026 plan\n-5 degrees\nRead 1. Kings\n3.14 is pi')).toEqual([
      '2026 plan',
      '-5 degrees',
      'Read 1. Kings',
      '3.14 is pi'
    ])
  })

  it('is empty for blank text', () => {
    expect(linesOf('')).toEqual([])
    expect(linesOf(' \n \n')).toEqual([])
  })
})

describe('chunkBullets', () => {
  const lines = (n: number): string[] => Array.from({ length: n }, (_, i) => `step ${i + 1}`)

  it('keeps a short list on one slide', () => {
    expect(chunkBullets(lines(3))).toEqual([lines(3)])
  })

  it('moves to a new slide when the budget is used, keeping the order', () => {
    const out = chunkBullets(lines(10), 4)
    expect(out.map((s) => s.length)).toEqual([4, 4, 2])
    expect(out.flat()).toEqual(lines(10))
  })

  it('counts a long bullet as several lines', () => {
    const long = 'x'.repeat(150) // wraps onto three lines at 70 characters
    expect(chunkBullets([long, 'a', 'b'], 4, 70)).toEqual([[long, 'a'], ['b']])
  })

  it('gives a bullet that is too long for any slide a slide of its own', () => {
    const huge = 'y'.repeat(2000)
    expect(chunkBullets(['a', huge, 'b'], 4, 70)).toEqual([['a'], [huge], ['b']])
  })

  it('has no slides for no bullets', () => {
    expect(chunkBullets([])).toEqual([])
  })
})
