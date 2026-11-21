# Preview

The preview area sits above the timeline. In the Edit and Motion workspaces it shows the frame under the playhead
with the transport controls; in the Color workspace it grows the scopes. A **source monitor** can open beside it to
scrub one media file, and the **Program monitor** is the timeline's own output.

## Program monitor

### Video Preview
- Where: Editor › Preview
- Does: Shows the frame at the playhead, with the selected clip's transform and effect overlays on top.
- SDK: `studio.playback.get`
- Code: `src/features/preview/components/preview-stage.tsx`

### Nothing on the timeline yet
- Where: Editor › Preview › empty state
- Does: Explains that media is dragged to the timeline and Space plays.
- SDK: `none`
- Code: `src/features/preview/components/preview-stage.tsx`

### Loading Media
- Where: Editor › Preview
- Does: Shown while the frame's media is being decoded.
- SDK: `none`
- Code: `src/features/preview/components/preview-stage.tsx`

### Media offline
- Where: Editor › Preview
- Does: Says the clip's file cannot be read and points to the Media panel to relink it.
- SDK: `none`
- Code: `src/features/preview/components/preview-stage.tsx`

### Play
- Where: Editor › Preview › transport
- Does: Starts playback from the playhead; becomes Pause while playing.
- SDK: `studio.playback.play`
- Code: `src/features/preview/components/playback-controls.tsx`

### Pause
- Where: Editor › Preview › transport
- Does: Stops playback at the current frame.
- SDK: `studio.playback.pause`
- Code: `src/features/preview/components/playback-controls.tsx`

### Go To Start
- Where: Editor › Preview › transport
- Does: Moves the playhead to the first frame of the sequence.
- SDK: `studio.playback.seek`
- Code: `src/features/preview/components/playback-controls.tsx`

### Go To End
- Where: Editor › Preview › transport
- Does: Moves the playhead to the last frame of the sequence.
- SDK: `studio.playback.seek`
- Code: `src/features/preview/components/playback-controls.tsx`

### Prev Frame
- Where: Editor › Preview › transport
- Does: Moves the playhead back one frame.
- SDK: `studio.playback.seek`
- Code: `src/features/preview/components/playback-controls.tsx`

### Next Frame
- Where: Editor › Preview › transport
- Does: Moves the playhead forward one frame.
- SDK: `studio.playback.seek`
- Code: `src/features/preview/components/playback-controls.tsx`

### Timecode
- Where: Editor › Preview › transport › left
- Does: Shows the playhead's time and the sequence duration as `00:00:00 / 00:09:29`; a click switches between timecode and frames.
- SDK: `studio.playback.get`
- Code: `src/features/preview/components/timecode-display.tsx`

### Volume
- Where: Editor › Preview › transport
- Does: Opens the preview audio control for the speakers on this device.
- SDK: `none`
- Code: `src/features/preview/components/monitor-volume-control.tsx`

### Preview audio
- Where: Editor › Preview › Volume popover
- Does: The slider that sets the loudness of local playback; exports use the project's own mix.
- SDK: `none`
- Code: `src/features/preview/components/monitor-volume-control.tsx`

### Mute
- Where: Editor › Preview › Volume popover
- Does: Silences local playback without changing the project.
- SDK: `none`
- Code: `src/features/preview/components/monitor-volume-control.tsx`

### Save frame
- Where: Editor › Preview › transport
- Does: Saves the current frame as a PNG in the media library.
- SDK: `none`
- Code: `src/features/preview/components/playback-controls.tsx`

### Proxy Playback On
- Where: Editor › Preview › transport
- Does: Switches preview decoding between the original files and their lighter proxies; reads Proxy Playback Off when off.
- SDK: `none`
- Code: `src/features/preview/components/playback-controls.tsx`

### Playback resolution
- Where: Editor › Preview › transport, beside the proxy switch
- Does: Sets the size the preview renders at: Full, 1/2 or 1/4; a lower one draws fewer pixels per rendered frame. Kept for the app; exports are unaffected.
- SDK: `studio.preview.setQuality`
- Code: `src/studio/preview/PreviewQualityMenu.tsx`

### Rendering preview
- Where: Editor › Preview › transport, while a pre-render runs
- Does: Shows how far the pre-render is; its X cancels it and keeps the frames already rendered.
- SDK: `studio.preview.cancelPrerender`
- Code: `src/studio/prerender/ui/PrerenderProgress.tsx`

### Zoom: Auto
- Where: Editor › Preview › bottom-right
- Does: Sets the preview scale; Auto fits the frame to the panel, the menu offers fixed percentages.
- SDK: `none`
- Code: `src/features/preview/components/preview-zoom-controls.tsx`

## Canvas overlays

### Transform box
- Where: Editor › Preview › selected visual clip
- Does: Drag the box to move, the corners to scale and the handle to rotate the clip on the canvas.
- SDK: `studio.clips.update`
- Code: `src/features/preview/components/transform-gizmo.tsx`

### Align
- Where: Editor › Preview › canvas toolbar
- Does: Snaps the selected layer to the canvas: left, centre, right, top, middle or bottom.
- SDK: `studio.clips.update`
- Code: `src/features/preview/components/alignment-hud.tsx`

### Distribute Horizontally
- Where: Editor › Preview › canvas toolbar › Align
- Does: Spaces the selected layers evenly across the canvas.
- SDK: `studio.clips.update`
- Code: `src/features/preview/components/alignment-hud.tsx`

### Distribute Vertically
- Where: Editor › Preview › canvas toolbar › Align
- Does: Spaces the selected layers evenly down the canvas.
- SDK: `studio.clips.update`
- Code: `src/features/preview/components/alignment-hud.tsx`

### Toggle Canvas Snap
- Where: Editor › Preview › canvas toolbar
- Does: Snaps a dragged layer to the canvas edges and centre.
- SDK: `none`
- Code: `src/features/preview/components/alignment-hud.tsx`

### Snap guides
- Where: Editor › Preview
- Does: The lines that appear while a layer is dragged near the canvas centre, edges or another layer.
- SDK: `none`
- Code: `src/features/preview/components/snap-guides.tsx`

### Corner Pin
- Where: Editor › Preview › Corner Pin editor
- Does: Drag each corner of the picture to fake a perspective on the canvas.
- SDK: `studio.effects.update`
- Code: `src/features/preview/components/corner-pin-overlay.tsx`

### Before
- Where: Editor › Preview › Grade comparison
- Does: Shows the ungraded picture, without colour effects.
- SDK: `none`
- Code: `src/features/effects/components/color-grade-section.tsx`

### After
- Where: Editor › Preview › Grade comparison
- Does: Shows the graded picture.
- SDK: `none`
- Code: `src/features/effects/components/color-grade-section.tsx`

### Split
- Where: Editor › Preview › Grade comparison
- Does: Shows the ungraded picture on the left and the graded one on the right, with a draggable divider.
- SDK: `none`
- Code: `src/features/effects/components/color-grade-section.tsx`

### Adjust split comparison
- Where: Editor › Preview › Grade comparison › divider
- Does: Moves the line between the before and after halves.
- SDK: `none`
- Code: `src/features/preview/components/preview-stage.tsx`

## Source monitor

### Source monitor
- Where: Editor › Preview › left half, after “Open In Source Monitor”
- Does: Plays one media file on its own and sets the in/out points used by the insert and overwrite edits.
- SDK: `studio.media.get`
- Code: `src/features/preview/components/source-monitor.tsx`

### Close source monitor
- Where: Editor › Preview › Source monitor
- Does: Closes the source monitor and gives the whole preview back to the timeline.
- SDK: `none`
- Code: `src/features/preview/components/source-monitor.tsx`

### Play In to Out
- Where: Editor › Preview › Source monitor
- Does: Plays the media between its marked in and out points.
- SDK: `none`
- Code: `src/features/preview/components/source-monitor.tsx`

### Mark In (I)
- Where: Editor › Preview › Source monitor
- Does: Sets the source's in point at the playhead.
- SDK: `none`
- Code: `src/features/preview/components/source-monitor.tsx`

### Mark Out (O)
- Where: Editor › Preview › Source monitor
- Does: Sets the source's out point at the playhead.
- SDK: `none`
- Code: `src/features/preview/components/source-monitor.tsx`

### Clear In/Out (Alt+X)
- Where: Editor › Preview › Source monitor
- Does: Clears the source's in and out points.
- SDK: `none`
- Code: `src/features/preview/components/source-monitor.tsx`

### Go to start (Home)
- Where: Editor › Preview › Source monitor
- Does: Moves the source playhead to the file's first frame.
- SDK: `none`
- Code: `src/features/preview/components/source-monitor.tsx`

### Previous frame (Left Arrow)
- Where: Editor › Preview › Source monitor
- Does: Moves the source playhead back one frame.
- SDK: `none`
- Code: `src/features/preview/components/source-monitor.tsx`

### Play (Space)
- Where: Editor › Preview › Source monitor
- Does: Plays the source file; becomes Pause (Space) while playing.
- SDK: `none`
- Code: `src/features/preview/components/source-monitor.tsx`

### Next frame (Right Arrow)
- Where: Editor › Preview › Source monitor
- Does: Moves the source playhead forward one frame.
- SDK: `none`
- Code: `src/features/preview/components/source-monitor.tsx`

### Go to end (End)
- Where: Editor › Preview › Source monitor
- Does: Moves the source playhead to the file's last frame.
- SDK: `none`
- Code: `src/features/preview/components/source-monitor.tsx`

### Video destination
- Where: Editor › Preview › Source monitor › patch
- Does: Chooses which video track the source is placed on by an insert or overwrite edit.
- SDK: `none`
- Code: `src/features/preview/components/source-monitor.tsx`

### Audio destination
- Where: Editor › Preview › Source monitor › patch
- Does: Chooses which audio track the source's sound is placed on.
- SDK: `none`
- Code: `src/features/preview/components/source-monitor.tsx`

### Insert (,)
- Where: Editor › Preview › Source monitor
- Does: Inserts the marked part of the source at the playhead and pushes the later clips to the right.
- SDK: `studio.clips.add`
- Code: `src/features/preview/components/source-monitor.tsx`

### Overwrite (.)
- Where: Editor › Preview › Source monitor
- Does: Places the marked part of the source at the playhead, replacing what is under it.
- SDK: `studio.clips.add`
- Code: `src/features/preview/components/source-monitor.tsx`

### Create Subclip (Alt+S)
- Where: Editor › Preview › Source monitor
- Does: Makes a subclip of the marked in and out points of the file shown; the button is disabled until a mark is set.
- SDK: `studio.subclips.create`
- Code: `src/features/preview/components/source-monitor.tsx`

### Drag the marked range
- Where: Editor › Preview › Source monitor › picture
- Does: Drags the marked part of the file onto a track or the preview as a clip that plays only that range.
- SDK: `studio.clips.add`
- Code: `src/features/preview/components/source-monitor.tsx`

## Color scopes

### Scopes
- Where: Editor › Preview › right side, in the Color workspace
- Does: The panel of video scopes that measure the displayed picture.
- SDK: `none`
- Code: `src/features/preview/components/color-scopes-view.tsx`

### Waveform
- Where: Editor › Preview › Scopes
- Does: Shows the picture's brightness from black to white.
- SDK: `none`
- Code: `src/features/preview/components/color-scopes-view.tsx`

### RGB Parade
- Where: Editor › Preview › Scopes
- Does: Shows the red, green and blue channels side by side.
- SDK: `none`
- Code: `src/features/preview/components/color-scopes-view.tsx`

### Vectorscope
- Where: Editor › Preview › Scopes
- Does: Shows hue and saturation around a colour wheel.
- SDK: `none`
- Code: `src/features/preview/components/color-scopes-view.tsx`

### Histogram
- Where: Editor › Preview › Scopes
- Does: Shows how many pixels fall at each brightness or colour level.
- SDK: `none`
- Code: `src/features/preview/components/color-scopes-view.tsx`

### Scope
- Where: Editor › Preview › Scopes › layout menu
- Does: Chooses which single scope fills the stacked layout.
- SDK: `none`
- Code: `src/features/preview/components/color-scopes-view.tsx`

### Close color scopes
- Where: Editor › Preview › Scopes › ×
- Does: Hides the scopes and gives the width back to the program monitor.
- SDK: `none`
- Code: `src/features/preview/components/color-scopes-monitor.tsx`

## Split handles

### Reset Source Monitor Width
- Where: Editor › Preview › divider beside the source monitor
- Does: Puts the divider back to its usual place.
- SDK: `none`
- Code: `src/features/editor/components/preview-area.tsx`

### Reset Color Scopes Width
- Where: Editor › Preview › divider beside the scopes
- Does: Puts the scopes divider back to its usual place.
- SDK: `none`
- Code: `src/features/editor/components/preview-area.tsx`
