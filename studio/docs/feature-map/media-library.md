# Media library

The media library is the **Media** tab of the left sidebar (`L` shows/hides it). It holds every file imported into
the project, the imported sequences and compound clips, and the AI scene browser. Media becomes a clip only when it
is dropped on a track.

### Media
- Where: Editor › left sidebar › Media tab
- Does: Shows the project's imported media in a grid or a list.
- SDK: `studio.media.list`
- Code: `src/features/media-library/components/media-library.tsx`

### Import
- Where: Editor › left sidebar › Media tab › toolbar
- Does: Opens the file picker and imports the chosen files into the project.
- SDK: `studio.media.import`
- Code: `src/features/media-library/components/media-library.tsx`

### Import options
- Where: Editor › left sidebar › Media tab › toolbar › chevron
- Does: Chooses whether imported files are copied into the workspace or linked where they are.
- SDK: `studio.media.import`
- Code: `src/features/media-library/components/media-library.tsx`

### Copy into workspace
- Where: Editor › left sidebar › Media tab › Import options
- Does: Imports a copy of the file into the workspace folder, so the project is self-contained.
- SDK: `studio.media.import`
- Code: `src/features/media-library/components/media-library.tsx`

### Link original files
- Where: Editor › left sidebar › Media tab › Import options
- Does: Imports without copying, keeping a link to the file where it already is.
- SDK: `studio.media.import`
- Code: `src/features/media-library/components/media-library.tsx`

### URL
- Where: Editor › left sidebar › Media tab › toolbar
- Does: Opens the dialog that imports a media file from a direct web link.
- SDK: `studio.media.import`
- Code: `src/features/media-library/components/media-library.tsx`

### Import From URL
- Where: Editor › left sidebar › Media tab › URL dialog
- Does: Downloads the file at the pasted link and adds it to the project.
- SDK: `studio.media.import`
- Code: `src/features/media-library/components/media-library.tsx`

### Search media
- Where: Editor › left sidebar › Media tab
- Does: Filters the media grid by file name.
- SDK: `none`
- Code: `src/features/media-library/components/media-library.tsx`

### Scenes
- Where: Editor › left sidebar › Media tab › Media/Scenes switch
- Does: Switches the sidebar to the AI scene browser, which searches analysed clips by what they show.
- SDK: `none`
- Code: `src/features/media-library/components/media-library.tsx`

### ALL
- Where: Editor › left sidebar › Media tab › filter button
- Does: Filters by media type; reads ALL or the chosen type, and offers Video, Audio, Image and Lottie.
- SDK: `none`
- Code: `src/features/media-library/components/media-library.tsx`

### DATE
- Where: Editor › left sidebar › Media tab › sort button
- Does: Sorts the media by import date, name or file size.
- SDK: `none`
- Code: `src/features/media-library/components/media-library.tsx`

### Grid Item Size
- Where: Editor › left sidebar › Media tab › grid view
- Does: Changes the size of the thumbnails in the grid.
- SDK: `none`
- Code: `src/features/media-library/components/media-library.tsx`

### Grid view
- Where: Editor › left sidebar › Media tab › view toggle
- Does: Shows the media as thumbnails.
- SDK: `none`
- Code: `src/features/media-library/components/media-library.tsx`

### List view
- Where: Editor › left sidebar › Media tab › view toggle
- Does: Shows the media as compact rows with name, duration and type.
- SDK: `none`
- Code: `src/features/media-library/components/media-library.tsx`

### No media yet
- Where: Editor › left sidebar › Media tab › empty state
- Does: Explains that files can be dropped here or imported with the Import button.
- SDK: `none`
- Code: `src/features/media-library/components/media-grid.tsx`

### Import media
- Where: Editor › left sidebar › Media tab › empty state
- Does: Opens the file picker to import the first files.
- SDK: `studio.media.import`
- Code: `src/features/media-library/components/media-grid.tsx`

### Drop Files Here
- Where: Editor › left sidebar › Media tab
- Does: The drop area that appears while files are dragged over the sidebar.
- SDK: `studio.media.import`
- Code: `src/features/media-library/components/media-library.tsx`

### {count} Missing
- Where: Editor › left sidebar › Media tab › badge
- Does: Warns that some media cannot be found and opens the Missing Media dialog.
- SDK: `none`
- Code: `src/features/media-library/components/media-library.tsx`

### {count} Selected
- Where: Editor › left sidebar › Media tab › badge
- Does: Shows how many media items are selected.
- SDK: `none`
- Code: `src/features/media-library/components/media-library.tsx`

### Clear Selection
- Where: Editor › left sidebar › Media tab › selection bar
- Does: Deselects every media item.
- SDK: `none`
- Code: `src/features/media-library/components/media-library.tsx`

### Generate proxies for {count} selected items
- Where: Editor › left sidebar › Media tab › selection bar
- Does: Queues small proxy copies of the selected videos for smoother editing.
- SDK: `none`
- Code: `src/features/media-library/components/media-library.tsx`

### Delete Selected Assets
- Where: Editor › left sidebar › Media tab › selection bar
- Does: Removes the selected media from the project after a confirmation.
- SDK: `studio.media.remove`
- Code: `src/features/media-library/components/media-library.tsx`

### Media card
- Where: Editor › left sidebar › Media tab › thumbnail
- Does: A double-click opens the file in the source monitor; a drag places it on a track.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Media info
- Where: Editor › left sidebar › Media tab › card › info button
- Does: Shows type, duration, dimensions, codec, size, source and frame rate, and the clip's transcript.
- SDK: `studio.media.get`
- Code: `src/features/media-library/components/media-info-popover.tsx`

### Open In Source Monitor
- Where: Editor › left sidebar › Media tab › Media info popover
- Does: Opens the file in the source monitor to scrub and set in/out points.
- SDK: `none`
- Code: `src/features/media-library/components/media-info-popover.tsx`

### Relink File...
- Where: Editor › left sidebar › Media tab › card menu › File
- Does: Points a missing media item at its file again.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Generate Proxy
- Where: Editor › left sidebar › Media tab › card menu › Proxy
- Does: Creates a smaller, faster-to-decode copy used only for editing and preview.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Delete Proxy
- Where: Editor › left sidebar › Media tab › card menu › Proxy
- Does: Removes the proxy copy; editing preview goes back to the original file.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Interpolate Frames
- Where: Editor › left sidebar › Media tab › card menu › Frame Interpolation
- Does: Generates in-between frames to make the clip play more smoothly, at 2× or 4×.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Cancel Interpolation
- Where: Editor › left sidebar › Media tab › card menu › Frame Interpolation
- Does: Stops the frame interpolation running for this file.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Upscale 2x
- Where: Editor › left sidebar › Media tab › card menu › Upscale
- Does: Creates a doubled-resolution copy with an AI upscaler, choosing a live-action, animation or 3D-rendered model.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Cancel Upscale
- Where: Editor › left sidebar › Media tab › card menu › Upscale
- Does: Stops the upscale running for this file.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Generate Transcript
- Where: Editor › left sidebar › Media tab › card menu › Transcript
- Does: Opens the transcription dialog and transcribes the file's speech to text.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Refresh Transcript
- Where: Editor › left sidebar › Media tab › card menu › Transcript
- Does: Transcribes the file again, replacing its current transcript.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Delete Transcript
- Where: Editor › left sidebar › Media tab › card menu › Transcript
- Does: Removes the file's transcript.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Extract Embedded Subtitles
- Where: Editor › left sidebar › Media tab › card menu › Embedded captions
- Does: Reads the subtitle tracks stored inside the file and offers to insert one into the timeline.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Analyze with AI
- Where: Editor › left sidebar › Media tab › card menu › Menu AI
- Does: Captions the clip's scenes on this machine so they can be searched in the Scenes tab.
- SDK: `none`
- Code: `src/features/media-library/components/media-card.tsx`

### Delete
- Where: Editor › left sidebar › Media tab › card menu
- Does: Removes the media from the project after a confirmation.
- SDK: `studio.media.remove`
- Code: `src/features/media-library/components/media-card.tsx`

### Delete Media Item
- Where: Editor › left sidebar › Media tab › delete dialog
- Does: Confirms removing the media; the dialog also lists the timeline clips that will be removed.
- SDK: `studio.media.remove`
- Code: `src/features/media-library/components/media-grid.tsx`

### Delete With Clips
- Where: Editor › left sidebar › Media tab › delete dialog
- Does: Removes the media together with the clips that use it.
- SDK: `studio.media.remove`
- Code: `src/features/media-library/components/media-grid.tsx`

### Missing Media
- Where: Editor › left sidebar › Media tab › missing badge
- Does: Lists the files that cannot be found or need permission, and the ways to locate them.
- SDK: `none`
- Code: `src/features/media-library/components/missing-media-dialog.tsx`

### Scan {name}
- Where: Editor › Media library › Missing Media dialog
- Does: Searches the project's own folder for the missing files.
- SDK: `none`
- Code: `src/features/media-library/components/missing-media-dialog.tsx`

### Browse Another Folder
- Where: Editor › Media library › Missing Media dialog
- Does: Searches a folder the user picks for the missing files.
- SDK: `none`
- Code: `src/features/media-library/components/missing-media-dialog.tsx`

### Locate
- Where: Editor › Media library › Missing Media dialog › file row
- Does: Asks for the one file that moved.
- SDK: `none`
- Code: `src/features/media-library/components/missing-media-dialog.tsx`

### Grant Access
- Where: Editor › Media library › Missing Media dialog › file row
- Does: Requests read permission again for a file that lost it.
- SDK: `none`
- Code: `src/features/media-library/components/missing-media-dialog.tsx`

### Work Offline
- Where: Editor › Media library › Missing Media dialog
- Does: Closes the dialog and keeps editing without the missing files.
- SDK: `none`
- Code: `src/features/media-library/components/missing-media-dialog.tsx`

### Missing media
- Where: Editor › Media library › orphaned clips dialog
- Does: Lists timeline clips whose media is gone and the ways to repair them.
- SDK: `none`
- Code: `src/features/media-library/components/orphaned-clips-dialog.tsx`

### Auto Match
- Where: Editor › Media library › Missing media dialog
- Does: Replaces missing media with files of the same name found in the project folder.
- SDK: `none`
- Code: `src/features/media-library/components/orphaned-clips-dialog.tsx`

### Select Replacement
- Where: Editor › Media library › Missing media dialog › clip row
- Does: Chooses which media file a broken clip should use instead.
- SDK: `none`
- Code: `src/features/media-library/components/orphaned-clips-dialog.tsx`

### Remove All
- Where: Editor › Media library › Missing media dialog
- Does: Removes every clip that points at missing media.
- SDK: `studio.clips.remove`
- Code: `src/features/media-library/components/orphaned-clips-dialog.tsx`

### Keep As Broken
- Where: Editor › Media library › Missing media dialog
- Does: Leaves the broken clips on the timeline and closes the dialog.
- SDK: `none`
- Code: `src/features/media-library/components/orphaned-clips-dialog.tsx`

### Generate transcript
- Where: Editor › Media library › transcription dialog
- Does: Chooses the model, language and precision, then transcribes the file.
- SDK: `none`
- Code: `src/features/media-library/components/transcribe-dialog.tsx`

### Model
- Where: Editor › Media library › transcription dialog
- Does: Chooses the speech-recognition model, from fast small models to slower accurate ones.
- SDK: `none`
- Code: `src/features/media-library/components/transcribe-dialog.tsx`

### Quantization
- Where: Editor › Media library › transcription dialog
- Does: Chooses how compressed the model runs; smaller is faster and less accurate.
- SDK: `none`
- Code: `src/features/media-library/components/transcribe-dialog.tsx`

### Language
- Where: Editor › Media library › transcription dialog
- Does: Sets the spoken language, or Auto detect.
- SDK: `none`
- Code: `src/features/media-library/components/transcribe-dialog.tsx`

### Start
- Where: Editor › Media library › transcription dialog › footer
- Does: Starts the transcription and shows its progress.
- SDK: `none`
- Code: `src/features/media-library/components/transcribe-dialog.tsx`

### Stop
- Where: Editor › Media library › transcription dialog › progress
- Does: Stops the running transcription.
- SDK: `none`
- Code: `src/features/media-library/components/transcribe-dialog.tsx`

### Embedded subtitles
- Where: Editor › Media library › subtitle track picker
- Does: Lists the subtitle tracks inside the file so one can be chosen.
- SDK: `none`
- Code: `src/features/media-library/components/embedded-subtitle-track-picker.tsx`

### Insert
- Where: Editor › Media library › Embedded subtitles
- Does: Inserts the chosen subtitle track into the timeline as subtitle clips.
- SDK: `none`
- Code: `src/features/media-library/components/embedded-subtitle-track-picker.tsx`

### Compositions
- Where: Editor › left sidebar › Media tab › bottom section
- Does: Lists the project's sequences and compound clips, which can be opened as tabs or used as clips.
- SDK: `none`
- Code: `src/features/media-library/components/compositions-section.tsx`

### Enter
- Where: Editor › Media library › Compositions
- Does: Opens a sequence or compound clip in the timeline to edit its contents.
- SDK: `none`
- Code: `src/features/media-library/components/compositions-section.tsx`

### Open as tab
- Where: Editor › Media library › Compositions
- Does: Opens a sequence in a tab beside the main timeline.
- SDK: `none`
- Code: `src/features/media-library/components/compositions-section.tsx`

### Rename
- Where: Editor › Media library › Compositions
- Does: Changes the name of a sequence or compound clip.
- SDK: `none`
- Code: `src/features/media-library/components/compositions-section.tsx`

### Analyze media with AI
- Where: Editor › left sidebar › Scenes tab
- Does: Captions the scenes of the chosen media so they can be searched by meaning.
- SDK: `none`
- Code: `src/features/scene-browser/components/scene-browser-panel.tsx`

### Scope
- Where: Editor › left sidebar › Scenes tab
- Does: Limits the scene search to one media file or to all media.
- SDK: `none`
- Code: `src/features/scene-browser/components/scene-browser-panel.tsx`

### Sort
- Where: Editor › left sidebar › Scenes tab
- Does: Orders the scenes by best match, time or another criterion.
- SDK: `none`
- Code: `src/features/scene-browser/components/scene-browser-panel.tsx`

### List view
- Where: Editor › left sidebar › Scenes tab › view toggle
- Does: Shows the matching scenes as rows.
- SDK: `none`
- Code: `src/features/scene-browser/components/scene-browser-panel.tsx`

### Grid view
- Where: Editor › left sidebar › Scenes tab › view toggle
- Does: Shows the matching scenes as thumbnails.
- SDK: `none`
- Code: `src/features/scene-browser/components/scene-browser-panel.tsx`

### Semantic
- Where: Editor › left sidebar › Scenes tab › search
- Does: Searches scenes by meaning, like “sunset over water”.
- SDK: `none`
- Code: `src/features/scene-browser/components/scene-search-input.tsx`

### Keyword
- Where: Editor › left sidebar › Scenes tab › search
- Does: Searches scenes by exact words in their captions.
- SDK: `none`
- Code: `src/features/scene-browser/components/scene-search-input.tsx`

### Color
- Where: Editor › left sidebar › Scenes tab › search
- Does: Finds scenes whose palette is similar to a chosen colour.
- SDK: `none`
- Code: `src/features/scene-browser/components/scene-search-input.tsx`

### Cancel All
- Where: Editor › left sidebar › Media tab › background tasks
- Does: Stops every queued transcription, proxy or AI analysis job.
- SDK: `none`
- Code: `src/features/media-library/components/background-task-progress.tsx`

### Show per-item progress
- Where: Editor › left sidebar › Media tab › background tasks
- Does: Expands the task panel to one progress bar per item.
- SDK: `none`
- Code: `src/features/media-library/components/background-task-progress.tsx`

## Subclips

### Subclips
- Where: Editor › left sidebar › Media tab › Subclips section
- Does: Lists the named ranges of library files, each with a poster, its length and its original file; the section is hidden while there are none.
- SDK: `studio.subclips.list`
- Code: `src/studio/subclips/library/subclips-section.tsx`

### Create subclip
- Where: Editor › left sidebar › Media tab › card menu
- Does: Makes a subclip of the file's marked in and out points, remembered from the source monitor; it is disabled, with the reason, until a mark is set.
- SDK: `studio.subclips.create`
- Code: `src/features/media-library/components/media-card.tsx`

### Open subclip in source monitor
- Where: Editor › left sidebar › Media tab › Subclips › double-click, or card menu › Open in source monitor
- Does: Opens the subclip's original file in the source monitor with the subclip's range as its window: playback stops at the end of the range and marks stay inside it. A subclip with a badge cannot be opened.
- SDK: none (view only)
- Code: `src/studio/subclips/library/actions.ts`

### Show original
- Where: Editor › left sidebar › Media tab › Subclips › card menu
- Does: Opens the subclip's original file in the source monitor whole, without the subclip's window.
- SDK: none (view only)
- Code: `src/studio/subclips/library/actions.ts`

### Rename subclip
- Where: Editor › left sidebar › Media tab › Subclips › card menu
- Does: Edits the subclip's name in place; Enter keeps it and Escape cancels.
- SDK: `studio.subclips.rename`
- Code: `src/studio/subclips/library/subclips-section.tsx`

### Delete Subclip
- Where: Editor › left sidebar › Media tab › Subclips › card menu
- Does: Removes the subclip after a confirmation; the original file and the clips already on the timeline stay.
- SDK: `studio.subclips.remove`
- Code: `src/studio/subclips/library/subclips-section.tsx`

### Invalid subclip
- Where: Editor › left sidebar › Media tab › Subclips
- Does: Marks a subclip whose original file is missing, shorter or at another frame rate with a badge that says why, and it cannot be dragged.
- SDK: `studio.subclips.get`
- Code: `src/studio/subclips/library/subclips-section.tsx`

### Drag a subclip
- Where: Editor › left sidebar › Media tab › Subclips
- Does: Drops the subclip on a track or the preview as a clip of the original file that plays only its range.
- SDK: `studio.clips.add`
- Code: `src/studio/subclips/library/subclips-section.tsx`

### Subclips removed with the file
- Where: Editor › left sidebar › Media tab › Delete Media Item
- Does: Tells how many subclips are deleted together with the file; deleting a file always removes its subclips.
- SDK: `studio.media.remove`
- Code: `src/studio/subclips/library/subclip-deletion-notice.tsx`
