import { describe, expect, it } from 'vitest'
import { APP_ID, APP_NAME } from '@shared/app-info'

describe('scaffold', () => {
  it('exposes app identity', () => {
    expect(APP_NAME).toBe('Teaching OS')
    expect(APP_ID).toBe('TeachingOS')
  })
})
