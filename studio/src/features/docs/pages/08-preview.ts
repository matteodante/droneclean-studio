import type { DocPageContent } from '../docs-content'

const page = {
  order: 8,
  slug: 'preview',
  title: 'Preview and Playback',
  description:
    'Play, step frames, zoom the monitor, go fullscreen, save frames, use proxy playback, lower the playback resolution, and render a range ahead for smooth playback.',
  category: 'Core Editing',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Play and navigate',
      blocks: [
        {
          kind: 'list',
          items: [
            'Play and pause with the preview controls or `Space`.',
            'Step one frame at a time with `Left` and `Right` for frame-accurate checks.',
            'Jump to the start of the timeline with `Home` and the end with `End`.',
            'Read the timecode display to confirm the exact playhead position.',
          ],
        },
      ],
    },
    {
      title: 'Frame the view',
      blocks: [
        {
          kind: 'list',
          items: [
            'Adjust preview zoom to inspect detail; this does not change the export canvas.',
            'Use **Fullscreen** when reviewing motion or framing, and Exit Fullscreen to return.',
            'Use **Save frame** to write the current frame to an image file.',
            'Transform, mask, and edit overlays appear on the monitor when a matching item is selected.',
          ],
        },
      ],
    },
    {
      title: 'Playback performance and audio',
      blocks: [
        {
          kind: 'list',
          items: [
            'When proxies exist, DroneClean Studio uses them for smoother playback of heavy media; exports still use the originals.',
            'The monitor volume control affects local playback only.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Exports use the project mix, so monitor volume never changes the rendered audio.',
        },
      ],
    },
    {
      title: 'Playback resolution',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The button beside the proxy switch in the transport bar sets the playback resolution: **Full**, **1/2** or **1/4**. A lower resolution draws fewer pixels for every frame the preview renders itself (clips with effects, stabilization, speed ramps, motion blur), so heavy stretches play faster; the picture is softer. The setting is kept for the whole app and never changes an export.',
        },
      ],
    },
    {
      title: 'Render a range ahead',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Stabilized clips with optical-flow slow motion and motion blur can be too heavy to preview in real time. Render them ahead, as in After Effects, and they play back at full frame rate.',
        },
        {
          kind: 'steps',
          items: [
            'Mark the stretch with In and Out (`I` and `O`), or set none to render the whole timeline.',
            'Open the **Render preview** menu in the timeline toolbar, beside the In/Out buttons, and choose **Render In to Out**, or press `Enter`.',
            'Watch the progress in the transport bar; the X there cancels, and keeps what is already rendered.',
            'A green line along the bottom of the ruler marks the frames that now play from the rendered preview.',
          ],
        },
        {
          kind: 'list',
          items: [
            'The frames are rendered at the current playback resolution and kept in memory (up to 1 GB, about four and a half minutes at 1080p 60 fps) until you close the project.',
            'Any edit that changes a frame, a clip, an effect, a keyframe, a transition, stabilization, speed, the project size or rate, the playback resolution or the proxy switch, removes those frames from the green line at once: the preview renders them live again, never an old picture.',
            'Rendering again renders only the frames that are missing. **Delete rendered preview** in the same menu frees the memory.',
            'Exports never use the rendered preview: they always render from the project.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'If the computer cannot encode frames at the preview size, or the memory limit is reached, a message says so and the preview stays live.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
