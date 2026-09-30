import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ChangeName } from '@shared/events'

/** Runs `callback` whenever the main process reports one of the named changes. */
export function useChangeEvent(
  names: readonly ChangeName[],
  callback: (event: ChangeEvent) => void
): void {
  const cb = useRef(callback)
  useEffect(() => {
    cb.current = callback
  })
  const key = names.join('|')
  useEffect(() => {
    const wanted = new Set(key.split('|'))
    return window.api.onChange((event) => {
      if (wanted.has(event.name)) cb.current(event)
    })
  }, [key])
}

export interface Query<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  reload: () => void
}

/**
 * Fetches data through `window.api` and refetches when any of `events` fires (or `deps` change),
 * so every open window stays current without a reload. Out-of-order responses are discarded.
 */
export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
  events: readonly ChangeName[] = []
): Query<T> {
  const [state, setState] = useState<{
    data: T | undefined
    error: string | null
    loading: boolean
  }>({
    data: undefined,
    error: null,
    loading: true
  })
  const latest = useRef(0)
  const fetchRef = useRef(fetcher)
  useEffect(() => {
    fetchRef.current = fetcher
  })

  const run = useCallback(() => {
    const ticket = ++latest.current
    fetchRef
      .current()
      .then((data) => {
        if (ticket === latest.current) setState({ data, error: null, loading: false })
      })
      .catch((err: unknown) => {
        if (ticket === latest.current) {
          setState((s) => ({
            ...s,
            error: err instanceof Error ? err.message : String(err),
            loading: false
          }))
        }
      })
  }, [])

  useEffect(run, [run, ...deps])
  useChangeEvent(events, run)

  return { ...state, reload: run }
}
