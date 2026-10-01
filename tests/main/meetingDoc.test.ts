import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import { afterEach, describe, expect, it } from 'vitest'
import { meetingDocx, type MeetingDocInput } from '../../src/main/meetingDoc'
import { createMeetingService } from '../../src/main/meetingService'
import { makeEnv } from './helpers'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tos-meeting-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const input = (over: Partial<MeetingDocInput> = {}): MeetingDocInput => ({
  studentName: 'Priya Abernathy',
  meeting: {
    metOn: '2026-10-02',
    topic: 'Course selection',
    notes: 'Rough notes',
    summary: 'We talked about next year.\n\nShe will think about AP Bio.'
  },
  followUps: [
    { title: 'Email the counselor', dueDate: '2026-10-09', owner: 'student' },
    { title: 'Find a mentor', dueDate: null, owner: 'student' },
    { title: 'Send the reading list', dueDate: '2026-10-05', owner: 'me' }
  ],
  ...over
})

async function open(i: MeetingDocInput) {
  const zip = await JSZip.loadAsync(await meetingDocx(i))
  const xml = await zip.file('word/document.xml')!.async('string')
  const paragraphs = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => ({
    xml: p,
    text: [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')
  }))
  return { xml, paragraphs, text: paragraphs.map((p) => p.text) }
}

describe('meeting Word document', () => {
  it('sets every run in Palatino Linotype 12pt on a Letter page', async () => {
    const { xml } = await open(input())
    const runs = xml.match(/<w:r>[\s\S]*?<\/w:r>/g) ?? []
    expect(runs.length).toBeGreaterThan(5)
    for (const r of runs) {
      expect(r).toContain('w:ascii="Palatino Linotype"')
      expect(r).toContain('<w:sz w:val="24"/>')
    }
    expect(xml).toContain('w:w="12240"') // 8.5in
    expect(xml).toContain('w:h="15840"') // 11in
  })

  it('opens with one centered bold Advising Meeting, name and date line', async () => {
    const { paragraphs } = await open(input())
    expect(paragraphs[0].text).toBe('Advising Meeting • Priya Abernathy • October 2, 2026')
    expect(paragraphs[0].xml).toContain('<w:jc w:val="center"/>')
    expect(paragraphs[0].xml).toContain('<w:b/>')
  })

  it('writes the topic, the summary and the next steps in order', async () => {
    const { text } = await open(input())
    expect(text.filter((t) => t !== '')).toEqual([
      'Advising Meeting • Priya Abernathy • October 2, 2026',
      'Topic: Course selection',
      'Summary',
      'We talked about next year.',
      'She will think about AP Bio.',
      'Next steps for Priya Abernathy',
      'Email the counselor (by Oct 9, 2026)',
      'Find a mentor',
      'Next steps for me',
      'Send the reading list (by Oct 5, 2026)'
    ])
  })

  it('keeps a blank line in the notes as a gap, not as text', async () => {
    const { text } = await open(input())
    expect(text).toContain('')
    expect(text.join('\n')).not.toContain('\n\n\n')
  })

  it('lists next steps as a real Word bullet list', async () => {
    const { paragraphs } = await open(input())
    const bullets = paragraphs.filter((p) => p.xml.includes('<w:numPr>'))
    expect(bullets.map((p) => p.text)).toEqual([
      'Email the counselor (by Oct 9, 2026)',
      'Find a mentor',
      'Send the reading list (by Oct 5, 2026)'
    ])
  })

  it('falls back to the working notes when there is no summary', async () => {
    const { text } = await open(input({ meeting: { ...input().meeting, summary: '  ' } }))
    expect(text).toContain('Notes')
    expect(text).toContain('Rough notes')
    expect(text).not.toContain('Summary')
  })

  it('leaves out sections that are empty', async () => {
    const { text } = await open(
      input({ followUps: [], meeting: { metOn: '2026-10-02', topic: '', notes: '', summary: '' } })
    )
    expect(text.filter((t) => t !== '')).toEqual([
      'Advising Meeting • Priya Abernathy • October 2, 2026'
    ])
  })

  it('reads back as the same words through Word-compatible tools', async () => {
    const dir = tmp()
    const path = join(dir, 'm.docx')
    const buf = await meetingDocx(input())
    writeFileSync(path, buf)
    const { value } = await mammoth.extractRawText({ path })
    expect(value).toContain('Course selection')
    expect(value).toContain('Send the reading list')
  })
})

describe('meeting export service', () => {
  function setup(save: string | null) {
    const env = makeEnv()
    const picked: string[] = []
    const svc = createMeetingService(env.repos, {
      pickSaveFile: async (name) => {
        picked.push(name)
        return save
      }
    })
    const student = env.repos.students.create({
      firstName: 'Priya',
      lastName: 'Abernathy',
      preferredName: 'Pri',
      tags: ['advisee']
    })
    const meeting = env.repos.advising.createMeeting({
      studentId: student.id,
      metOn: '2026-10-02',
      topic: 'Plans',
      summary: 'Went well.'
    })
    return { env, svc, student, meeting, picked }
  }

  it('asks where to save, then writes a .docx with this meeting’s own follow-ups', async () => {
    const dir = tmp()
    const ctx = setup(join(dir, 'out'))
    ctx.env.repos.advising.createAction({
      studentId: ctx.student.id,
      meetingId: ctx.meeting.id,
      title: 'From this meeting'
    })
    ctx.env.repos.advising.createAction({ studentId: ctx.student.id, title: 'Unrelated' })
    const res = await ctx.svc.exportWord(ctx.meeting.id)
    expect(res).toEqual({ path: join(dir, 'out.docx') })
    expect(ctx.picked).toEqual(['2026-10-02 Advising meeting Pri Abernathy.docx'])
    const { value } = await mammoth.extractRawText({ buffer: readFileSync(res!.path) })
    expect(value).toContain('Advising Meeting • Pri Abernathy • October 2, 2026')
    expect(value).toContain('From this meeting')
    expect(value).not.toContain('Unrelated')
  })

  it('writes nothing when the save is cancelled', async () => {
    const ctx = setup(null)
    expect(await ctx.svc.exportWord(ctx.meeting.id)).toBeNull()
  })

  it('refuses a meeting with nothing written in it, or that no longer exists', async () => {
    const ctx = setup(join(tmp(), 'x.docx'))
    const empty = ctx.env.repos.advising.createMeeting({
      studentId: ctx.student.id,
      metOn: '2026-10-03'
    })
    await expect(ctx.svc.exportWord(empty.id)).rejects.toThrow(/notes or a summary/)
    await expect(ctx.svc.exportWord(9999)).rejects.toThrow(/no longer exists/)
    await expect(ctx.svc.exportWord(-1)).rejects.toThrow(/valid id/)
    expect(ctx.picked).toEqual([])
  })
})
