import { useState } from 'react'
import type { Question, QuestionKind } from '@shared/models'
import { MAX_CHOICES, MIN_CHOICES, QUESTION_KINDS, kindLabel } from '@shared/quiz'
import Modal from '@renderer/components/Modal'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Add a question to the bank, or edit one. Used from the bank and from inside a quiz. */
export default function QuestionForm({
  question,
  onClose,
  onSaved
}: {
  question?: Question
  onClose: () => void
  /** Called after a new question is saved, so the caller can add it somewhere. */
  onSaved?: (question: Question) => void
}): React.JSX.Element {
  const [kind, setKind] = useState<QuestionKind>(question?.kind ?? 'multiple-choice')
  const [prompt, setPrompt] = useState(question?.prompt ?? '')
  // Kept per kind, so switching to true/false and back does not lose what was typed.
  const [choices, setChoices] = useState<string[]>(
    question?.kind === 'multiple-choice' ? question.choices : ['', '', '', '']
  )
  const [correct, setCorrect] = useState<number | null>(question?.correctChoice ?? null)
  const [answer, setAnswer] = useState(question?.answer ?? '')
  const [points, setPoints] = useState(String(question?.points ?? 1))
  const [tags, setTags] = useState((question?.tags ?? []).join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choiceKind = kind === 'multiple-choice' || kind === 'true-false'
  const updateChoice = (i: number, text: string): void =>
    setChoices((cs) => cs.map((c, j) => (j === i ? text : c)))
  const removeChoice = (i: number): void => {
    setChoices((cs) => cs.filter((_, j) => j !== i))
    setCorrect((c) => (c === null || c === i ? null : c > i ? c - 1 : c))
  }
  const pickKind = (next: QuestionKind): void => {
    setKind(next)
    // A right answer for one kind means nothing for another, so it must be chosen again.
    if (next === 'true-false' && (correct === null || correct > 1)) setCorrect(null)
  }

  const input = () => {
    let sent = choices
    let right = correct
    if (kind === 'multiple-choice') {
      // Blank rows are left out, and the right answer follows its text to its new place.
      const keep = choices.map((c, i) => ({ c: c.trim(), i })).filter((x) => x.c !== '')
      sent = keep.map((x) => x.c)
      right = correct === null ? null : keep.findIndex((x) => x.i === correct)
      if (right === -1) right = null
    }
    return {
      kind,
      prompt,
      choices: kind === 'multiple-choice' ? sent : undefined,
      correctChoice: choiceKind ? right : null,
      answer: choiceKind ? '' : answer,
      points: Number(points),
      tags: tags.split(',')
    }
  }

  const save = async (andAnother: boolean): Promise<void> => {
    if (points.trim() === '' || Number.isNaN(Number(points))) {
      setError('Points must be a number')
      return
    }
    setSaving(true)
    try {
      if (question) {
        await window.api.questions.update(question.id, input())
        onClose()
      } else {
        const made = await window.api.questions.create(input())
        onSaved?.(made)
        if (andAnother) {
          setPrompt('')
          setChoices(['', '', '', ''])
          setCorrect(null)
          setAnswer('')
          setError(null)
          setSaving(false)
        } else {
          onClose()
        }
      }
    } catch (e) {
      setError(msg(e))
      setSaving(false)
    }
  }
  const remove = async (): Promise<void> => {
    if (!question || !window.confirm('Delete this question from the bank?')) return
    try {
      await window.api.questions.delete(question.id)
      onClose()
    } catch (e) {
      setError(msg(e))
    }
  }

  return (
    <Modal
      title={question ? 'Edit question' : 'New question'}
      error={error}
      onClose={onClose}
      footer={
        <>
          {question && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {!question && (
            <button type="button" className="btn" disabled={saving} onClick={() => save(true)}>
              Save and add another
            </button>
          )}
          <button type="submit" form="question-form" className="btn btn-primary" disabled={saving}>
            Save
          </button>
        </>
      }
    >
      <form
        id="question-form"
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void save(false)
        }}
      >
        {question && question.quizCount > 0 && (
          <p className="hint">
            This question is in {question.quizCount} {question.quizCount === 1 ? 'quiz' : 'quizzes'}
            . Changes show up in them too.
          </p>
        )}
        <label>
          Kind
          <select value={kind} onChange={(e) => pickKind(e.target.value as QuestionKind)}>
            {QUESTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Question
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
            required
          />
        </label>

        {kind === 'multiple-choice' && (
          <fieldset>
            <legend>Choices (mark the correct one)</legend>
            <div className="qf-choices">
              {choices.map((c, i) => (
                <div key={i} className="qf-choice">
                  <input
                    type="radio"
                    name="correct"
                    checked={correct === i}
                    onChange={() => setCorrect(i)}
                    aria-label={`Choice ${i + 1} is correct`}
                  />
                  <input
                    value={c}
                    onChange={(e) => updateChoice(i, e.target.value)}
                    aria-label={`Choice ${i + 1}`}
                  />
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={choices.length <= MIN_CHOICES}
                    onClick={() => removeChoice(i)}
                    aria-label={`Remove choice ${i + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn"
              disabled={choices.length >= MAX_CHOICES}
              onClick={() => setChoices((cs) => [...cs, ''])}
            >
              + Choice
            </button>
          </fieldset>
        )}

        {kind === 'true-false' && (
          <fieldset>
            <legend>Correct answer</legend>
            <div className="qf-choices">
              {['True', 'False'].map((label, i) => (
                <label key={label} className="check">
                  <input
                    type="radio"
                    name="correct"
                    checked={correct === i}
                    onChange={() => setCorrect(i)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {!choiceKind && (
          <label>
            Model answer or marking notes (answer key only)
            <textarea rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </label>
        )}

        <div className="form-row">
          <label>
            Points
            <input
              type="number"
              min={0}
              step="any"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
          </label>
          <label>
            Tags (separate with commas)
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
        </div>
      </form>
    </Modal>
  )
}
