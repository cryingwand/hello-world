import { describe, expect, it } from 'vitest'
import { formatDate, isOverdue, localToday, meetingSummaryText } from '@shared/advising'

describe('isOverdue', () => {
  it('is overdue only after the due date, never for an undated item', () => {
    expect(isOverdue('2026-10-01', '2026-10-02')).toBe(true)
    expect(isOverdue('2026-10-01', '2026-10-01')).toBe(false)
    expect(isOverdue('2026-10-02', '2026-10-01')).toBe(false)
    expect(isOverdue(null, '2026-10-01')).toBe(false)
  })
})

describe('formatDate', () => {
  it('writes a plain date out, and passes anything else through', () => {
    expect(formatDate('2026-10-01')).toBe('Oct 1, 2026')
    expect(formatDate('2026-12-31')).toBe('Dec 31, 2026')
    expect(formatDate(null)).toBe('')
    expect(formatDate('2026-13-01')).toBe('2026-13-01')
    expect(formatDate('next week')).toBe('next week')
  })
})

describe('meetingSummaryText', () => {
  const meeting = {
    metOn: '2026-10-01',
    topic: 'Course selection',
    notes: 'rough notes',
    summary: 'Chose Bio and Chem.'
  }

  it('lays out who, when, the summary and each side of the follow-ups', () => {
    const text = meetingSummaryText('Ada Lovelace', meeting, [
      { title: 'Email the registrar', dueDate: '2026-10-08', owner: 'student' },
      { title: 'Check prerequisites', dueDate: null, owner: 'me' }
    ])
    expect(text).toBe(
      [
        'Advising meeting with Ada Lovelace',
        'Oct 1, 2026',
        'Topic: Course selection',
        '',
        'Chose Bio and Chem.',
        '',
        'Next steps for the student:',
        '- Email the registrar (by Oct 8, 2026)',
        '',
        'Next steps for me:',
        '- Check prerequisites'
      ].join('\n')
    )
  })

  it('falls back to the notes when there is no summary, and omits empty sections', () => {
    const text = meetingSummaryText('Ada', { ...meeting, topic: '', summary: '  ' }, [])
    expect(text).toBe(['Advising meeting with Ada', 'Oct 1, 2026', '', 'rough notes'].join('\n'))
  })
})

describe('localToday', () => {
  it('formats the local date with zero padding', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(localToday(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31')
  })
})
