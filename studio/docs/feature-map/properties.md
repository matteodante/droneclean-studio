# Properties (inspector)

The **Properties** panel is the right column of the editor. With nothing selected it shows the canvas; with a clip
selected it shows the clip's inspector tabs; with a transition or a marker selected it shows that instead. In the
Color workspace the panel is the colour grading dock.

## Panel

### Properties
- Where: Editor › right column › header
- Does: The title of the panel; the same panel is called Properties in the Edit and Motion workspaces.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/index.tsx`

### Dock to preview
- Where: Editor › Properties › header
- Does: Moves the Properties panel under the preview instead of the full-height column.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/index.tsx`

### Expand full column
- Where: Editor › Properties › header
- Does: Makes the Properties panel span the full height of the editor.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/index.tsx`

### Collapse panel
- Where: Editor › Properties › header
- Does: Hides the Properties panel; the arrow at the right edge brings it back.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/index.tsx`

## Canvas

### Canvas
- Where: Editor › Properties, with nothing selected › Canvas
- Does: The project's canvas size, background and duration.
- SDK: `studio.project.set`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/index.tsx`

### W
- Where: Editor › Properties › Canvas
- Does: The canvas width in pixels, from 320 to 7680.
- SDK: `studio.project.set`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/index.tsx`

### H
- Where: Editor › Properties › Canvas
- Does: The canvas height in pixels, from 240 to 4320.
- SDK: `studio.project.set`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/index.tsx`

### Lock aspect ratio
- Where: Editor › Properties › Canvas › between W and H
- Does: Keeps the width and height proportional when either changes.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/index.tsx`

### Swap
- Where: Editor › Properties › Canvas
- Does: Exchanges the width and height, turning a landscape canvas into a portrait one.
- SDK: `studio.project.set`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/index.tsx`

### Reset
- Where: Editor › Properties › Canvas
- Does: Puts the canvas size back to the project's original size.
- SDK: `studio.project.set`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/index.tsx`

### Background
- Where: Editor › Properties › Canvas
- Does: The colour behind every clip.
- SDK: `studio.project.set`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/index.tsx`

### Reset to black
- Where: Editor › Properties › Canvas › Background
- Does: Sets the canvas background back to black.
- SDK: `studio.project.set`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/index.tsx`

### Duration
- Where: Editor › Properties › Canvas › Duration
- Does: The length of the sequence, and its frame rate and total frames.
- SDK: `studio.project.duration`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/index.tsx`

### Frame Rate
- Where: Editor › Properties › Canvas › Duration
- Does: The project's frame rate, shown read-only.
- SDK: `studio.project.rate`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/index.tsx`

### Total Frames
- Where: Editor › Properties › Canvas › Duration
- Does: The sequence length counted in frames.
- SDK: `studio.project.duration`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/index.tsx`

### Markers
- Where: Editor › Properties › Canvas › Markers
- Does: Lists the timeline's markers and their times; a click selects one.
- SDK: `studio.markers.list`
- Code: `src/features/editor/components/properties-sidebar/marker-panel/marker-list.tsx`

### No markers
- Where: Editor › Properties › Canvas › Markers
- Does: The empty state, with the hint “Press M to add a marker at the playhead”.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/marker-panel/marker-list.tsx`

### Clear all
- Where: Editor › Properties › Markers list
- Does: Deletes every marker of the timeline.
- SDK: `studio.markers.clear`
- Code: `src/features/editor/components/properties-sidebar/marker-panel/marker-list.tsx`

### Remove marker
- Where: Editor › Properties › Markers list › row
- Does: Deletes that marker.
- SDK: `studio.markers.remove`
- Code: `src/features/editor/components/properties-sidebar/marker-panel/marker-list.tsx`

### Match Project
- Where: Editor › Properties › Canvas, inside a composition
- Does: Gives the composition the project's canvas size and background again.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/index.tsx`

### Published controls
- Where: Editor › Properties › Canvas, inside a Motion composition
- Does: Chooses which text and colours of the composition stay editable when it is reused.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/canvas-panel/composition-controls-authoring-section.tsx`

## Clip inspector tabs

### Video
- Where: Editor › Properties › selected clip › first tab
- Does: The clip's layout, playback, crop, fill and type-specific sections; named Text, Shape or Null Object for those clips.
- SDK: `studio.clips.get`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/index.tsx`

### Audio
- Where: Editor › Properties › selected clip with sound
- Does: The clip's volume, fades, pitch and equalizer.
- SDK: `studio.clips.get`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/index.tsx`

### Effects
- Where: Editor › Properties › selected visual clip
- Does: The effects applied to the clip, with the Add Effect picker and the effect parameters.
- SDK: `studio.effects.list`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/index.tsx`

### Animation
- Where: Editor › Properties › selected visual clip
- Does: The clip's animation presets and authored keyframes; named Animate in the Motion workspace.
- SDK: `studio.keyframes.list`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/index.tsx`

### Quick animate
- Where: Editor › Properties › Animation tab
- Does: Ready-made clip animations that stay editable in the timing lane.
- SDK: `studio.keyframes.add`
- Code: `src/features/editor/components/animate-workspace/animation-preset-library.tsx`

### Text Animation (Clip)
- Where: Editor › Properties › Animation tab
- Does: Animates characters, words, lines or the whole text clip.
- SDK: `studio.keyframes.add`
- Code: `src/features/editor/components/text-motion/text-motion-slot-rows.tsx`

### Create Motion Clip
- Where: Editor › Properties › Animation tab
- Does: Promotes the clip to a layered Motion composition for advanced animation.
- SDK: `none`
- Code: `src/features/editor/components/animate-workspace/animation-preset-library.tsx`

### Open in Motion
- Where: Editor › Properties › Animation tab, on a Motion composition
- Does: Opens the layered composition in the Motion workspace.
- SDK: `none`
- Code: `src/features/editor/components/animate-workspace/animation-preset-library.tsx`

## Layout

### Transform
- Where: Editor › Properties › Video tab › Transform
- Does: The group of controls that place the clip on the canvas.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/layout-section.tsx`

### Position
- Where: Editor › Properties › Video tab › Transform
- Does: Moves the clip horizontally and vertically on the canvas.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/layout-section.tsx`

### Size
- Where: Editor › Properties › Video tab › Transform
- Does: Scales the clip on the canvas, with a lock that keeps it proportional.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/layout-section.tsx`

### Rotation
- Where: Editor › Properties › Video tab › Transform
- Does: Rotates the clip in degrees.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/layout-section.tsx`

### Anchor
- Where: Editor › Properties › Video tab › Transform
- Does: Sets the point the clip scales and rotates around.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/layout-section.tsx`

### Flip
- Where: Editor › Properties › Video tab › Transform
- Does: Mirrors the picture horizontally or vertically.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/layout-section.tsx`

## Playback and crop

### Playback
- Where: Editor › Properties › Video tab › Playback
- Does: The clip's speed and its picture fades.
- SDK: `studio.clips.setSpeed`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/video-section.tsx`

### Speed
- Where: Editor › Properties › Video tab › Playback
- Does: Changes how fast the clip plays and stretches its length to match; setting one speed clears the clip's speed curve.
- SDK: `studio.clips.setSpeed`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/video-section.tsx`

### Curve…
- Where: Editor › Properties › Video tab › Playback › beside Speed
- Does: Opens the speed curve dock under the timeline for the selected clip; disabled for a multi-selection and for a reversed clip, with the reason.
- SDK: `studio.clips.setSpeedCurve`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/video-section.tsx`

### Motion blur
- Where: Editor › Properties › Video tab › Playback › Motion blur
- Does: Switches a clip's motion blur on or off (one undo step); hidden by the `motionBlur` feature switch until the export stage and the preview draw it.
- SDK: `studio.clips.setMotionBlur`
- Code: `src/studio/motion-blur/ui/MotionBlurRows.tsx`

### Shutter
- Where: Editor › Properties › Video tab › Playback › Motion blur › Shutter
- Does: Picks the shutter angle (90, 180, 270 or 360 degrees) the blur blends the sped-up frames with; shown only while the blur is on.
- SDK: `studio.clips.getMotionBlur`
- Code: `src/studio/motion-blur/ui/MotionBlurRows.tsx`

### Smooth slow motion
- Where: Editor › Properties › Video tab › Playback › Motion blur › Smooth slow motion
- Does: Where an output frame covers less than one source frame (a clip slower than 1x, or a 30 fps file in a 60 fps project), blends the two source frames around it by position instead of showing one frame twice; shown only while the blur is on.
- SDK: `studio.clips.setMotionBlur`
- Code: `src/studio/motion-blur/ui/MotionBlurRows.tsx`

### Fade In
- Where: Editor › Properties › Video tab › Playback
- Does: Fades the picture in from black over the given time.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/video-section.tsx`

### Fade Out
- Where: Editor › Properties › Video tab › Playback
- Does: Fades the picture out to black over the given time.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/video-section.tsx`

### Cropping
- Where: Editor › Properties › Video tab
- Does: Cuts away the edges of the picture inside the clip.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/video-section.tsx`

### Crop Left
- Where: Editor › Properties › Video tab › Cropping
- Does: Cuts that many pixels from the left edge.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/video-section.tsx`

### Crop Right
- Where: Editor › Properties › Video tab › Cropping
- Does: Cuts that many pixels from the right edge.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/video-section.tsx`

### Crop Top
- Where: Editor › Properties › Video tab › Cropping
- Does: Cuts that many pixels from the top edge.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/video-section.tsx`

### Crop Bottom
- Where: Editor › Properties › Video tab › Cropping
- Does: Cuts that many pixels from the bottom edge.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/video-section.tsx`

### Softness
- Where: Editor › Properties › Video tab › Cropping
- Does: Blurs the cropped edges so they do not look cut.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/video-section.tsx`

## Stabilization

Hidden by the `stabilization` feature switch. Each change is one undo step. An agent switches the clip on and sets every value in one call, `studio.clips.setStabilization`, and reads them back with `studio.clips.getStabilization`.

### Stabilize this clip
- Where: Editor › Properties › Video tab › Stabilization
- Does: Switches the gyro stabilization of the selected video clip on or off; the section says so when the clip has no motion data or no lens profile.
- SDK: `studio.clips.setStabilization`
- Code: `src/studio/stabilization/ui/StabilizationSection.tsx`

### Smoothness
- Where: Editor › Properties › Video tab › Stabilization
- Does: How strongly the camera path is smoothed.
- SDK: `studio.clips.setStabilization`
- Code: `src/studio/stabilization/ui/StabilizationSection.tsx`

### Horizon lock
- Where: Editor › Properties › Video tab › Stabilization
- Does: How much of the horizon tilt is held level, in percent.
- SDK: `studio.clips.setStabilization`
- Code: `src/studio/stabilization/ui/StabilizationSection.tsx`

### Horizon roll
- Where: Editor › Properties › Video tab › Stabilization
- Does: The angle the locked horizon is held at.
- SDK: `studio.clips.setStabilization`
- Code: `src/studio/stabilization/ui/StabilizationSection.tsx`

### Zoom
- Where: Editor › Properties › Video tab › Stabilization
- Does: The field of view kept after stabilizing: the zoom that hides the borders.
- SDK: `studio.clips.setStabilization`
- Code: `src/studio/stabilization/ui/StabilizationSection.tsx`

### Adaptive zoom
- Where: Editor › Properties › Video tab › Stabilization
- Does: Lets the zoom change over a window of seconds instead of staying fixed.
- SDK: `studio.clips.setStabilization`
- Code: `src/studio/stabilization/ui/StabilizationSection.tsx`

### Lens profile
- Where: Editor › Properties › Video tab › Stabilization
- Does: Shows the name of the lens profile the clip is stabilized with.
- SDK: none (view only)
- Code: `src/studio/stabilization/ui/StabilizationSection.tsx`

## Colour profile and looks

The colour profile and the creative look of a video clip (task 5.2); each is one undo step.

### Colour profile
- Where: Editor › Properties › Video tab › Colour profile
- Does: Sets the input colour profile of the selected video clips: DJI D-Log M, DJI D-Log, or none; "Not set" is no answer yet.
- SDK: `studio.clips.setColorProfile`
- Code: `src/studio/presets/ColorPresetSection.tsx`

### Suggested profile
- Where: Editor › Properties › Video tab › Colour profile
- Does: Shows the profile the file name and drone model hint at, with one Apply press that writes it as the clip's profile.
- SDK: `studio.clips.setColorProfile`
- Code: `src/studio/presets/ColorPresetSection.tsx`

### Look
- Where: Editor › Properties › Video tab › Looks
- Does: Picks the creative look, a .cube file of the looks library, that the selected video clips are graded with after the colour profile; "No look" removes it.
- SDK: `studio.clips.setLook`
- Code: `src/studio/looks/LooksSection.tsx`

### Look intensity
- Where: Editor › Properties › Video tab › Looks
- Does: How much of the look is blended with the untouched picture, from 0 to 100 percent.
- SDK: `studio.clips.setLook`
- Code: `src/studio/looks/LooksSection.tsx`

### Looks library
- Where: Editor › Properties › Video tab › Looks › Manage looks
- Does: Lists the looks of the workspace's library, which the pilot extends by adding .cube files in the dialog it opens; an agent reads the list to pick a look id.
- SDK: `studio.looks.list`
- Code: `src/studio/looks/LooksSection.tsx`

### Add a look
- Where: Editor › Properties › Video tab › Looks › Manage looks › Add .cube
- Does: Adds a .cube file (a 3D table of 65 points per side at most) to the workspace's looks library, so any clip of any project can use it; an agent passes the file's text, which its code can compute in the same call.
- SDK: `studio.looks.add`
- Code: `src/studio/looks/LooksLibraryDialog.tsx`

## DroneClean shadow removal

Hidden by the `shadowRemovalClean` feature switch. Cleaning spends the user's credits; an agent cannot sign in, so the user approves that in the app.

### Mark the shadow
- Where: Editor › Properties › Video tab › Shadow
- Does: Arms the preview so the next click on the picture marks the drone's shadow, in source pixels, on the frame the playhead shows.
- SDK: `studio.shadow.mark`
- Code: `src/studio/shadow/ui/ShadowSection.tsx`

### Follow the shadow
- Where: Editor › Properties › Video tab › Shadow
- Does: Runs the free tracking pass on the clip's part of the source and shows the stretches where the shadow was found.
- SDK: `studio.shadow.follow`
- Code: `src/studio/shadow/ui/ShadowSection.tsx`

### Shadow session
- Where: Editor › Properties › Video tab › Shadow
- Does: Shows the mark, the stage and progress of the work, the stretches found, the price in credits and the balance, and the last failure.
- SDK: `studio.shadow.get`
- Code: `src/studio/shadow/ui/ShadowSection.tsx`

### Price of the clean
- Where: Editor › Properties › Video tab › Shadow
- Does: Asks the price of cleaning the found stretches again, which also reads the balance again after credits were bought.
- SDK: `studio.shadow.quote`
- Code: `src/studio/shadow/ui/ShadowSection.tsx`

### Clean the shadow
- Where: Editor › Properties › Video tab › Shadow
- Does: Pays the price shown and removes the shadow from the found stretches; the cleaned file is kept in the project. An agent must pass the credits it expects, and the clean is refused unless they equal the current price.
- SDK: `studio.shadow.clean`
- Code: `src/studio/shadow/ui/CleanShadowPanel.tsx`

### Sign in again
- Where: Editor › Properties › Video tab › Shadow
- Does: Starts the DroneClean sign-in in the browser; only the user can approve it.
- SDK: none (view only)
- Code: `src/studio/shadow/ui/ShadowSection.tsx`

## Composite

### Composite
- Where: Editor › Properties › Video tab › Composite
- Does: How the clip is blended with what is under it.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/fill-section.tsx`

### Opacity
- Where: Editor › Properties › Video tab › Composite
- Does: Sets how transparent the clip is, from 0 to 100%.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/fill-section.tsx`

### Blend
- Where: Editor › Properties › Video tab › Composite
- Does: Chooses the blend mode (Normal, Multiply, Screen…) used with the layers below.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/fill-section.tsx`

### Radius
- Where: Editor › Properties › Video tab › Composite
- Does: Rounds the clip's corners.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/fill-section.tsx`

### Corner Pin
- Where: Editor › Properties › Video tab › Corner Pin
- Does: Turns on the corner pin editor for the clip's four corners.
- SDK: `studio.effects.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/corner-pin-section.tsx`

## Audio

### Audio
- Where: Editor › Properties › Audio tab
- Does: The clip's sound: gain, fades, pitch and equalizer.
- SDK: `studio.clips.get`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/audio-section.tsx`

### Gain
- Where: Editor › Properties › Audio tab › Audio
- Does: The clip's volume in dB, from -60 (silent) to +12.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/audio-section.tsx`

### Fade In
- Where: Editor › Properties › Audio tab › Audio
- Does: Fades the clip's sound in over the given seconds.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/audio-section.tsx`

### Fade Out
- Where: Editor › Properties › Audio tab › Audio
- Does: Fades the clip's sound out over the given seconds.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/audio-section.tsx`

### Pitch
- Where: Editor › Properties › Audio tab
- Does: Shifts the clip's sound up or down without changing its speed.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/audio-section.tsx`

### Semi Tones
- Where: Editor › Properties › Audio tab › Pitch
- Does: The pitch shift in musical semitones.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/audio-section.tsx`

### Cents
- Where: Editor › Properties › Audio tab › Pitch
- Does: Fine pitch, in hundredths of a semitone.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/audio-section.tsx`

### Equalizer
- Where: Editor › Properties › Audio tab
- Does: A multi-band equalizer with a curve that can be dragged.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/audio-eq-panel-content.tsx`

## Text clips

### Text
- Where: Editor › Properties › Text tab
- Does: The clip's text, its look and its animation.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-section.tsx`

### Content
- Where: Editor › Properties › Text tab
- Does: The words of each span and which preset layout the text uses: Single, 2 Spans or 3 Spans.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-content-controls.tsx`

### Font
- Where: Editor › Properties › Text tab › Style
- Does: The typeface of the text.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-typography-controls.tsx`

### Size
- Where: Editor › Properties › Text tab › Style
- Does: The text's font size.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-typography-controls.tsx`

### Weight
- Where: Editor › Properties › Text tab › Style
- Does: How bold the typeface is.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-typography-controls.tsx`

### Bold
- Where: Editor › Properties › Text tab › Style
- Does: Makes the text bold when the font has a bold face.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-typography-controls.tsx`

### Italic
- Where: Editor › Properties › Text tab › Style
- Does: Slants the text.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-typography-controls.tsx`

### Underline
- Where: Editor › Properties › Text tab › Style
- Does: Draws a line under the text.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-typography-controls.tsx`

### Color
- Where: Editor › Properties › Text tab › Style
- Does: The colour of the text.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-color-controls.tsx`

### Background
- Where: Editor › Properties › Text tab › Style
- Does: The colour of the box behind the text.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-color-controls.tsx`

### Align
- Where: Editor › Properties › Text tab › Style
- Does: Aligns the text left, centre or right, and to the top, middle or bottom of its box.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-align-controls.tsx`

### Line H.
- Where: Editor › Properties › Text tab › Style
- Does: The distance between lines of text.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-box-controls.tsx`

### Padding
- Where: Editor › Properties › Text tab › Style
- Does: The space between the text and its background box.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-box-controls.tsx`

### Shadow
- Where: Editor › Properties › Text tab › Style
- Does: The drop shadow's offset, blur and colour.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-effects-controls.tsx`

### Stroke
- Where: Editor › Properties › Text tab › Style
- Does: An outline around the letters, with its own colour and width.
- SDK: `studio.titles.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/text-effects-controls.tsx`

### Text Animation
- Where: Editor › Properties › Text tab
- Does: Animates the text per character, word or line, with In, Out and Loop stages.
- SDK: `studio.keyframes.add`
- Code: `src/features/editor/components/text-motion/text-motion-slot-rows.tsx`

## Shape clips

### Shape
- Where: Editor › Properties › Shape tab
- Does: The shape's type, fill, stroke, path and mask options.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/shape-section.tsx`

### Type
- Where: Editor › Properties › Shape tab
- Does: Changes the shape: Rectangle, Circle, Triangle, Ellipse, Star, Polygon, Heart or Path.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/shape-section.tsx`

### Fill
- Where: Editor › Properties › Shape tab
- Does: The shape's interior: solid colour or a gradient with its colours and angle.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/shape-fill-controls.tsx`

### Stroke
- Where: Editor › Properties › Shape tab
- Does: The outline of the shape, with colour, width, caps and joins.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/shape-stroke-controls.tsx`

### Trim Paths
- Where: Editor › Properties › Shape tab
- Does: Draws only part of the shape's path, with start, end and offset.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/shape-trim-taper-controls.tsx`

### Taper
- Where: Editor › Properties › Shape tab
- Does: Makes the stroke thinner towards the path's ends.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/shape-trim-taper-controls.tsx`

### Use as Mask
- Where: Editor › Properties › Shape tab
- Does: Uses the shape to hide everything outside it, with feathered or hard edges.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/shape-mask-controls.tsx`

### Edit Path
- Where: Editor › Properties › Shape tab › Path
- Does: Lets the user drag the path's points and handles in the preview.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/shape-path-controls.tsx`

## Subtitle clips

### Subtitle
- Where: Editor › Properties › Video tab › Subtitle
- Does: The subtitle segment's text, formatting and cue timing.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/subtitle-section.tsx`

### Show subtitle
- Where: Editor › Properties › Video tab › Subtitle
- Does: Turns the subtitle segment's visibility on or off.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/subtitle-section.tsx`

### Start
- Where: Editor › Properties › Video tab › Subtitle › cue
- Does: The cue's first frame.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/subtitle-section.tsx`

### End
- Where: Editor › Properties › Video tab › Subtitle › cue
- Does: The cue's last frame.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/subtitle-section.tsx`

## GIF and Lottie clips

### Animation
- Where: Editor › Properties › Video tab › Animation
- Does: The GIF's playback speed.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/gif-section.tsx`

### Lottie
- Where: Editor › Properties › Video tab › Lottie
- Does: The Lottie animation's speed, direction, loop, theme, colours and marker.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/lottie-section.tsx`

### Theme
- Where: Editor › Properties › Video tab › Lottie
- Does: Applies a colour theme to the animation's shapes.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/lottie-section.tsx`

### Reverse
- Where: Editor › Properties › Video tab › Lottie
- Does: Plays the animation backwards.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/lottie-section.tsx`

### Loop
- Where: Editor › Properties › Video tab › Lottie
- Does: Repeats the animation until the clip ends.
- SDK: `studio.clips.update`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/lottie-section.tsx`

## Template overrides

### Template overrides
- Where: Editor › Properties › Video tab, on a reused composition instance
- Does: Edits the text and colour controls published by the composition.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/composition-controls-section.tsx`

### Reset all overrides
- Where: Editor › Properties › Template overrides
- Does: Puts every published control back to the composition's default.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/composition-controls-section.tsx`

## Effects

### Effects
- Where: Editor › Properties › Effects tab
- Does: The effect stack for the selected clip or adjustment layer.
- SDK: `studio.effects.list`
- Code: `src/features/effects/components/effects-section.tsx`

### Add Effect
- Where: Editor › Properties › Effects tab
- Does: Opens the searchable list of GPU effects and adds one to the clip.
- SDK: `studio.effects.add`
- Code: `src/features/effects/components/effects-section.tsx`

### Search effects
- Where: Editor › Properties › Effects › Add Effect
- Does: Filters the effect list by name.
- SDK: `none`
- Code: `src/features/effects/components/effects-section.tsx`

### Presets
- Where: Editor › Properties › Effects tab
- Does: Ready-made effect combinations that can be applied to the clip.
- SDK: `studio.effects.add`
- Code: `src/features/effects/components/effects-section.tsx`

### My presets
- Where: Editor › Properties › Effects tab
- Does: Effect stacks the user saved, which can be applied or deleted.
- SDK: `none`
- Code: `src/features/effects/components/effects-section.tsx`

### Disable All
- Where: Editor › Properties › Effects tab
- Does: Turns every effect of the clip off without removing it.
- SDK: `studio.effects.update`
- Code: `src/features/effects/components/effects-section.tsx`

### Enable All
- Where: Editor › Properties › Effects tab
- Does: Turns every effect of the clip back on.
- SDK: `studio.effects.update`
- Code: `src/features/effects/components/effects-section.tsx`

### Reset To Defaults
- Where: Editor › Properties › Effects › effect header
- Does: Puts an effect's parameters back to their starting values.
- SDK: `studio.effects.update`
- Code: `src/features/effects/components/panels/effect-panel-header-actions.tsx`

### Disable Effect
- Where: Editor › Properties › Effects › effect header
- Does: Bypasses one effect; reads Enable Effect when off.
- SDK: `studio.effects.update`
- Code: `src/features/effects/components/panels/effect-panel-header-actions.tsx`

### Remove Effect
- Where: Editor › Properties › Effects › effect header
- Does: Deletes the effect from the clip.
- SDK: `studio.effects.remove`
- Code: `src/features/effects/components/panels/effect-panel-header-actions.tsx`

### Move effect up
- Where: Editor › Properties › Effects › effect header
- Does: Changes the order of the effect in the stack.
- SDK: `none`
- Code: `src/features/effects/components/panels/effect-move-buttons.tsx`

### Edit in Color
- Where: Editor › Properties › Effects › colour effect header
- Does: Opens the effect in the Color workspace's grading dock.
- SDK: `none`
- Code: `src/features/effects/components/panels/effect-panel-header-actions.tsx`

## Colour (Color workspace)

### Color
- Where: Editor › Color workspace › grading dock
- Does: The colour grade of the selected clip: colour wheels, curves, LUT, qualifier and power window.
- SDK: `studio.effects.list`
- Code: `src/features/effects/components/color-grade-section.tsx`

### Grade comparison
- Where: Editor › Color workspace › grading dock
- Does: Chooses what the preview shows: Before, After or Split.
- SDK: `none`
- Code: `src/features/effects/components/color-grade-section.tsx`

### Adjustment layer
- Where: Editor › Color workspace › grading dock
- Does: Creates an adjustment layer so the grade applies to every clip below it.
- SDK: `none`
- Code: `src/features/effects/components/color-grade-section.tsx`

### Gallery
- Where: Editor › Color workspace › grading dock
- Does: Shows the saved grades; a click applies one to the clip.
- SDK: `none`
- Code: `src/features/effects/components/color-grade-section.tsx`

### Save
- Where: Editor › Color workspace › grading dock › preset name field
- Does: Saves the current grade under the typed name; at rest the tooltip reads “Save this grade as a preset”.
- SDK: `none`
- Code: `src/features/effects/components/color-grade-section.tsx`

### Select a clip to grade
- Where: Editor › Color workspace › grading dock
- Does: The empty state shown until a visual clip is selected.
- SDK: `none`
- Code: `src/features/editor/components/properties-sidebar/color-grade-panel/index.tsx`

## Transition inspector

### Transition
- Where: Editor › Properties, with a transition selected
- Does: The style, length, placement, easing and direction of the transition.
- SDK: `studio.transitions.update`
- Code: `src/features/editor/components/properties-sidebar/transition-panel/index.tsx`

### Preset
- Where: Editor › Properties › Transition
- Does: The visual style of the transition (a dissolve, wipe, slide…), searched by name.
- SDK: `studio.transitions.update`
- Code: `src/features/editor/components/properties-sidebar/transition-panel/index.tsx`

### Duration
- Where: Editor › Properties › Transition
- Does: How long the transition takes; Reset to 1s puts it back.
- SDK: `studio.transitions.update`
- Code: `src/features/editor/components/properties-sidebar/transition-panel/index.tsx`

### Placement
- Where: Editor › Properties › Transition
- Does: Places the transition before the cut (Left), across it (Center) or after it (Right).
- SDK: `studio.transitions.update`
- Code: `src/features/editor/components/properties-sidebar/transition-panel/index.tsx`

### Ease
- Where: Editor › Properties › Transition
- Does: The easing curve of the transition: Linear, In, Out or In & Out.
- SDK: `studio.transitions.update`
- Code: `src/features/editor/components/properties-sidebar/transition-panel/index.tsx`

### Direction
- Where: Editor › Properties › Transition
- Does: The direction the transition moves: Left, Right, Top or Bottom.
- SDK: `studio.transitions.update`
- Code: `src/features/editor/components/properties-sidebar/transition-panel/index.tsx`

### Delete
- Where: Editor › Properties › Transition
- Does: Removes the transition and closes the gap.
- SDK: `studio.transitions.remove`
- Code: `src/features/editor/components/properties-sidebar/transition-panel/index.tsx`

## Marker inspector

### Marker
- Where: Editor › Properties, with a marker selected
- Does: The marker's frame, time, label and colour.
- SDK: `studio.markers.update`
- Code: `src/features/editor/components/properties-sidebar/marker-panel/index.tsx`

### Label
- Where: Editor › Properties › Marker
- Does: The marker's name.
- SDK: `studio.markers.update`
- Code: `src/features/editor/components/properties-sidebar/marker-panel/index.tsx`

### Color
- Where: Editor › Properties › Marker
- Does: The marker's colour on the ruler.
- SDK: `studio.markers.update`
- Code: `src/features/editor/components/properties-sidebar/marker-panel/index.tsx`

### Delete Marker
- Where: Editor › Properties › Marker
- Does: Removes the selected marker.
- SDK: `studio.markers.remove`
- Code: `src/features/editor/components/properties-sidebar/marker-panel/index.tsx`

## Motion workspace

The Motion workspace edits a layered composition: the composition list and the layer timeline replace the usual
timeline, and the Properties panel keeps the Animate tab open. The controls below are the ones a pilot meets there
besides the Motion Library in `sidebar.md`.

### Compositions
- Where: Editor › Motion workspace › preview area, with no composition open
- Does: Lists the project's Motion compositions and opens one for editing.
- SDK: `none`
- Code: `src/features/editor/components/compose-workspace/compose-layout.tsx`

### No compositions yet
- Where: Editor › Motion workspace › preview area, with no composition open
- Does: Explains that a composition is where a layered scene is built.
- SDK: `none`
- Code: `src/features/editor/components/compose-workspace/compose-layout.tsx`

### New composition
- Where: Editor › Motion workspace › preview area, with no composition open
- Does: Creates an empty layered composition and opens it.
- SDK: `none`
- Code: `src/features/editor/components/compose-workspace/compose-layout.tsx`

### Add Item
- Where: Editor › Motion workspace › layer timeline
- Does: Adds a text, shape, solid colour or gradient layer to the composition.
- SDK: `none`
- Code: `src/features/editor/components/compose-workspace/compositing-timeline.tsx`

### Layers
- Where: Editor › Motion workspace › layer timeline
- Does: The list of layers with their In, Out, Parent and Blend mode columns.
- SDK: `none`
- Code: `src/features/editor/components/compose-workspace/compositing-timeline.tsx`

### Blend mode
- Where: Editor › Motion workspace › layer timeline › layer row
- Does: Chooses how the layer mixes with the layers beneath it.
- SDK: `none`
- Code: `src/features/editor/components/compose-workspace/compositing-timeline.tsx`

### Layer Group
- Where: Editor › Motion workspace › layer timeline
- Does: Packs the selected layers into one group that moves and hides together.
- SDK: `none`
- Code: `src/features/editor/components/compose-workspace/compositing-timeline.tsx`

### Ungroup Layers
- Where: Editor › Motion workspace › layer timeline › group row
- Does: Dissolves the layer group and puts its layers back at the top level.
- SDK: `none`
- Code: `src/features/editor/components/compose-workspace/compositing-timeline.tsx`

### Motion curves
- Where: Editor › Motion workspace › keyframe panel
- Does: Shows the value curves of the animated layers instead of the keyframe grid.
- SDK: `none`
- Code: `src/features/timeline/components/keyframe-graph-panel-header.tsx`

### Add a text or shape layer to begin.
- Where: Editor › Motion workspace › layer timeline, empty composition
- Does: The empty state of a composition with no layers.
- SDK: `none`
- Code: `src/features/editor/components/compose-workspace/compositing-timeline.tsx`
