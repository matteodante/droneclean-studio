# Settings

**Settings** opens the Editor Settings dialog from the top toolbar. It holds the preferences that apply to the whole
editor and to the open project; anything it changes is stored in the browser or in the workspace folder, never sent
away.

### Editor Settings
- Where: Editor › top toolbar › Settings
- Does: The dialog with General, Timeline, AI, Storage and (in the desktop app) Agent access settings.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Agent access
- Where: Editor › Editor Settings › Agent access (desktop app only)
- Does: Lets an AI agent on this Mac read, change and export the open project through the app's own MCP server; off by default.
- SDK: `none`
- Code: `src/features/settings/components/agent-access-panel.tsx`

### Allow AI agents
- Where: Editor › Editor Settings › Agent access
- Does: Starts or stops the local MCP socket the agent connects to.
- SDK: `none`
- Code: `src/features/settings/components/agent-access-panel.tsx`

### Socket
- Where: Editor › Editor Settings › Agent access
- Does: Shows the path the app listens on, with a button that copies it.
- SDK: `none`
- Code: `src/features/settings/components/agent-access-panel.tsx`

### Connect a client
- Where: Editor › Editor Settings › Agent access
- Does: Shows the Claude Code, Codex and generic stdio configurations to paste into a client.
- SDK: `none`
- Code: `src/features/settings/components/agent-access-snippets.ts`

### Last calls
- Where: Editor › Editor Settings › Agent access
- Does: Lists the tools the agent called, each with its duration and the undo steps it made.
- SDK: `none`
- Code: `src/features/settings/components/agent-access-panel.tsx`

### General
- Where: Editor › Editor Settings › left column
- Does: The everyday preferences: auto-save, undo depth and interface sounds.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Auto-save
- Where: Editor › Editor Settings › General
- Does: Saves the project automatically after the chosen interval, or turns auto-save off.
- SDK: `studio.project.save`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Interval
- Where: Editor › Editor Settings › General › Auto-save
- Does: How many minutes pass between automatic saves.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Undo History Depth
- Where: Editor › Editor Settings › General
- Does: How many undo steps the editor keeps.
- SDK: `studio.history.depth`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Interface sounds
- Where: Editor › Editor Settings › General
- Does: Turns the small sounds the interface makes on and off.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Sound volume
- Where: Editor › Editor Settings › General › Interface sounds
- Does: Sets how loud the interface sounds are.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Sound theme
- Where: Editor › Editor Settings › General › Interface sounds
- Does: Chooses the character of the interface sounds: Signature, Velvet or Crisp.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Preview
- Where: Editor › Editor Settings › General › Interface sounds
- Does: Plays the chosen sound once so it can be judged.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Timeline
- Where: Editor › Editor Settings › left column
- Does: The defaults of the timeline's look and feel.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Snap by Default
- Where: Editor › Editor Settings › Timeline
- Does: Sets whether a project opens with snapping on.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Show Waveforms
- Where: Editor › Editor Settings › Timeline
- Does: Draws the audio waveform inside audio clips.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Show Filmstrips
- Where: Editor › Editor Settings › Timeline
- Does: Draws the thumbnail strip inside video clips.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Extract Filmstrips
- Where: Editor › Editor Settings › Timeline
- Does: Generates the thumbnail strips while importing and while showing the timeline.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### AI
- Where: Editor › Editor Settings › left column
- Does: The preferences of the on-device AI tools.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Caption sample interval
- Where: Editor › Editor Settings › AI
- Does: How often Analyze with AI samples a frame when captioning a clip, in seconds or frames.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Default caption style
- Where: Editor › Editor Settings › AI
- Does: The style given to captions made from transcripts or by the AI.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Storage
- Where: Editor › Editor Settings › left column
- Does: The caches of the open project and the local AI models.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Generate Missing Proxies
- Where: Editor › Editor Settings › Storage
- Does: Queues a proxy for every video of this project that does not have one yet.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Clear Project Cache
- Where: Editor › Editor Settings › Storage
- Does: Deletes the project's cached waveforms, filmstrips, GIF frames and decoded audio; they are rebuilt when needed.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Clear Cache
- Where: Editor › Editor Settings › Storage › Clear project cache?
- Does: Confirms deleting the project's cache.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Regenerate Thumbnails
- Where: Editor › Editor Settings › Storage
- Does: Re-creates the media library's thumbnails for this project.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Delete Proxies
- Where: Editor › Editor Settings › Storage
- Does: Removes the proxy videos generated for this project.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Local AI
- Where: Editor › Editor Settings › Storage
- Does: Unloads the local AI runtimes or clears the cached model downloads.
- SDK: `none`
- Code: `src/features/editor/components/settings-dialog.tsx`

### Unload Local Models
- Where: Editor › Editor Settings › Storage › Local AI
- Does: Frees the memory of the local AI models that are loaded.
- SDK: `none`
- Code: `src/features/settings/components/local-inference-unload-control.tsx`

### Local AI Model Cache
- Where: Editor › Editor Settings › Storage › Local AI
- Does: Shows the size of each downloaded model and lets one be cleared.
- SDK: `none`
- Code: `src/features/settings/components/local-model-cache-control.tsx`

### Clear (model)
- Where: Editor › Editor Settings › Storage › Local AI Model Cache › model row
- Does: Deletes that model from the cache; it is downloaded again when next used.
- SDK: `none`
- Code: `src/features/settings/components/local-model-cache-control.tsx`

### Refresh
- Where: Editor › Editor Settings › Storage › Local AI Model Cache
- Does: Re-reads the cached model sizes.
- SDK: `none`
- Code: `src/features/settings/components/local-model-cache-control.tsx`

## App notices

### A new version is available. Save your work and reload.
- Where: Editor › notice after a software update
- Does: Warns that a new version replaced the running app and offers the two ways to load it.
- SDK: `none`
- Code: `src/main.tsx`

### Save & Reload
- Where: Editor › new version notice
- Does: Saves the open project, then loads the new version.
- SDK: `studio.project.save`
- Code: `src/main.tsx`

### Reload without saving
- Where: Editor › new version notice
- Does: Loads the new version and discards the unsaved edits.
- SDK: `none`
- Code: `src/main.tsx`
