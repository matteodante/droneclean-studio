// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createMemorySession } from './session'

describe('the in-memory session', () => {
  it('starts signed out, keeps the token it is given and forgets it again', async () => {
    const session = createMemorySession()

    expect(await session.getToken()).toBeNull()
    await session.setToken('a-token')
    expect(await session.getToken()).toBe('a-token')
    // A 401 clears it this way, and the panel then offers the sign-in.
    await session.setToken(null)
    expect(await session.getToken()).toBeNull()
  })

  it('can be made with a token already, for a test that starts signed in', async () => {
    expect(await createMemorySession('existing').getToken()).toBe('existing')
  })
})
