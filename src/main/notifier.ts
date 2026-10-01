export interface Notice {
  title: string
  body: string
}

export interface NotifierDeps {
  /** Shows a system notification. */
  show: (n: Notice) => void
  /** How many held notifications to keep; the oldest are dropped. */
  maxHeld?: number
}

/**
 * Every system notification goes through here. While presenting they are held, not shown, so nothing
 * pops up over the projector; when presenting ends they are shown once as a single summary.
 */
export function createNotifier(deps: NotifierDeps) {
  const max = deps.maxHeld ?? 10
  let presenting = false
  let held: Notice[] = []

  return {
    notify(n: Notice): void {
      if (!presenting) return deps.show(n)
      held.push(n)
      if (held.length > max) held = held.slice(-max)
    },
    setPresenting(on: boolean): void {
      const was = presenting
      presenting = on
      if (was && !on && held.length > 0) {
        const items = held
        held = []
        deps.show(
          items.length === 1
            ? items[0]
            : {
                title: `${items.length} notifications while you were presenting`,
                body: items.map((i) => `${i.title}: ${i.body}`).join('\n')
              }
        )
      }
    },
    isPresenting: (): boolean => presenting,
    heldCount: (): number => held.length
  }
}

export type Notifier = ReturnType<typeof createNotifier>
