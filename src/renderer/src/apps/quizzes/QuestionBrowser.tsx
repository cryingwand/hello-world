import { useState } from 'react'
import type { QuestionKind, Question } from '@shared/models'
import { QUESTION_KINDS, choiceLetter, kindLabel, pointsLabel } from '@shared/quiz'
import { useApiQuery } from '@renderer/data/hooks'

/** The answer as one line, for scanning the bank without opening each question. */
function answerLine(q: Question): string {
  if (q.correctChoice !== null) {
    return `${choiceLetter(q.correctChoice)}. ${q.choices[q.correctChoice] ?? ''}`
  }
  return q.answer.split(/\r?\n/)[0]
}

/**
 * Search and filter the question bank and list what matches. In `manage` mode a row opens the
 * question; in `pick` mode each row has a checkbox, for adding questions to a quiz.
 */
export default function QuestionBrowser({
  mode,
  excludeIds = [],
  selected,
  onToggle,
  onOpen,
  extra
}: {
  mode: 'manage' | 'pick'
  /** Questions to leave out of the list, for example the ones already in the quiz. */
  excludeIds?: number[]
  selected?: ReadonlySet<number>
  onToggle?: (id: number) => void
  onOpen?: (question: Question) => void
  /** Sits at the end of the filter row, for example a "+ Question" button. */
  extra?: React.ReactNode
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<QuestionKind | ''>('')
  const [tag, setTag] = useState('')

  const found = useApiQuery(
    () =>
      window.api.questions.list({
        search,
        ...(kind ? { kind } : {}),
        ...(tag ? { tag } : {})
      }),
    [search, kind, tag],
    ['questions.changed']
  )
  // Every tag in the bank, not just those in the current results, so a filter can always be changed.
  const everything = useApiQuery(() => window.api.questions.list(), [], ['questions.changed'])
  const tags = [...new Set((everything.data ?? []).flatMap((q) => q.tags))].sort()

  const hidden = new Set(excludeIds)
  const rows = (found.data ?? []).filter((q) => !hidden.has(q.id))
  const filtered = search.trim() !== '' || kind !== '' || tag !== ''

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search questions"
          aria-label="Search questions"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as QuestionKind | '')}
        >
          <option value="">All kinds</option>
          {QUESTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <select aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {extra}
      </div>

      {found.error && <p className="hint">{found.error}</p>}
      {rows.length === 0 && !found.loading ? (
        <p className="hint">
          {filtered
            ? 'No questions match.'
            : mode === 'pick'
              ? 'Every question in the bank is already in this quiz.'
              : 'The question bank is empty. Add a question to start.'}
        </p>
      ) : (
        <ul className="qb-list">
          {rows.map((q) => {
            const answer = answerLine(q)
            const body = (
              <>
                <span className="qb-prompt">{q.prompt}</span>
                <span className="qb-meta">
                  {kindLabel(q.kind)} · {pointsLabel(q.points)}
                  {answer && ` · Answer: ${answer}`}
                  {q.tags.map((t) => (
                    <span key={t} className="badge">
                      {t}
                    </span>
                  ))}
                  {q.quizCount > 0 && (
                    <span className="badge">
                      in {q.quizCount} {q.quizCount === 1 ? 'quiz' : 'quizzes'}
                    </span>
                  )}
                </span>
              </>
            )
            return mode === 'pick' ? (
              <li key={q.id} className="qb-item">
                <label className="qb-pick">
                  <input
                    type="checkbox"
                    checked={selected?.has(q.id) ?? false}
                    onChange={() => onToggle?.(q.id)}
                  />
                  <span className="qb-text">{body}</span>
                </label>
              </li>
            ) : (
              <li key={q.id} className="qb-item">
                <button className="qb-open" onClick={() => onOpen?.(q)}>
                  <span className="qb-text">{body}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
