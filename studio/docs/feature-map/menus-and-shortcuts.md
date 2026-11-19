# Menus and shortcuts

The project toolbar runs across the top of the editor. Below it are the menus that open from the toolbar and the
context menus of the panels (each panel's own context menu is listed with that panel), and the Keyboard Shortcuts
editor, which holds every command and its key combination.

## Toolbar

### Back to Projects
- Where: Editor › top toolbar › left
- Does: Goes back to the projects page; asks to save first when there are unsaved changes.
- SDK: `studio.project.save`
- Code: `src/features/editor/components/toolbar.tsx`

### Workspaces
- Where: Editor › top toolbar › centre
- Does: The three workspace tabs; each applies a panel layout without touching the selection or the playhead.
- SDK: `none`
- Code: `src/features/editor/components/workspace-switcher.tsx`

### Edit
- Where: Editor › top toolbar › Workspaces
- Does: The editing layout: media sidebar, inspector, full timeline.
- SDK: `none`
- Code: `src/features/editor/components/workspace-switcher.tsx`

### Color
- Where: Editor › top toolbar › Workspaces
- Does: The grading layout: the colour dock, the scopes and the grade comparison in the preview.
- SDK: `none`
- Code: `src/features/editor/components/workspace-switcher.tsx`

### Motion
- Where: Editor › top toolbar › Workspaces
- Does: The animation layout: the Motion Library, the motion dopesheet and the Composition timeline.
- SDK: `none`
- Code: `src/features/editor/components/workspace-switcher.tsx`

### Debug Panel
- Where: Editor › top toolbar, development builds only
- Does: Shows the project's internal state for debugging.
- SDK: `none`
- Code: `src/features/editor/components/toolbar.tsx`

### View on GitHub
- Where: Editor › top toolbar
- Does: Opens the source repository in a new tab.
- SDK: `none`
- Code: `src/features/editor/components/toolbar.tsx`

### Join Discord
- Where: Editor › top toolbar
- Does: Opens the community chat in a new tab.
- SDK: `none`
- Code: `src/features/editor/components/toolbar.tsx`

### User Guide
- Where: Editor › top toolbar
- Does: Opens the user guide in a new tab.
- SDK: `none`
- Code: `src/features/editor/components/toolbar.tsx`

### What's New
- Where: Editor › top toolbar
- Does: Opens the release notes for this version.
- SDK: `none`
- Code: `src/features/editor/components/whats-new-dialog.tsx`

### Full changelog
- Where: Editor › What's New dialog
- Does: Opens the complete list of changes.
- SDK: `none`
- Code: `src/features/editor/components/whats-new-dialog.tsx`

### Settings
- Where: Editor › top toolbar
- Does: Opens the Editor Settings dialog.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Keyboard Shortcuts
- Where: Editor › top toolbar
- Does: Opens the editor that lists every command, its current key combination and lets it be changed.
- SDK: `none`
- Code: `src/features/editor/components/shortcuts-dialog.tsx`

### Language
- Where: Editor › top toolbar
- Does: Switches the interface language and remembers the choice.
- SDK: `none`
- Code: `src/shared/ui/language-switcher.tsx`

### Save
- Where: Editor › top toolbar
- Does: Saves the project to the workspace folder; the orange dot marks unsaved changes.
- SDK: `studio.project.save`
- Code: `src/features/editor/components/toolbar.tsx`

### Render queue
- Where: Editor › top toolbar
- Does: Opens the render queue and its list of exports; the badge counts the jobs.
- SDK: `studio.export.jobs`
- Code: `src/features/editor/components/toolbar.tsx`

### Export
- Where: Editor › top toolbar › right
- Does: Opens the menu with Export Video and Download Project (.zip).
- SDK: `none`
- Code: `src/features/editor/components/toolbar.tsx`

### Export Video
- Where: Editor › Export menu
- Does: Opens the export dialog.
- SDK: `studio.export.start`
- Code: `src/features/editor/components/toolbar.tsx`

### Download Project (.zip)
- Where: Editor › Export menu
- Does: Writes the project and its media into a .freecut.zip bundle to move or keep.
- SDK: `none`
- Code: `src/features/editor/components/toolbar.tsx`

## Unsaved changes dialog

### Unsaved Changes
- Where: Editor › leaving with unsaved edits
- Does: Asks whether to save the project before leaving.
- SDK: `studio.project.save`
- Code: `src/features/editor/components/unsaved-changes-dialog.tsx`

### Save & Exit
- Where: Editor › Unsaved Changes dialog
- Does: Saves the project and leaves the editor.
- SDK: `studio.project.save`
- Code: `src/features/editor/components/unsaved-changes-dialog.tsx`

### Discard
- Where: Editor › Unsaved Changes dialog
- Does: Leaves the editor and loses the changes since the last save.
- SDK: `none`
- Code: `src/features/editor/components/unsaved-changes-dialog.tsx`

## Keyboard Shortcuts editor

### Keyboard Shortcuts
- Where: Editor › Keyboard Shortcuts dialog › title
- Does: Lists every command by section, its current combination and its default, and records a new combination.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Search commands or shortcuts
- Where: Editor › Keyboard Shortcuts dialog
- Does: Filters the command list by name, by key or by the pressed combination.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### All
- Where: Editor › Keyboard Shortcuts dialog › sections
- Does: Shows the commands of every section.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### On-screen keyboard
- Where: Editor › Keyboard Shortcuts dialog
- Does: A clickable keyboard used to show and enter key combinations.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Selected Command
- Where: Editor › Keyboard Shortcuts dialog
- Does: The command being edited, with its current and default combinations.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Record
- Where: Editor › Keyboard Shortcuts dialog › Selected Command
- Does: Listens for the next key combination and assigns it to the command.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Add alternate
- Where: Editor › Keyboard Shortcuts dialog › Selected Command
- Does: Adds a second key combination for the same command.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Remove shortcut
- Where: Editor › Keyboard Shortcuts dialog › Selected Command
- Does: Unassigns one key combination from the command.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Reset
- Where: Editor › Keyboard Shortcuts dialog › Selected Command
- Does: Puts one command back to its default combination.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Import
- Where: Editor › Keyboard Shortcuts dialog
- Does: Loads a saved keybind preset and asks which changed combinations to apply.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Export
- Where: Editor › Keyboard Shortcuts dialog
- Does: Saves the current keybindings as a preset file.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Reset All
- Where: Editor › Keyboard Shortcuts dialog
- Does: Removes every custom combination and restores the defaults, after a confirmation.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Overwrite
- Where: Editor › Keyboard Shortcuts dialog › conflict
- Does: Gives the combination to the new command, taking it from the command that had it.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Overwrite all
- Where: Editor › Keyboard Shortcuts dialog › conflict
- Does: Resolves every conflicting combination the same way.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

## Playback

Transport, frame stepping, and timeline jumps. Shortcuts are recorded in the Keyboard Shortcuts editor.

### Play/Pause
- Where: Editor › Keyboard Shortcuts › Playback
- Does: Starts or stops playback of the sequence.
- SDK: `studio.playback.play`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Previous frame
- Where: Editor › Keyboard Shortcuts › Playback
- Does: Moves the playhead back one frame.
- SDK: `studio.playback.seek`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Next frame
- Where: Editor › Keyboard Shortcuts › Playback
- Does: Moves the playhead forward one frame.
- SDK: `studio.playback.seek`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Go to start
- Where: Editor › Keyboard Shortcuts › Playback
- Does: Moves the playhead to the first frame.
- SDK: `studio.playback.seek`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Go to end
- Where: Editor › Keyboard Shortcuts › Playback
- Does: Moves the playhead to the last frame.
- SDK: `studio.playback.seek`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Previous snap point
- Where: Editor › Keyboard Shortcuts › Playback
- Does: Jumps the playhead to the previous clip edge, marker or in/out point.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Next snap point
- Where: Editor › Keyboard Shortcuts › Playback
- Does: Jumps the playhead to the next clip edge, marker or in/out point.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

## Editing

Clip edits, delete flows, and precise canvas nudging. Shortcuts are recorded in the Keyboard Shortcuts editor.

### Split at playhead
- Where: Editor › Keyboard Shortcuts › Editing
- Does: Cuts the selected clip (or every clip under the playhead) at the playhead.
- SDK: `studio.clips.split`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Join selected clips
- Where: Editor › Keyboard Shortcuts › Editing
- Does: Merges the selected adjacent clips into one.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Delete selected items
- Where: Editor › Keyboard Shortcuts › Editing
- Does: Deletes the selected clips and leaves a gap.
- SDK: `studio.clips.remove`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Ripple delete selected items
- Where: Editor › Keyboard Shortcuts › Editing
- Does: Deletes the selected clips and closes the gap.
- SDK: `studio.clips.remove`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Insert freeze frame at playhead
- Where: Editor › Keyboard Shortcuts › Editing
- Does: Holds the frame at the playhead as a new clip.
- SDK: `studio.clips.add`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Link selected clips
- Where: Editor › Keyboard Shortcuts › Editing
- Does: Links the selected audio and video clips so they move together.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Unlink selected clips
- Where: Editor › Keyboard Shortcuts › Editing
- Does: Breaks the link between the selected audio and video clips.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Toggle linked selection
- Where: Editor › Keyboard Shortcuts › Editing
- Does: Turns linked selection on or off.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Nudge (1px)
- Where: Editor › Keyboard Shortcuts › Editing
- Does: Moves the selected clips by one pixel on the canvas.
- SDK: `studio.clips.move`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Nudge (10px)
- Where: Editor › Keyboard Shortcuts › Editing
- Does: Moves the selected clips by ten pixels on the canvas.
- SDK: `studio.clips.move`
- Code: `src/features/settings/components/hotkey-editor.tsx`

## Tools

Tool switching for timeline editing modes. Shortcuts are recorded in the Keyboard Shortcuts editor.

### Selection tool
- Where: Editor › Keyboard Shortcuts › Tools
- Does: Switches to the Select Tool.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Trim edit tool
- Where: Editor › Keyboard Shortcuts › Tools
- Does: Switches to the Trim Edit Tool.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Razor tool
- Where: Editor › Keyboard Shortcuts › Tools
- Does: Switches to the Razor Tool.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Split at cursor
- Where: Editor › Keyboard Shortcuts › Tools
- Does: Cuts the clip under the mouse pointer.
- SDK: `studio.clips.split`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Rate stretch tool
- Where: Editor › Keyboard Shortcuts › Tools
- Does: Switches to the Rate Stretch Tool.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Slip tool
- Where: Editor › Keyboard Shortcuts › Tools
- Does: Switches to the Slip Tool.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Slide tool
- Where: Editor › Keyboard Shortcuts › Tools
- Does: Switches to the Slide Tool.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

## History and UI

Timeline history, zoom, and UI toggles. Shortcuts are recorded in the Keyboard Shortcuts editor.

### Undo
- Where: Editor › Keyboard Shortcuts › History and UI
- Does: Reverses the last edit.
- SDK: `studio.history.undo`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Redo
- Where: Editor › Keyboard Shortcuts › History and UI
- Does: Re-applies the last undone edit.
- SDK: `studio.history.redo`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Zoom in timeline
- Where: Editor › Keyboard Shortcuts › History and UI
- Does: Zooms the timeline in.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Zoom out timeline
- Where: Editor › Keyboard Shortcuts › History and UI
- Does: Zooms the timeline out.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Zoom to fit all content
- Where: Editor › Keyboard Shortcuts › History and UI
- Does: Fits the whole sequence in the timeline.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Zoom to 100%
- Where: Editor › Keyboard Shortcuts › History and UI
- Does: Shows the timeline at 100%.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Toggle snap
- Where: Editor › Keyboard Shortcuts › History and UI
- Does: Turns timeline snapping on or off.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Toggle canvas (gizmo) snap
- Where: Editor › Keyboard Shortcuts › History and UI
- Does: Turns canvas snapping on or off.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Switch to Edit workspace
- Where: Editor › Keyboard Shortcuts › History and UI
- Does: Switches to the Edit workspace.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Switch to Color workspace
- Where: Editor › Keyboard Shortcuts › History and UI
- Does: Switches to the Color workspace.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Switch to Animate workspace
- Where: Editor › Keyboard Shortcuts › History and UI
- Does: Switches to the Motion workspace.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

## Clipboard

Copy, cut, and paste commands shared across editor surfaces. Shortcuts are recorded in the Keyboard Shortcuts editor.

### Copy selected items or keyframes
- Where: Editor › Keyboard Shortcuts › Clipboard
- Does: Copies the selected clips or keyframes.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Cut selected items or keyframes
- Where: Editor › Keyboard Shortcuts › Clipboard
- Does: Cuts the selected clips or keyframes.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Paste items or keyframes
- Where: Editor › Keyboard Shortcuts › Clipboard
- Does: Pastes the copied clips or keyframes at the playhead.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

## Markers

Marker creation, removal, and navigation. Shortcuts are recorded in the Keyboard Shortcuts editor.

### Add marker at playhead
- Where: Editor › Keyboard Shortcuts › Markers
- Does: Adds a marker at the playhead.
- SDK: `studio.markers.add`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Remove selected marker
- Where: Editor › Keyboard Shortcuts › Markers
- Does: Removes the selected marker.
- SDK: `studio.markers.remove`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Jump to previous marker
- Where: Editor › Keyboard Shortcuts › Markers
- Does: Moves the playhead to the previous marker.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Jump to next marker
- Where: Editor › Keyboard Shortcuts › Markers
- Does: Moves the playhead to the next marker.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

## Keyframes

Keyframe editor actions and view switching. Shortcuts are recorded in the Keyboard Shortcuts editor.

### Clear all keyframes from selected items
- Where: Editor › Keyboard Shortcuts › Keyframes
- Does: Removes all keyframes from the selected clips.
- SDK: `studio.keyframes.removeAll`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Switch keyframe editor to graph view
- Where: Editor › Keyboard Shortcuts › Keyframes
- Does: Shows the keyframe editor as value curves.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Switch keyframe editor to dopesheet view
- Where: Editor › Keyboard Shortcuts › Keyframes
- Does: Shows the keyframe editor as a grid of keyframes.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Switch keyframe editor to split view
- Where: Editor › Keyboard Shortcuts › Keyframes
- Does: Shows the grid and the curves side by side.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Add keyframe at playhead for selected Edit layer
- Where: Editor › Keyboard Shortcuts › Keyframes
- Does: Adds a keyframe at the playhead for the selected property.
- SDK: `studio.keyframes.add`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Jump to previous property keyframe
- Where: Editor › Keyboard Shortcuts › Keyframes
- Does: Jumps to the previous keyframe of the property.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Jump to next property keyframe
- Where: Editor › Keyboard Shortcuts › Keyframes
- Does: Jumps to the next keyframe of the property.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Toggle auto-key for active property
- Where: Editor › Keyboard Shortcuts › Keyframes
- Does: Turns auto-keyframing on or off for the active property.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Fit selected keyframes in view
- Where: Editor › Keyboard Shortcuts › Keyframes
- Does: Fits the selected keyframes in the keyframe editor view.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

## Source Monitor

In and out points plus insert and overwrite edits. Shortcuts are recorded in the Keyboard Shortcuts editor.

### Mark In point
- Where: Editor › Keyboard Shortcuts › Source Monitor
- Does: Marks the source monitor in point at its playhead.
- SDK: `studio.markers.setIn`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Mark Out point
- Where: Editor › Keyboard Shortcuts › Source Monitor
- Does: Marks the source monitor out point at its playhead.
- SDK: `studio.markers.setOut`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Clear In/Out points
- Where: Editor › Keyboard Shortcuts › Source Monitor
- Does: Clears the source monitor in and out points.
- SDK: `studio.markers.clearRange`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Insert edit
- Where: Editor › Keyboard Shortcuts › Source Monitor
- Does: Inserts the source monitor selection at the playhead.
- SDK: `studio.clips.add`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Overwrite edit
- Where: Editor › Keyboard Shortcuts › Source Monitor
- Does: Overwrites the timeline with the source monitor selection.
- SDK: `studio.clips.add`
- Code: `src/features/settings/components/hotkey-editor.tsx`

## Project

Save and export flows. Shortcuts are recorded in the Keyboard Shortcuts editor.

### Save project
- Where: Editor › Keyboard Shortcuts › Project
- Does: Saves the project.
- SDK: `studio.project.save`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Export video
- Where: Editor › Keyboard Shortcuts › Project
- Does: Opens the export dialog.
- SDK: `studio.export.start`
- Code: `src/features/settings/components/hotkey-editor.tsx`

### Open Scene Browser (search AI captions)
- Where: Editor › Keyboard Shortcuts › Project
- Does: Opens the AI scene browser.
- SDK: `none`
- Code: `src/features/settings/components/hotkey-editor.tsx`

