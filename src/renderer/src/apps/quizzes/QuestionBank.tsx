import { useState } from 'react'
import type { Question } from '@shared/models'
import QuestionBrowser from './QuestionBrowser'
import QuestionForm from './QuestionForm'

/** The whole question bank: search it, add to it, open a question to edit it. */
export default function QuestionBank(): React.JSX.Element {
  const [dialog, setDialog] = useState<{ question?: Question } | null>(null)
  return (
    <section className="pane">
      <div className="pane-head">
        <div>
          <h2>Question bank</h2>
          <div className="hint">Questions you can reuse in any quiz. Open one to edit it.</div>
        </div>
      </div>
      <QuestionBrowser
        mode="manage"
        onOpen={(question) => setDialog({ question })}
        extra={
          <button className="btn btn-primary" onClick={() => setDialog({})}>
            + Question
          </button>
        }
      />
      {dialog && <QuestionForm question={dialog.question} onClose={() => setDialog(null)} />}
    </section>
  )
}
