# Export

The export dialog is opened by **Export → Export Video** in the project toolbar; the render queue opens from the
list button beside Save. The dialog writes its settings to the SDK's export settings store (task 3.4 makes the dialog
read the same store).

## Export dialog

### Export
- Where: Editor › Export menu › Export Video
- Does: The dialog that sets the format and range, then renders the video or the audio.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-dialog.tsx`

### Export type
- Where: Editor › Export dialog
- Does: Chooses between a video export and an audio-only export.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-mode-toggle.tsx`

### Video
- Where: Editor › Export dialog › Export type
- Does: Exports a video file.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-mode-toggle.tsx`

### Audio
- Where: Editor › Export dialog › Export type
- Does: Exports only the mixed audio; all video settings are hidden.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-mode-toggle.tsx`

### Preset
- Where: Editor › Export dialog
- Does: One-click settings: Maximum, Recommended, Balanced or Small file; Custom when the settings match none.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-preset-grid.tsx`

### Maximum
- Where: Editor › Export dialog › Preset
- Does: The largest H.264 MP4 at the project's own size and the highest quality.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-preset-grid.tsx`

### Recommended
- Where: Editor › Export dialog › Preset
- Does: H.264 MP4 at the project's size and a medium quality that encodes faster.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-preset-grid.tsx`

### Balanced
- Where: Editor › Export dialog › Preset
- Does: H.264 MP4 at two-thirds of the project's size.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-preset-grid.tsx`

### Small file
- Where: Editor › Export dialog › Preset
- Does: H.264 MP4 at half the project's size and a lower quality.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-preset-grid.tsx`

### Same as source
- Where: Editor › Export dialog › Preset
- Does: H.265 MP4 at the source clip's own size, frame rate and average bitrate, 8-bit.
- SDK: `studio.export.settings`
- Code: `src/studio/export/presets.ts`

### YouTube 4K
- Where: Editor › Export dialog › Preset
- Does: H.265 MP4 fitted in 3840x2160 with a bitrate chosen for YouTube, 8-bit.
- SDK: `studio.export.settings`
- Code: `src/studio/export/presets.ts`

### Instagram Reel
- Where: Editor › Export dialog › Preset
- Does: H.264 MP4 at the project's frame rate, fitted in 1440x2560 for a project at least that large (else 1080x1920), at 25 Mbps (2K, above 30 fps) down to 10 Mbps (1080, 30 fps): what Instagram ingests best, scaled down by Instagram itself.
- SDK: `studio.export.presets`
- Code: `src/studio/export/presets.ts`

### Small file (sharing)
- Where: Editor › Export dialog › Preset
- Does: H.265 MP4 fitted in 1920x1080 with a low bitrate, for sending the clip around.
- SDK: `studio.export.settings`
- Code: `src/studio/export/presets.ts`

### Master ProRes
- Where: Editor › Export dialog › Preset
- Does: A ProRes file for further editing; offered only where the native encoder is available.
- SDK: `studio.export.settings`
- Code: `src/studio/export/presets.ts`

### Master HEVC 10-bit
- Where: Editor › Export dialog › Preset
- Does: A 10-bit HEVC file for further editing; offered only where the native encoder is available.
- SDK: `studio.export.settings`
- Code: `src/studio/export/presets.ts`

### Preset numbers
- Where: Editor › Export dialog › Preset
- Does: The line under the presets with the size, frame rate, codec, bitrate and bit depth the export will use, and the note that the web version exports 8-bit H.265 only.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-preset-grid.tsx`

### Format
- Where: Editor › Export dialog
- Does: The file container: MP4, QuickTime MOV, WebM or MKV; for audio, MP3, AAC or WAV.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-video-format-fields.tsx`

### Codec
- Where: Editor › Export dialog
- Does: The video codec inside the container: H.264, H.265, VP8, VP9, AV1 or ProRes.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-video-format-fields.tsx`

### Quality
- Where: Editor › Export dialog
- Does: Low, Medium, High or Ultra; higher looks better and makes a bigger file.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-video-format-fields.tsx`

### Resolution
- Where: Editor › Export dialog
- Does: Same as project, 1080p or 540p, with the exact pixel size shown.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-video-format-fields.tsx`

### Rate control
- Where: Editor › Export dialog
- Does: Auto (source-aware), VBR (variable bitrate) or CBR (constant bitrate).
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-rate-control-fields.tsx`

### Target bitrate
- Where: Editor › Export dialog
- Does: The video bitrate in Mbps, or Use source to follow the original.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-rate-control-fields.tsx`

### Export range
- Where: Editor › Export dialog
- Does: Renders the whole project, or only the in/out points with their In, Out and Duration shown.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-range-summary.tsx`

### Sequence
- Where: Editor › Export dialog
- Does: Chooses which sequence is exported when the project has more than one.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-sequence-picker.tsx`

### Subtitles
- Where: Editor › Export dialog
- Does: Decides what happens to the transcript captions: Off, Burn in, Sidecar .srt or Embedded track.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-subtitle-fields.tsx`

### Smart copy when possible
- Where: Editor › Export dialog
- Does: Copies the original file byte for byte when the timeline needs no rendering, and explains when it cannot.
- SDK: `studio.export.settings`
- Code: `src/features/export/components/export-smart-copy-block.tsx`

### Export preflight
- Where: Editor › Export dialog
- Does: Checks the settings before rendering: codec support, range, missing media, file size and worker path.
- SDK: `none`
- Code: `src/features/export/components/export-preflight-panel.tsx`

### Add to queue
- Where: Editor › Export dialog › footer
- Does: Queues the export so it renders in the background while the user keeps editing.
- SDK: `studio.export.start`
- Code: `src/features/export/components/export-settings-footer.tsx`

### Current range
- Where: Editor › Export dialog › Add to queue menu
- Does: Queues one job that covers the current in/out range.
- SDK: `studio.export.start`
- Code: `src/features/export/components/export-settings-footer.tsx`

### Split into segments
- Where: Editor › Export dialog › Add to queue menu
- Does: Queues one job per marker, or per fixed number of seconds.
- SDK: `studio.export.start`
- Code: `src/features/export/components/export-settings-footer.tsx`

### Export Video
- Where: Editor › Export dialog › footer
- Does: Renders the export now and shows its progress in the dialog.
- SDK: `studio.export.start`
- Code: `src/features/export/components/export-settings-footer.tsx`

### Export Audio
- Where: Editor › Export dialog › footer, in audio mode
- Does: Renders the audio mix now.
- SDK: `studio.export.start`
- Code: `src/features/export/components/export-settings-footer.tsx`

### Cancel
- Where: Editor › Export dialog
- Does: Closes the dialog without exporting.
- SDK: `studio.export.cancel`
- Code: `src/features/export/components/export-settings-footer.tsx`

### Exporting video
- Where: Editor › Export dialog › progress
- Does: Shows the render stages (Preparing, Rendering, Encoding, Finalizing), frames, elapsed time and a Cancel button.
- SDK: `studio.export.status`
- Code: `src/features/export/components/export-progress-view.tsx`

### Export complete
- Where: Editor › Export dialog › result
- Does: Shows the finished file's size and time, with a Download button.
- SDK: `studio.export.status`
- Code: `src/features/export/components/export-complete-view.tsx`

### Export failed
- Where: Editor › Export dialog › result
- Does: Explains that something went wrong and offers to try again.
- SDK: `studio.export.status`
- Code: `src/features/export/components/export-notice-view.tsx`

### Export cancelled
- Where: Editor › Export dialog › result
- Does: Says the export was cancelled and no file was saved.
- SDK: `studio.export.status`
- Code: `src/features/export/components/export-notice-view.tsx`

## Render queue

### Exports
- Where: Editor › toolbar › render queue button › dialog title
- Does: The dialog with two tabs: Render queue and Saved exports.
- SDK: `studio.export.jobs`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Render queue
- Where: Editor › Exports dialog › Render queue tab
- Does: Lists the queued and running exports with their progress, one at a time.
- SDK: `studio.export.jobs`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Refresh
- Where: Editor › Exports dialog
- Does: Re-reads the queue and the exported files from the project folder.
- SDK: `studio.export.jobs`
- Code: `src/features/export/components/render-queue-panel.tsx`

### No render jobs yet. Add one from the Export dialog.
- Where: Editor › Exports dialog › Render queue tab
- Does: The empty state of the queue.
- SDK: `none`
- Code: `src/features/export/components/render-queue-panel.tsx`

### No exported files yet.
- Where: Editor › Exports dialog › Saved exports tab
- Does: The empty state of the exported files list.
- SDK: `none`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Saved exports
- Where: Editor › Render queue › tab
- Does: Lists the files already exported from this project.
- SDK: `studio.export.jobs`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Pause
- Where: Editor › Render queue
- Does: Stops starting new jobs; the current one finishes.
- SDK: `none`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Resume
- Where: Editor › Render queue
- Does: Continues rendering the queued jobs.
- SDK: `none`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Clear finished
- Where: Editor › Render queue
- Does: Removes the completed and cancelled jobs from the list.
- SDK: `none`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Clear all
- Where: Editor › Render queue
- Does: Empties the queue, stopping the running job.
- SDK: `none`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Cancel (job)
- Where: Editor › Render queue › job row
- Does: Stops that export.
- SDK: `studio.export.cancel`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Retry
- Where: Editor › Render queue › failed job
- Does: Queues the failed export again.
- SDK: `studio.export.start`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Move up
- Where: Editor › Render queue › job row
- Does: Moves the job earlier in the queue.
- SDK: `none`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Move down
- Where: Editor › Render queue › job row
- Does: Moves the job later in the queue.
- SDK: `none`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Download
- Where: Editor › Render queue › finished job
- Does: Saves the exported file to the computer's Downloads folder.
- SDK: `none`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Remove
- Where: Editor › Render queue › job row
- Does: Drops the job from the queue without deleting the exported file.
- SDK: `none`
- Code: `src/features/export/components/render-queue-panel.tsx`

### Delete (export)
- Where: Editor › Render queue › Saved exports
- Does: Deletes the exported file from the project folder.
- SDK: `none`
- Code: `src/features/export/components/render-queue-panel.tsx`
