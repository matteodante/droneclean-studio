// The preview's side of the pre-render (the one hook in `video-preview.tsx`): it tells the pre-render what the
// preview resolved and renders at (`host.ts`), primes the cache's decoder while paused on a pre-rendered frame, and
// answers whether the frame playing now comes from the cache. That last answer puts the preview on its rendered path
// for the frame, as a cleaned shadow piece does: the Player plays files, the cache is pictures.

import { useEffect, useRef, useState } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { prerenderCache } from './cache'
import { setPrerenderHost, type PrerenderHostInputs } from './host'
import { prerenderPlayer } from './playback'
import { watchPrerenderState } from './state'
import { usePrerenderStore } from './store'

/**
 * Register the preview as the pre-render's host and say whether playback is on a pre-rendered frame now. Kept as
 * state that changes only when the playhead crosses into or out of a pre-rendered range, so ordinary frames do not
 * re-render the preview.
 */
export function usePrerenderPreview(inputs: PrerenderHostInputs): boolean {
  const { resolvedUrls, renderSize, renderText, project } = inputs
  const { width: renderWidth, height: renderHeight } = renderSize
  const { width: projectWidth, height: projectHeight, backgroundColor } = project

  useEffect(() => {
    watchPrerenderState()
    return () => setPrerenderHost(null)
  }, [])

  useEffect(() => {
    setPrerenderHost({
      resolvedUrls,
      renderSize: { width: renderWidth, height: renderHeight },
      renderText,
      project: { width: projectWidth, height: projectHeight, backgroundColor },
    })
  }, [
    backgroundColor,
    projectHeight,
    projectWidth,
    renderHeight,
    renderText,
    renderWidth,
    resolvedUrls,
  ])

  const [readsPrerendered, setReadsPrerendered] = useState(false)
  const readsPrerenderedRef = useRef(false)
  useEffect(() => {
    const update = () => {
      const playback = usePlaybackStore.getState()
      const hasRanges = usePrerenderStore.getState().ranges.length > 0
      if (!playback.isPlaying && hasRanges) prerenderPlayer.prime(playback.currentFrame)
      const next =
        hasRanges &&
        playback.isPlaying &&
        playback.playbackRate > 0 &&
        prerenderCache.validRunAt(playback.currentFrame) !== null
      if (next === readsPrerenderedRef.current) return
      readsPrerenderedRef.current = next
      setReadsPrerendered(next)
    }
    update()
    const unsubscribePlayback = usePlaybackStore.subscribe((state, previous) => {
      if (
        state.currentFrame !== previous.currentFrame ||
        state.isPlaying !== previous.isPlaying ||
        state.playbackRate !== previous.playbackRate
      ) {
        update()
      }
    })
    const unsubscribeRanges = usePrerenderStore.subscribe((state, previous) => {
      if (state.ranges !== previous.ranges) update()
    })
    return () => {
      unsubscribePlayback()
      unsubscribeRanges()
    }
  }, [])

  return readsPrerendered
}
