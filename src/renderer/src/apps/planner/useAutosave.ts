import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Text fields that save themselves: a moment after typing stops, when the field is left, and when the
 * editor goes away (so closing the window or switching lessons never drops what was just typed). Only
 * the fields that differ from what is saved are sent. A refused save puts the saved text back, so the
 * screen never claims something the database does not have.
 */
export function useAutosave<T extends Record<string, string>>(
  saved: T,
  save: (patch: Partial<T>) => Promise<unknown>,
  onError: (e: unknown) => void,
  delay = 800
): {
  draft: T
  set: (field: keyof T, value: string) => void
  /** Saves what has not been saved. Resolves once that save, and any already on its way, has landed. */
  flush: () => Promise<void>
} {
  const [draft, setDraft] = useState<T>(saved)
  const draftRef = useRef(draft)
  const savedRef = useRef(saved)
  const saveRef = useRef(save)
  const errorRef = useRef(onError)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inflight = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    savedRef.current = saved
    saveRef.current = save
    errorRef.current = onError
  })

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current)
    const patch: Partial<T> = {}
    for (const key of Object.keys(draftRef.current) as (keyof T)[]) {
      if (draftRef.current[key] !== savedRef.current[key]) patch[key] = draftRef.current[key]
    }
    if (Object.keys(patch).length === 0) return inflight.current
    const sent = saveRef.current(patch).then(
      () => undefined,
      (e: unknown) => {
        errorRef.current(e)
        draftRef.current = savedRef.current
        setDraft(savedRef.current)
      }
    )
    // Anything that waits on this waits for the saves before it too, so a copy never misses an edit.
    inflight.current = Promise.all([inflight.current, sent]).then(() => undefined)
    return inflight.current
  }, [])

  const set = useCallback(
    (field: keyof T, value: string) => {
      const next = { ...draftRef.current, [field]: value }
      draftRef.current = next
      setDraft(next)
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, delay)
    },
    [delay, flush]
  )

  useEffect(() => () => void flush(), [flush])

  return { draft, set, flush }
}
