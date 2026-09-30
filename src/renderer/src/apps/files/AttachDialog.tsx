import { useState } from 'react'
import { baseName } from '@shared/files'
import Modal from '@renderer/components/Modal'
import RecordPicker, { type RecordRef } from './RecordPicker'

export default function AttachDialog({
  path,
  onClose,
  onAttached
}: {
  path: string
  onClose: () => void
  onAttached: (message: string) => void
}): React.JSX.Element {
  const [target, setTarget] = useState<RecordRef | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const attach = async (): Promise<void> => {
    if (!target) return
    setSaving(true)
    try {
      await window.api.fileLinks.add({ path, ...target })
      onAttached(`Attached ${baseName(path)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Attach ${baseName(path)}`}
      error={error}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!target || saving} onClick={attach}>
            Attach
          </button>
        </>
      }
    >
      <p className="hint">
        Attach this file to a class or a student so you can find it again from their record.
      </p>
      <RecordPicker value={target} onChange={setTarget} />
    </Modal>
  )
}
