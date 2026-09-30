import type Database from 'better-sqlite3'
import type { ChangeName } from '@shared/events'

export type Db = Database.Database

/** Called after a write commits so the main process can broadcast the change to windows. */
export type Emit = (name: ChangeName, detail?: { classId?: number }) => void
