import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { LottieBrowserPanel } from './lottie-browser-panel'
import { LottieCard } from './lottie-card'
import { useLottieBrowserStore } from '../stores/lottie-browser-store'
import type { LottieFilesAnimation } from '../services/lottiefiles-api'

const ANIMATION: LottieFilesAnimation = {
  id: '1',
  name: 'Snow Globe Skater',
  lottieUrl: 'https://assets-v2.lottiefiles.com/a/b/c.lottie',
  imageUrl: 'https://assets-v2.lottiefiles.com/a/b/c.png',
  bgColor: '#0a0e1a',
  author: 'Inad',
  authorPath: '/inad.',
}

const EMPTY_PAGE = {
  data: {
    featuredPublicAnimations: {
      totalCount: 0,
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: [],
    },
  },
}

type ObserverCallback = ConstructorParameters<typeof IntersectionObserver>[0]

class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = []
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: number[] = []
  elements: Element[] = []

  constructor(readonly callback: ObserverCallback) {
    TestIntersectionObserver.instances.push(this)
  }

  observe(element: Element): void {
    this.elements.push(element)
  }

  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  intersect(): void {
    this.callback(
      this.elements.map(
        (target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry,
      ),
      this as unknown as IntersectionObserver,
    )
  }
}

function resetStore(): void {
  useLottieBrowserStore.setState({
    category: 'featured',
    query: '',
    page: 0,
    items: [],
    status: 'idle',
    error: null,
    hasFetched: false,
    hasStarted: false,
    totalCount: 0,
    importingIds: new Set(),
    importedIds: new Set(),
    failedIds: new Set(),
    requestId: 0,
  })
}

describe('LottieBrowserPanel', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    resetStore()
    TestIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
    // jsdom has no scrolling; the panel scrolls its results to the top on a page change.
    HTMLElement.prototype.scrollTo = vi.fn()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => EMPTY_PAGE })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
    vi.unstubAllGlobals()
  })

  it('makes no request when the tab opens and loads the catalogue on the first click', async () => {
    render(<LottieBrowserPanel />)

    expect(fetchMock).not.toHaveBeenCalled()
    const browseButton = screen.getByRole('button')
    expect(useLottieBrowserStore.getState().hasStarted).toBe(false)

    fireEvent.click(browseButton)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://graphql.lottiefiles.com/2022-08')
    expect(useLottieBrowserStore.getState().hasStarted).toBe(true)
  })

  it('does not load the catalogue again when the panel mounts already browsing', async () => {
    useLottieBrowserStore.setState({ hasStarted: true })
    render(<LottieBrowserPanel />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })
})

describe('LottieCard', () => {
  beforeEach(() => {
    TestIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the still preview only once the card is on screen', () => {
    render(
      <LottieCard
        animation={ANIMATION}
        isImporting={false}
        isImported={false}
        isFailed={false}
        onImport={() => {}}
      />,
    )

    expect(screen.queryByAltText(ANIMATION.name)).toBeNull()
    expect(TestIntersectionObserver.instances).toHaveLength(1)

    act(() => TestIntersectionObserver.instances[0]?.intersect())

    expect(screen.getByAltText(ANIMATION.name).getAttribute('src')).toBe(ANIMATION.imageUrl)
  })

  it('shows no preview when the animation has no still', () => {
    render(
      <LottieCard
        animation={{ ...ANIMATION, imageUrl: null }}
        isImporting={false}
        isImported={false}
        isFailed={false}
        onImport={() => {}}
      />,
    )

    expect(TestIntersectionObserver.instances).toHaveLength(0)
    expect(screen.queryByAltText(ANIMATION.name)).toBeNull()
  })
})
