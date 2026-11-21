# Timeline

The timeline is the bottom half of the editor. It holds the sequence tabs, the track headers, the clips, the
ruler with its markers and in/out points, and the tool strip above it. The tool strip's left group is the
timeline's own toolbar; the project toolbar is in `menus-and-shortcuts.md`.

## Sequence tabs

### Main
- Where: Editor › Timeline › tab strip
- Does: Switches back to the project's main timeline.
- SDK: `studio.project.context`
- Code: `src/features/timeline/components/sequence-tabs.tsx`

### New sequence
- Where: Editor › Timeline › tab strip › +
- Does: Creates an empty side sequence and opens it in a tab.
- SDK: `none`
- Code: `src/features/timeline/components/sequence-tabs.tsx`

### Sequence tab
- Where: Editor › Timeline › tab strip
- Does: Opens that sequence; a double-click renames it.
- SDK: `none`
- Code: `src/features/timeline/components/sequence-tabs.tsx`

### Close tab
- Where: Editor › Timeline › sequence tab › ×
- Does: Closes the sequence's tab without deleting it from the project.
- SDK: `none`
- Code: `src/features/timeline/components/sequence-tabs.tsx`

### Rename
- Where: Editor › Timeline › sequence tab menu
- Does: Changes the sequence's name.
- SDK: `none`
- Code: `src/features/timeline/components/sequence-tabs.tsx`

### Delete sequence
- Where: Editor › Timeline › sequence tab menu
- Does: Deletes the sequence and its contents after a confirmation.
- SDK: `none`
- Code: `src/features/timeline/components/sequence-tabs.tsx`

### Composition breadcrumb
- Where: Editor › Timeline › above the tab strip, inside a compound clip
- Does: Shows which compound clip is open and lets the user step back out to its parent.
- SDK: `none`
- Code: `src/features/timeline/components/composition-breadcrumbs.tsx`

## Tool strip

### Select Tool
- Where: Editor › Timeline › tool strip
- Does: The default tool: click to select clips, drag to move them, drag an edge to trim.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Trim Edit Tool
- Where: Editor › Timeline › tool strip
- Does: Drags a clip's edge to trim it while keeping the neighbouring clip in place.
- SDK: `studio.clips.trimEnd`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Razor Tool
- Where: Editor › Timeline › tool strip
- Does: Cuts a clip in two where the tool is clicked.
- SDK: `studio.clips.split`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Rate Stretch Tool
- Where: Editor › Timeline › tool strip
- Does: Drags a clip edge to change its speed instead of trimming its content.
- SDK: `studio.clips.setSpeed`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Slip Slide Tools
- Where: Editor › Timeline › tool strip
- Does: Opens the menu with the Slip Tool and the Slide Tool.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Slip Tool
- Where: Editor › Timeline › tool strip › Slip Slide Tools
- Does: Drags a clip's content earlier or later without moving the clip itself.
- SDK: `studio.clips.update`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Slide Tool
- Where: Editor › Timeline › tool strip › Slip Slide Tools
- Does: Moves a clip and ripples its neighbours so no gap is left.
- SDK: `studio.clips.move`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Undo
- Where: Editor › Timeline › tool strip
- Does: Reverses the last edit; the tooltip names it, as in “Undo Trim Clip”.
- SDK: `studio.history.undo`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Redo
- Where: Editor › Timeline › tool strip
- Does: Re-applies the last undone edit; the tooltip names it.
- SDK: `studio.history.redo`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Set In Point
- Where: Editor › Timeline › tool strip
- Does: Marks the playhead as the start of the playback and export range.
- SDK: `studio.markers.setIn`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Set Out Point
- Where: Editor › Timeline › tool strip
- Does: Marks the playhead as the end of the playback and export range.
- SDK: `studio.markers.setOut`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Clear In Out Points
- Where: Editor › Timeline › tool strip
- Does: Removes the in/out range so the whole timeline plays and exports.
- SDK: `studio.markers.clearRange`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Render preview
- Where: Editor › Timeline › tool strip, after the in/out buttons
- Does: Renders the in/out range (or the whole timeline) ahead at the playback resolution, so it plays back at full frame rate; Delete rendered preview frees the frames.
- SDK: `studio.preview.prerender`
- Code: `src/studio/prerender/ui/PrerenderMenu.tsx`

### Add Marker
- Where: Editor › Timeline › tool strip
- Does: Adds a marker at the playhead; the marker appears on the ruler.
- SDK: `studio.markers.add`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Remove Selected Marker
- Where: Editor › Timeline › tool strip
- Does: Deletes the marker currently selected.
- SDK: `studio.markers.remove`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Clear All Markers
- Where: Editor › Timeline › tool strip
- Does: Deletes every marker on the timeline.
- SDK: `studio.markers.clear`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Smooth edit…
- Where: Editor › Timeline › tool strip › sparkle button
- Does: Opens a dialog that cuts the video clips to a song's beats, one bar or more a shot, with the smooth-edit look and short crossfades, as one undo step.
- SDK: `studio.clips.smoothEditTimeline`
- Code: `src/studio/smooth-edit/dialog.tsx`

### Record voiceover
- Where: Editor › Timeline › tool strip
- Does: Records from the microphone while the timeline plays and adds the take at the playhead.
- SDK: `none`
- Code: `src/features/timeline/components/mic-record-control.tsx`

### Microphone settings
- Where: Editor › Timeline › tool strip
- Does: Chooses the microphone and how the voiceover is recorded.
- SDK: `none`
- Code: `src/features/timeline/components/mic-record-control.tsx`

### Noise suppression
- Where: Editor › Timeline › microphone settings
- Does: Filters background noise out of the recorded voiceover.
- SDK: `none`
- Code: `src/features/timeline/components/mic-record-control.tsx`

### Auto gain
- Where: Editor › Timeline › microphone settings
- Does: Keeps the recorded voiceover at a steady level.
- SDK: `none`
- Code: `src/features/timeline/components/mic-record-control.tsx`

### Mute timeline while recording
- Where: Editor › Timeline › microphone settings
- Does: Silences the project's own audio through the speakers while recording.
- SDK: `none`
- Code: `src/features/timeline/components/mic-record-control.tsx`

### Sync offset
- Where: Editor › Timeline › microphone settings
- Does: Shifts the recorded take earlier or later so it lines up with the picture.
- SDK: `none`
- Code: `src/features/timeline/components/mic-record-control.tsx`

### Pause recording
- Where: Editor › Timeline › recording overlay
- Does: Pauses the voiceover take without discarding it.
- SDK: `none`
- Code: `src/features/timeline/components/mic-record-control.tsx`

### Stop and save
- Where: Editor › Timeline › recording overlay
- Does: Stops recording and adds the take to the timeline.
- SDK: `none`
- Code: `src/features/timeline/components/mic-record-control.tsx`

### Cancel recording
- Where: Editor › Timeline › recording overlay
- Does: Stops recording and discards the take.
- SDK: `none`
- Code: `src/features/timeline/components/mic-record-control.tsx`

### Snap Enabled
- Where: Editor › Timeline › tool strip
- Does: Turns magnetic snapping to clip edges, the playhead and markers on or off.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Audio Skimming Enabled
- Where: Editor › Timeline › tool strip
- Does: Plays short bits of audio while the mouse moves over the timeline.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Show keyframe panel
- Where: Editor › Timeline › tool strip
- Does: Opens the Keyframe Editor under the timeline for the selected clip.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Linked Selection On
- Where: Editor › Timeline › tool strip
- Does: Selects a clip's linked audio and video together when one is clicked.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Zoom Out
- Where: Editor › Timeline › tool strip
- Does: Shows more time in the same width.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Zoom In
- Where: Editor › Timeline › tool strip
- Does: Shows less time, larger, around the playhead.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Zoom To Fit
- Where: Editor › Timeline › tool strip
- Does: Fits the whole sequence in the timeline's width.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-header.tsx`

### Zoom Slider
- Where: Editor › Timeline › tool strip
- Does: Drags smoothly between the minimum and maximum timeline zoom.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-header.tsx`

## Ruler, playhead and markers

### Ruler
- Where: Editor › Timeline › above the tracks
- Does: Click or drag to move the playhead; the time labels follow the project frame rate.
- SDK: `studio.playback.seek`
- Code: `src/features/timeline/components/timeline-ruler-surface.tsx`

### Playhead
- Where: Editor › Timeline › ruler and tracks
- Does: Can be dragged to scrub; the preview follows it.
- SDK: `studio.playback.seek`
- Code: `src/features/timeline/components/timeline-playhead.tsx`

### Marker
- Where: Editor › Timeline › ruler
- Does: A coloured point on the ruler; drag it to move it, click to select it and edit its label in Properties.
- SDK: `studio.markers.update`
- Code: `src/features/timeline/components/timeline-project-markers.tsx`

### In point
- Where: Editor › Timeline › ruler
- Does: The start of the in/out range; drag it to change the range.
- SDK: `studio.markers.setIn`
- Code: `src/features/timeline/components/timeline-in-out-markers.tsx`

### Out point
- Where: Editor › Timeline › ruler
- Does: The end of the in/out range; drag it to change the range.
- SDK: `studio.markers.setOut`
- Code: `src/features/timeline/components/timeline-in-out-markers.tsx`

### Rendered preview bar
- Where: Editor › Timeline › bottom of the ruler
- Does: A green line over the frames that play from the pre-render; a part an edit made stale disappears at once.
- SDK: `studio.preview.prerendered`
- Code: `src/studio/prerender/ui/PrerenderBar.tsx`

## Tracks

### Track size
- Where: Editor › Timeline › above the track headers
- Does: Sets how tall every track is: Compact, Medium or Large.
- SDK: `none`
- Code: `src/features/timeline/components/timeline.tsx`

### Add track
- Where: Editor › Timeline › above the track headers
- Does: Adds a video track above the others or an audio track below them.
- SDK: `studio.tracks.add`
- Code: `src/features/timeline/components/timeline.tsx`

### Remove Selected Tracks
- Where: Editor › Timeline › above the track headers
- Does: Deletes the selected tracks and their clips.
- SDK: `studio.tracks.remove`
- Code: `src/features/timeline/components/timeline.tsx`

### Disable track
- Where: Editor › Timeline › track header
- Does: Mutes a video or audio track without deleting it; reads Enable track when off.
- SDK: `studio.tracks.update`
- Code: `src/features/timeline/components/track-header.tsx`

### Solo Track
- Where: Editor › Timeline › track header
- Does: Plays only this track (and the other soloed ones).
- SDK: `studio.tracks.update`
- Code: `src/features/timeline/components/track-header.tsx`

### Lock Track
- Where: Editor › Timeline › track header
- Does: Prevents edits to the track's clips until unlocked.
- SDK: `studio.tracks.update`
- Code: `src/features/timeline/components/track-header.tsx`

### Disable sync lock
- Where: Editor › Timeline › track header
- Does: Stops the track from rippling with edits on the other tracks.
- SDK: `studio.tracks.update`
- Code: `src/features/timeline/components/track-header.tsx`

### Close All Gaps
- Where: Editor › Timeline › track header
- Does: Moves the track's clips left so the empty spaces between them disappear.
- SDK: `none`
- Code: `src/features/timeline/components/track-header.tsx`

### Track menu
- Where: Editor › Timeline › right-click a track header
- Does: Opens the track actions: Close All Gaps, Add Video Track, Add Audio Track, Delete Track, Delete Empty Tracks.
- SDK: `none`
- Code: `src/features/timeline/components/track-header.tsx`

### Delete Track
- Where: Editor › Timeline › track menu
- Does: Deletes the track and its clips.
- SDK: `studio.tracks.remove`
- Code: `src/features/timeline/components/track-header.tsx`

### Delete Empty Tracks
- Where: Editor › Timeline › track menu
- Does: Removes every track that holds no clips.
- SDK: `none`
- Code: `src/features/timeline/components/track-header.tsx`

### Resize V1 height
- Where: Editor › Timeline › track row divider
- Does: Drags the boundary under a track to make that track taller or shorter.
- SDK: `studio.tracks.update`
- Code: `src/features/timeline/components/timeline-track.tsx`

### Resize video and audio track sections
- Where: Editor › Timeline › divider between the video and audio tracks
- Does: Changes how much height the video tracks get compared with the audio tracks.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-track.tsx`

## Clips

### Clip
- Where: Editor › Timeline › track
- Does: A placed piece of media or generated layer; click to select, drag to move, drag an edge to trim.
- SDK: `studio.clips.move`
- Code: `src/features/timeline/components/timeline-item/index.tsx`

### Trim handle
- Where: Editor › Timeline › clip edge
- Does: Shortens or lengthens the clip from that edge without changing its speed.
- SDK: `studio.clips.trimStart`
- Code: `src/features/timeline/components/timeline-item/stretch-handles.tsx`

### Rate stretch handle
- Where: Editor › Timeline › clip edge with the Rate Stretch tool
- Does: Drags the edge to make the clip play slower or faster.
- SDK: `studio.clips.setSpeed`
- Code: `src/features/timeline/components/timeline-item/stretch-handles.tsx`

### Adjust audio fade in
- Where: Editor › Timeline › audio clip › top-left corner handle
- Does: Drags the fade length at the start of the clip's audio.
- SDK: `studio.clips.update`
- Code: `src/features/timeline/components/timeline-item/audio-fade-handles.tsx`

### Adjust audio fade out
- Where: Editor › Timeline › audio clip › top-right corner handle
- Does: Drags the fade length at the end of the clip's audio.
- SDK: `studio.clips.update`
- Code: `src/features/timeline/components/timeline-item/audio-fade-handles.tsx`

### Adjust video fade in
- Where: Editor › Timeline › visual clip › top-left corner handle
- Does: Drags the fade-in length of the clip's picture.
- SDK: `studio.clips.update`
- Code: `src/features/timeline/components/timeline-item/video-fade-handles.tsx`

### Adjust video fade out
- Where: Editor › Timeline › visual clip › top-right corner handle
- Does: Drags the fade-out length of the clip's picture.
- SDK: `studio.clips.update`
- Code: `src/features/timeline/components/timeline-item/video-fade-handles.tsx`

### Adjust clip volume
- Where: Editor › Timeline › audio clip › speaker button
- Does: Sets the clip's volume from a small slider without opening Properties.
- SDK: `studio.clips.update`
- Code: `src/features/timeline/components/timeline-item/audio-volume-control.tsx`

### Speed: {speed}x
- Where: Editor › Timeline › clip badge
- Does: Shows that a clip is retimed and at what speed.
- SDK: `studio.clips.setSpeed`
- Code: `src/features/timeline/components/timeline-item/clip-indicators.tsx`

### Reversed Playback
- Where: Editor › Timeline › clip badge
- Does: Shows that the clip plays backwards; click the badge to reverse it again.
- SDK: `studio.clips.update`
- Code: `src/features/timeline/components/timeline-item/clip-indicators.tsx`

### Has Keyframes
- Where: Editor › Timeline › clip badge
- Does: Shows that the clip has animation; click it to open the keyframe editor.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/clip-indicators.tsx`

### Mask
- Where: Editor › Timeline › clip badge
- Does: Shows that the clip has a mask; click it to edit the mask.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/clip-indicators.tsx`

### Media Missing
- Where: Editor › Timeline › clip badge
- Does: Shows that the clip's media file cannot be found.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/clip-indicators.tsx`

### Clip menu
- Where: Editor › Timeline › right-click a clip
- Does: Opens the clip actions: grade copy/paste, joins, linking, keyframes, layout, reverse, freeze frame, silence and filler removal, scene detection, captions, compound clips, delete.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Copy grade
- Where: Editor › Timeline › clip menu
- Does: Copies the selected clip's colour grade.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Paste grade
- Where: Editor › Timeline › clip menu
- Does: Applies the copied grade to the clicked clip.
- SDK: `studio.effects.update`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Join With Previous
- Where: Editor › Timeline › clip menu
- Does: Merges the clip with the clip before it when they touch and match.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Join With Next
- Where: Editor › Timeline › clip menu
- Does: Merges the clip with the clip after it when they touch and match.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Join Selected
- Where: Editor › Timeline › clip menu
- Does: Merges the selected clips into one where they are adjacent.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Link Clips
- Where: Editor › Timeline › clip menu
- Does: Links the selected audio and video clips so they move and trim together.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Unlink Clips
- Where: Editor › Timeline › clip menu
- Does: Breaks the link so audio and video can be edited separately.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Clear Keyframes
- Where: Editor › Timeline › clip menu
- Does: Removes all keyframes, or the keyframes of one property, from the selected clips.
- SDK: `studio.keyframes.removeAll`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Clear Keyframes dialog
- Where: Editor › Timeline › Clear Keyframes
- Does: Confirms clearing the keyframes and says that it can be undone.
- SDK: `studio.keyframes.removeAll`
- Code: `src/features/editor/components/clear-keyframes-dialog.tsx`

### Bento Layout
- Where: Editor › Timeline › clip menu
- Does: Arranges the selected clips into a grid of preset or custom size.
- SDK: `none`
- Code: `src/features/timeline/components/bento-layout-dialog.tsx`

### Apply
- Where: Editor › Timeline › Bento layout dialog
- Does: Applies the chosen grid arrangement to the selected clips.
- SDK: `none`
- Code: `src/features/timeline/components/bento-layout-dialog.tsx`

### Save As Preset
- Where: Editor › Timeline › Bento layout dialog
- Does: Saves the current gap and padding as a reusable bento preset.
- SDK: `none`
- Code: `src/features/timeline/components/bento-layout-dialog.tsx`

### Reverse
- Where: Editor › Timeline › clip menu
- Does: Makes the clip play backwards; reads Unreverse once it does.
- SDK: `studio.clips.update`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Insert Freeze Frame
- Where: Editor › Timeline › clip menu
- Does: Holds the frame at the playhead for a chosen duration.
- SDK: `studio.clips.add`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Remove Silence
- Where: Editor › Timeline › clip menu
- Does: Finds the quiet parts of the selected clips and cuts them out.
- SDK: `none`
- Code: `src/features/timeline/components/silence-removal-dialog.tsx`

### Remove filler words
- Where: Editor › Timeline › clip menu
- Does: Finds “um”, “uh” and other filler words in the transcript and cuts them out.
- SDK: `none`
- Code: `src/features/timeline/components/filler-removal-dialog.tsx`

### Generate Audio From Text
- Where: Editor › Timeline › clip menu
- Does: Opens the text-to-speech panel to generate a voiceover from typed text.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Detect Scenes & Split
- Where: Editor › Timeline › clip menu
- Does: Finds the cuts in the clip and splits it at them, using a fast histogram or an AI model.
- SDK: `studio.clips.split`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Generate Captions
- Where: Editor › Timeline › clip menu
- Does: Creates subtitle clips from the clip's transcript, or regenerates them.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Consolidate Captions To Segment
- Where: Editor › Timeline › clip menu
- Does: Joins the caption clips over the selection into one subtitle segment.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Create Compound Clip
- Where: Editor › Timeline › clip menu
- Does: Packs the selected clips into a nested composition that is placed as one clip.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Open Compound Clip
- Where: Editor › Timeline › clip menu
- Does: Opens the compound clip's contents in a timeline tab.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Dissolve Compound Clip
- Where: Editor › Timeline › clip menu
- Does: Replaces the compound clip with its contents on the main timeline.
- SDK: `none`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Ripple Delete
- Where: Editor › Timeline › clip menu
- Does: Deletes the clip and closes the gap by moving the clips after it.
- SDK: `studio.clips.remove`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Delete
- Where: Editor › Timeline › clip menu
- Does: Deletes the selected clips and leaves a gap.
- SDK: `studio.clips.remove`
- Code: `src/features/timeline/components/timeline-item/item-context-menu.tsx`

### Transition
- Where: Editor › Timeline › between two adjacent clips
- Does: Drag an edge to lengthen or shorten the transition; click it to edit it in Properties.
- SDK: `studio.transitions.update`
- Code: `src/features/timeline/components/transition-item.tsx`

### Drag media here to start editing
- Where: Editor › Timeline › empty timeline
- Does: Explains that media is dragged from the left sidebar onto a track.
- SDK: `none`
- Code: `src/features/timeline/components/timeline.tsx`

## Keyframe editor

### Keyframe Editor
- Where: Editor › Timeline › bottom panel
- Does: Shows and edits the keyframes of the selected clip's properties on a grid or as value curves.
- SDK: `studio.keyframes.list`
- Code: `src/features/timeline/components/keyframe-graph-panel.tsx`

### Sheet
- Where: Editor › Timeline › Keyframe Editor
- Does: Shows every property's keyframes on one time grid to see and move them.
- SDK: `none`
- Code: `src/features/timeline/components/keyframe-graph-panel-header.tsx`

### Graph
- Where: Editor › Timeline › Keyframe Editor
- Does: Shows each property's value curve and its easing handles.
- SDK: `none`
- Code: `src/features/timeline/components/keyframe-graph-panel-header.tsx`

### Split
- Where: Editor › Timeline › Keyframe Editor
- Does: Shows the grid and the value curve side by side.
- SDK: `none`
- Code: `src/features/timeline/components/keyframe-graph-panel-header.tsx`

### Close
- Where: Editor › Timeline › Keyframe Editor › header
- Does: Closes the keyframe editor.
- SDK: `none`
- Code: `src/features/timeline/components/keyframe-graph-panel-header.tsx`

### Select an item to edit keyframes
- Where: Editor › Timeline › Keyframe Editor
- Does: The empty state shown until a clip is selected.
- SDK: `none`
- Code: `src/features/timeline/components/keyframe-graph-panel.tsx`

## Speed curve

### Speed curve
- Where: Editor › Timeline › bottom panel, opened by Properties › Video tab › Playback › Curve…
- Does: Shows the clip's speed over its timeline frames, with a handle per key, the source frame of each key, and the speed at the playhead, the clip length and the source frames the curve spends.
- SDK: `studio.clips.getSpeedCurve`
- Code: `src/studio/speed/panel/speed-curve-panel.tsx`

### Speed curve handle
- Where: Editor › Timeline › Speed curve
- Does: Drags a key's speed and frame; the clip's end and the clips after it follow while dragging, and releasing is one undo step. The first and last keys stay on the clip's ends.
- SDK: `studio.clips.setSpeedCurve`
- Code: `src/studio/speed/panel/speed-curve-graph.tsx`

### Key speed
- Where: Editor › Timeline › Speed curve › key list
- Does: Sets one key's speed in x; the clip's length follows the curve's average.
- SDK: `studio.clips.setSpeedCurve`
- Code: `src/studio/speed/panel/speed-curve-panel.tsx`

### Key frame
- Where: Editor › Timeline › Speed curve › key list
- Does: Moves a key to a clip-relative timeline frame, kept between its neighbours; the first and last keys are pinned to the clip's ends.
- SDK: `studio.clips.setSpeedCurve`
- Code: `src/studio/speed/panel/speed-curve-panel.tsx`

### Ramp in
- Where: Editor › Timeline › Speed curve › header
- Does: Replaces the curve with a ramp from 1x up to the peak speed, held to the clip's end.
- SDK: `studio.clips.setSpeedPreset`
- Code: `src/studio/speed/panel/speed-curve-panel.tsx`

### Ramp out
- Where: Editor › Timeline › Speed curve › header
- Does: Replaces the curve with the peak speed held from the start, then down to 1x at the clip's end.
- SDK: `studio.clips.setSpeedPreset`
- Code: `src/studio/speed/panel/speed-curve-panel.tsx`

### Ramp in and out
- Where: Editor › Timeline › Speed curve › header
- Does: Replaces the curve with a ramp up from 1x, a hold at the peak speed and a ramp down to 1x.
- SDK: `studio.clips.setSpeedPreset`
- Code: `src/studio/speed/panel/speed-curve-panel.tsx`

### Flat
- Where: Editor › Timeline › Speed curve › header
- Does: Removes the curve, leaving the clip at one speed: its current average.
- SDK: `studio.clips.setSpeedCurve`
- Code: `src/studio/speed/panel/speed-curve-panel.tsx`

### Peak speed
- Where: Editor › Timeline › Speed curve › header
- Does: The speed the preset buttons ramp to, in x, 0.1 to 10; 4 until changed.
- SDK: `studio.clips.setSpeedPreset`
- Code: `src/studio/speed/panel/speed-curve-panel.tsx`

### Ramp length
- Where: Editor › Timeline › Speed curve › header
- Does: The length of the preset ramps, in frames; 15 until changed.
- SDK: `studio.clips.setSpeedPreset`
- Code: `src/studio/speed/panel/speed-curve-panel.tsx`

### Speed at playhead
- Where: Editor › Timeline › Speed curve › readout
- Does: The speed the curve holds at the playhead, in x.
- SDK: `studio.clips.speedAt`
- Code: `src/studio/speed/panel/speed-curve-panel.tsx`

### Clip length and source frames
- Where: Editor › Timeline › Speed curve › readout
- Does: The clip's length in timeline frames and the source frames the curve spends, recomputed as the keys or the length change.
- SDK: `studio.clips.getSpeedCurve`
- Code: `src/studio/speed/panel/speed-curve-panel.tsx`

### Source frame ruler
- Where: Editor › Timeline › Speed curve › under the graph
- Does: The source frame the clip shows at each key and at the playhead.
- SDK: `studio.clips.getSpeedCurve`
- Code: `src/studio/speed/panel/speed-curve-graph.tsx`
