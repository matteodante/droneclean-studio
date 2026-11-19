import { afterEach, describe, expect, it } from 'vite-plus/test'
import { useProjectStore } from '@/features/timeline/deps/projects'
import { saveOpenProject } from '@/studio/shadow/project-saver'
import './timeline-persistence'

describe('the save registered for the shadow flow', () => {
  afterEach(() => useProjectStore.setState({ currentProject: null }))

  it('is registered by loading the persistence module, and needs an open project', async () => {
    useProjectStore.setState({ currentProject: null })
    await expect(saveOpenProject()).rejects.toThrow('No project is open.')
  })
})
