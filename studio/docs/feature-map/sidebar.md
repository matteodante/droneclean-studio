# Sidebar

The left sidebar is the panel that adds things to the project. Its rail of icons switches between **Media**,
**Text**, **Shapes**, **Effects**, **Transitions**, **Lottie**, **Transcript** and **AI**. The Media tab has a file of
its own (`media-library.md`); this file covers the other seven.

### Collapse panel
- Where: Editor › left sidebar › top of the rail
- Does: Hides the sidebar so the preview gets the width; the arrow brings it back.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Expand panel
- Where: Editor › left sidebar › top of the rail, when collapsed
- Does: Reopens the sidebar on the tab that was active.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

## Text tab

### Text
- Where: Editor › left sidebar › rail icon
- Does: Opens the text templates that add a title clip at the playhead.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Templates
- Where: Editor › left sidebar › Text tab
- Does: The heading above the text layouts; a tile adds a title at the playhead or can be dragged onto the timeline.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Single
- Where: Editor › left sidebar › Text tab › Templates
- Does: One-line title layouts.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### 2 spans
- Where: Editor › left sidebar › Text tab › Templates
- Does: Two-part titles, such as an eyebrow and a title.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### 3 spans
- Where: Editor › left sidebar › Text tab › Templates
- Does: Three-part titles, such as eyebrow, title and subtitle.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Add Text
- Where: Editor › left sidebar › Text tab › Single
- Does: Adds a plain text clip with the words “Your Text Here”.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Clean
- Where: Editor › left sidebar › Text tab › Single
- Does: A bold white title template.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Poster
- Where: Editor › left sidebar › Text tab › Single
- Does: A large poster-style title template.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Outline
- Where: Editor › left sidebar › Text tab › Single
- Does: A title inside an outlined pill.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Lower Third
- Where: Editor › left sidebar › Text tab › 2 spans
- Does: A name and role in the lower third of the frame.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Speaker
- Where: Editor › left sidebar › Text tab › 2 spans
- Does: A name-and-role template for interviews.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Cinematic
- Where: Editor › left sidebar › Text tab › 3 spans
- Does: A three-part cinematic title.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Quote
- Where: Editor › left sidebar › Text tab › 3 spans
- Does: A quotation layout with its source.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Neon
- Where: Editor › left sidebar › Text tab › 3 spans
- Does: A glowing neon title.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Headline
- Where: Editor › left sidebar › Text tab › 3 spans
- Does: A news-style headline template.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Breaking
- Where: Editor › left sidebar › Text tab › 3 spans
- Does: A “breaking news” title template.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Event
- Where: Editor › left sidebar › Text tab › 3 spans
- Does: An event announcement title.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Launch
- Where: Editor › left sidebar › Text tab › 3 spans
- Does: A product-launch title.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Badge
- Where: Editor › left sidebar › Text tab › 3 spans
- Does: A title with a small badge label.
- SDK: `studio.titles.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

## Shapes tab

### Shapes
- Where: Editor › left sidebar › rail icon
- Does: Opens the shapes, solid colours, gradients, pen and adjustment-layer tiles.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Solid Color
- Where: Editor › left sidebar › Shapes tab
- Does: Adds a full-frame solid colour layer at the playhead.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Gradient
- Where: Editor › left sidebar › Shapes tab
- Does: Adds a full-frame gradient layer.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Rectangle
- Where: Editor › left sidebar › Shapes tab
- Does: Adds a rectangle shape layer.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Circle
- Where: Editor › left sidebar › Shapes tab
- Does: Adds a circle shape layer.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Triangle
- Where: Editor › left sidebar › Shapes tab
- Does: Adds a triangle shape layer.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Ellipse
- Where: Editor › left sidebar › Shapes tab
- Does: Adds an ellipse shape layer.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Star
- Where: Editor › left sidebar › Shapes tab
- Does: Adds a star shape layer.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Polygon
- Where: Editor › left sidebar › Shapes tab
- Does: Adds a polygon shape layer.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Heart
- Where: Editor › left sidebar › Shapes tab
- Does: Adds a heart shape layer.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Pen
- Where: Editor › left sidebar › Shapes tab
- Does: Starts drawing a custom path shape, point by point, in the preview.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Adjustment layer
- Where: Editor › left sidebar › Shapes tab
- Does: Adds a transparent layer whose effects apply to every clip below it.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Blank adjustment layer
- Where: Editor › left sidebar › Shapes tab › Adjustment layer
- Does: Adds an adjustment layer with no effects yet.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Presets
- Where: Editor › left sidebar › Shapes tab
- Does: Effect presets that arrive already applied to an adjustment layer.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

## Effects tab

### Effects
- Where: Editor › left sidebar › rail icon
- Does: Opens the GPU effects and effect presets that can be added to the selection.
- SDK: `studio.effects.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Presets (Effects)
- Where: Editor › left sidebar › Effects tab
- Does: Ready-made looks that can be dropped on the timeline as an adjustment layer.
- SDK: `none`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Color
- Where: Editor › left sidebar › Effects tab › category
- Does: The colour effects, colour wheels and curves.
- SDK: `studio.effects.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Blur
- Where: Editor › left sidebar › Effects tab › category
- Does: The blur effects.
- SDK: `studio.effects.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Distort
- Where: Editor › left sidebar › Effects tab › category
- Does: The distorting effects.
- SDK: `studio.effects.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Stylize
- Where: Editor › left sidebar › Effects tab › category
- Does: The stylising effects, such as glow, grain and vignette.
- SDK: `studio.effects.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

### Keying
- Where: Editor › left sidebar › Effects tab › category
- Does: The keying effects, such as chroma key.
- SDK: `studio.effects.add`
- Code: `src/features/editor/components/media-sidebar.tsx`

## Transitions tab

### Transitions
- Where: Editor › left sidebar › rail icon
- Does: Opens the list of transition styles; click one to apply it to the selected cut, or drag it onto a cut.
- SDK: `studio.transitions.add`
- Code: `src/features/editor/components/transitions-panel.tsx`

### Basic
- Where: Editor › left sidebar › Transitions tab › category
- Does: The simple cuts and dissolves.
- SDK: `studio.transitions.add`
- Code: `src/features/editor/components/transitions-panel.tsx`

### Dissolve
- Where: Editor › left sidebar › Transitions tab › category
- Does: The cross-dissolve family of transitions.
- SDK: `studio.transitions.add`
- Code: `src/features/editor/components/transitions-panel.tsx`

### Motion
- Where: Editor › left sidebar › Transitions tab › category
- Does: Transitions where the picture moves.
- SDK: `studio.transitions.add`
- Code: `src/features/editor/components/transitions-panel.tsx`

### Wipe
- Where: Editor › left sidebar › Transitions tab › category
- Does: Transitions where a shape sweeps the old picture away.
- SDK: `studio.transitions.add`
- Code: `src/features/editor/components/transitions-panel.tsx`

### Slide
- Where: Editor › left sidebar › Transitions tab › category
- Does: Transitions where the new picture slides in.
- SDK: `studio.transitions.add`
- Code: `src/features/editor/components/transitions-panel.tsx`

### Flip
- Where: Editor › left sidebar › Transitions tab › category
- Does: Transitions that turn the picture over.
- SDK: `studio.transitions.add`
- Code: `src/features/editor/components/transitions-panel.tsx`

### Mask
- Where: Editor › left sidebar › Transitions tab › category
- Does: Transitions shaped by a mask.
- SDK: `studio.transitions.add`
- Code: `src/features/editor/components/transitions-panel.tsx`

### Iris
- Where: Editor › left sidebar › Transitions tab › category
- Does: Transitions that open or close from the centre.
- SDK: `studio.transitions.add`
- Code: `src/features/editor/components/transitions-panel.tsx`

### Shape
- Where: Editor › left sidebar › Transitions tab › category
- Does: Transitions driven by a named shape.
- SDK: `studio.transitions.add`
- Code: `src/features/editor/components/transitions-panel.tsx`

### Drag a transition onto a valid cut
- Where: Editor › left sidebar › Transitions tab › hint
- Does: Explains how to apply a transition when no cut is selected.
- SDK: `none`
- Code: `src/features/editor/components/transitions-panel.tsx`

## Lottie tab

### Lottie
- Where: Editor › left sidebar › rail icon
- Does: Opens the sticker browser of ready-made animations.
- SDK: `none`
- Code: `src/features/lottie-browser/components/lottie-browser-panel.tsx`

### Search animations
- Where: Editor › left sidebar › Lottie tab
- Does: Searches the sticker catalogue by name.
- SDK: `none`
- Code: `src/features/lottie-browser/components/lottie-browser-panel.tsx`

### Add to media library
- Where: Editor › left sidebar › Lottie tab › sticker
- Does: Downloads the sticker into the project's media so it can be placed on the timeline.
- SDK: `studio.media.import`
- Code: `src/features/lottie-browser/components/lottie-card.tsx`

### Previous page
- Where: Editor › left sidebar › Lottie tab › footer
- Does: Shows the previous page of stickers.
- SDK: `none`
- Code: `src/features/lottie-browser/components/lottie-browser-panel.tsx`

### Next page
- Where: Editor › left sidebar › Lottie tab › footer
- Does: Shows the next page of stickers.
- SDK: `none`
- Code: `src/features/lottie-browser/components/lottie-browser-panel.tsx`

### Clear search
- Where: Editor › left sidebar › Lottie tab
- Does: Empties the animation search field.
- SDK: `none`
- Code: `src/features/lottie-browser/components/lottie-browser-panel.tsx`

## Transcript tab

### Transcript
- Where: Editor › left sidebar › rail icon
- Does: Opens the transcript of the selected clip for cutting words out of the timeline.
- SDK: `none`
- Code: `src/features/timeline/components/transcript-editor/transcript-editor-panel.tsx`

### Transcript
- Where: Editor › left sidebar › Transcript tab
- Does: Shows the selected clip's transcript, word by word, to cut the video by deleting words.
- SDK: `none`
- Code: `src/features/timeline/components/transcript-editor/transcript-editor-panel.tsx`

### Search transcript
- Where: Editor › left sidebar › Transcript tab
- Does: Finds a word in the transcript and highlights its matches.
- SDK: `none`
- Code: `src/features/timeline/components/transcript-editor/transcript-editor-panel.tsx`

### Selection
- Where: Editor › left sidebar › Transcript tab › scope
- Does: Limits the transcript and its edits to the selected clip.
- SDK: `none`
- Code: `src/features/timeline/components/transcript-editor/transcript-editor-panel.tsx`

### Whole project
- Where: Editor › left sidebar › Transcript tab › scope
- Does: Makes the transcript and its edits cover every clip of the project.
- SDK: `none`
- Code: `src/features/timeline/components/transcript-editor/transcript-editor-panel.tsx`

### Generate transcript
- Where: Editor › left sidebar › Transcript tab
- Does: Transcribes the selected clip's speech.
- SDK: `none`
- Code: `src/features/timeline/components/transcript-editor/transcript-editor-panel.tsx`

### Mark for delete
- Where: Editor › left sidebar › Transcript tab › selected words
- Does: Marks the selected words so their audio and picture are cut when the edits are applied.
- SDK: `studio.clips.remove`
- Code: `src/features/timeline/components/transcript-editor/transcript-editor-panel.tsx`

### Restore
- Where: Editor › left sidebar › Transcript tab › selected words
- Does: Unmarks words that were marked for deletion.
- SDK: `none`
- Code: `src/features/timeline/components/transcript-editor/transcript-editor-panel.tsx`

### Delete marked
- Where: Editor › left sidebar › Transcript tab
- Does: Applies the marked cuts to the timeline.
- SDK: `studio.clips.remove`
- Code: `src/features/timeline/components/transcript-editor/transcript-editor-panel.tsx`

### Restore all
- Where: Editor › left sidebar › Transcript tab
- Does: Unmarks every word marked for deletion.
- SDK: `none`
- Code: `src/features/timeline/components/transcript-editor/transcript-editor-panel.tsx`

### Copy
- Where: Editor › left sidebar › Transcript tab
- Does: Copies the selected words so they can be pasted onto the timeline as captions or text.
- SDK: `none`
- Code: `src/features/timeline/components/transcript-editor/transcript-editor-panel.tsx`

### Cut
- Where: Editor › left sidebar › Transcript tab
- Does: Cuts the selected words out of the clip in one edit.
- SDK: `studio.clips.remove`
- Code: `src/features/timeline/components/transcript-editor/transcript-editor-panel.tsx`

## AI tab

### AI
- Where: Editor › left sidebar › rail icon
- Does: Opens the on-device generation tools: text to speech and music.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

### Text to Speech
- Where: Editor › left sidebar › AI tab
- Does: Generates a spoken voice from typed text with a local model.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

### Text
- Where: Editor › left sidebar › AI tab › Text to Speech
- Does: The words the generated voice will say.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

### Engine
- Where: Editor › left sidebar › AI tab › Text to Speech
- Does: Chooses the local speech model: Kokoro, MOSS Nano or Supertonic.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

### Voice
- Where: Editor › left sidebar › AI tab › Text to Speech
- Does: Chooses the voice used for the generated speech.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

### Language
- Where: Editor › left sidebar › AI tab › Text to Speech
- Does: Sets the spoken language, or Auto detect.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

### Speed
- Where: Editor › left sidebar › AI tab › Text to Speech
- Does: Sets how fast the generated voice speaks.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

### Generate
- Where: Editor › left sidebar › AI tab › Text to Speech
- Does: Synthesises the speech and offers to save it to the media library or insert it.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

### Music Generation
- Where: Editor › left sidebar › AI tab
- Does: Generates a music clip from a written description with a local model.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

### Prompt
- Where: Editor › left sidebar › AI tab › Music Generation
- Does: Describes the music to generate: genre, mood, tempo and instruments.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

### Length
- Where: Editor › left sidebar › AI tab › Music Generation
- Does: Sets how many seconds of music to generate.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

### Save to Library
- Where: Editor › left sidebar › AI tab › generated result
- Does: Keeps the generated audio as media without placing it on the timeline.
- SDK: `studio.media.import`
- Code: `src/features/editor/components/ai-panel.tsx`

### Save & Insert
- Where: Editor › left sidebar › AI tab › generated result
- Does: Keeps the generated audio and places it on an audio track at the playhead.
- SDK: `studio.clips.add`
- Code: `src/features/editor/components/ai-panel.tsx`

### History
- Where: Editor › left sidebar › AI tab › Text to Speech or Music Generation
- Does: Lists the generated voices and music still held in this session.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

### Clear all
- Where: Editor › left sidebar › AI tab › History
- Does: Empties the generated-audio history.
- SDK: `none`
- Code: `src/features/editor/components/ai-panel.tsx`

## Motion Library (Motion workspace)

The Motion workspace replaces the clip inspector with the full animation library; it opens in the Properties panel
on the Animate tab.

### Motion Library
- Where: Editor › Motion workspace › Properties panel › Animate tab
- Does: The animation presets that can be applied to the selected clip; drag one onto a clip for editable keyframes.
- SDK: `none`
- Code: `src/features/editor/components/animate-workspace/animation-preset-library.tsx`

### Search animations…
- Where: Editor › Motion workspace › Properties panel › Animate tab › Motion Library
- Does: Filters the animation presets by name.
- SDK: `none`
- Code: `src/features/editor/components/animate-workspace/animation-preset-toolbar.tsx`

### Compatible
- Where: Editor › Motion workspace › Properties panel › Animate tab › Motion Library
- Does: Shows only the animations that suit the selected clip.
- SDK: `none`
- Code: `src/features/editor/components/animate-workspace/animation-preset-toolbar.tsx`

### Save Animation
- Where: Editor › Motion workspace › Properties panel › Animate tab › Motion Library
- Does: Saves the selected clip's keyframes as a reusable animation preset.
- SDK: `studio.keyframes.list`
- Code: `src/features/editor/components/animate-workspace/animation-preset-toolbar.tsx`

### Animations
- Where: Editor › Motion workspace › Properties panel › Animate tab › Motion Library
- Does: The built-in animation presets, grouped by movement.
- SDK: `studio.keyframes.add`
- Code: `src/features/editor/components/animate-workspace/animation-preset-library.tsx`

### Loop & behaviors
- Where: Editor › Motion workspace › Properties panel › Animate tab › Motion Library
- Does: Live layer behaviours and text loops that run until baked or removed.
- SDK: `none`
- Code: `src/features/editor/components/animate-workspace/animation-preset-library.tsx`

### Applied
- Where: Editor › Motion workspace › Properties panel › Animate tab › Motion Library
- Does: Shows what is currently moving on the selected clip, with the option to remove it.
- SDK: `none`
- Code: `src/features/editor/components/animate-workspace/animation-preset-library.tsx`
