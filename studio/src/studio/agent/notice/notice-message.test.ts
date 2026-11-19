import { describe, expect, it } from 'vite-plus/test'
import { agentNoticeMessage } from './agent-activity-notice'

describe('agentNoticeMessage', () => {
  it('says the number of edits, singular for one', () => {
    expect(agentNoticeMessage(1)).toBe('Agent: 1 edit')
    expect(agentNoticeMessage(3)).toBe('Agent: 3 edits')
  })
})
