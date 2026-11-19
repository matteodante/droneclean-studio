# The feature map

This folder lists DroneClean Studio's editor as a pilot sees it: every panel, control and menu a user can reach,
with the name shown on screen, what it does, the SDK call behind it and the file it lives in. It is the shared
vocabulary between the owner, the people writing the app and the agents driving it through the MCP server
(task 2.2); `search` serves these files.

The product is still named FreeCut in parts of the interface; this map writes **DroneClean Studio** wherever the
interface names the product. The wording of a control is always the English interface string.

## How to read an entry

Each entry is a `###` heading with the name on screen, followed by four fields:

```
### Speed
- Where: Editor › Properties panel › Video tab › Playback
- Does: Changes how fast the selected clip plays and stretches its length to match.
- SDK: `studio.clips.setSpeed`
- Code: `src/features/editor/components/properties-sidebar/clip-panel/video-section.tsx`
```

- **Where** walks from the area down to the panel and section; `›` separates levels.
- **Does** is one plain sentence.
- **SDK** is the method of `window.studio` that performs the same change, or `none` when no SDK method covers the
  control. The SDK's namespaces and methods are declared in `src/studio/sdk/types.ts`.
- **Code** is the file under `studio/` that renders the control.

`docs/feature-map/check.mjs` fails when an entry misses a field, names an SDK method that does not exist or points
at a file that is gone. Run it from `studio/` with `node docs/feature-map/check.mjs`.

## The areas

| File | What it covers |
|---|---|
| `projects.md` | The projects page, creating and editing a project, the workspace folder. |
| `media-library.md` | The media library: importing, searching, organising and acting on media. |
| `timeline.md` | Tracks, clips, the tool strip, ruler, markers, in/out points, zooming. |
| `preview.md` | The player, transport controls, preview overlays, scopes, source monitor. |
| `properties.md` | The Properties panel: canvas, and the inspector tabs for each clip type; transitions, markers, colour. |
| `sidebar.md` | The left sidebar's tabs: Text, Shapes, Effects, Transitions, Lottie, Transcript, AI, and the Motion workspace's preset library. |
| `export.md` | The export dialog and the render queue. |
| `menus-and-shortcuts.md` | The top toolbar, the project menu, context menus and the keyboard shortcuts editor. |
| `settings.md` | The Settings dialog and the app-level notices. |

The editor has three workspaces, switched from the top toolbar: **Edit** (media, timeline, inspector), **Color** (the
same timeline, with the colour grading dock open) and **Motion** (the animation preset library and the motion
dopesheet). The map names the workspace in **Where** where a control only exists there.

## Glossary

- **Project** — one video: its canvas size and frame rate, its media, its timelines. It lives in the workspace
  folder as plain files.
- **Workspace folder** — the folder on disk the user picks once; every project, media copy and cache lives inside it.
- **Media library** — the project's imported files. Media is not a clip until it is placed on a track.
- **Sequence / timeline** — the main timeline (`Main`) or a sequence opened as a tab. Tracks run horizontally and
  the playhead moves across them.
- **Track** — one horizontal lane: `V1`, `V2`… for video, `A1`, `A2`… for audio. A track has mute/hide, solo, lock
  and sync lock.
- **Clip** — one placed piece of media, text, shape, adjustment layer or compound clip on a track. It has a label,
  a start, a duration, a source range, effects and animation.
- **Playhead** — the vertical line showing the current frame; the preview shows that frame.
- **In / Out points** — the marked part of the timeline that playback loops over and that an export can be limited to.
- **Marker** — a named, coloured point on the timeline.
- **Transition** — an effect between two adjacent clips on the same track (a dissolve, a wipe…).
- **Composition / compound clip** — a nested timeline reused as a clip; its contents are edited in a tab of their own.
- **Adjustment layer** — a transparent clip whose effects apply to the clips below it.
- **Keyframe** — a value recorded at a frame so a property changes over time; the **keyframe editor** edits the
  curve.
- **Inspector / Properties panel** — the right panel that edits the selected clip, transition, marker or the canvas.
- **Sidebar** — the left panel with the tabs that add things (media, text, shapes, effects, transitions, stickers,
  transcript, AI).
- **Render queue** — the list of exports, with progress; exports keep running while the user edits.
- **Proxy** — a smaller, faster-to-decode copy of a video used while editing; the export always uses the original.
- **Filmstrip / waveform** — the thumbnail strip / audio waveform drawn inside a clip on the timeline.
- **Source monitor** — a player for one media file, opened from the media library, independent of the timeline.
- **Nesting levels** — a clip inside a composition inside another composition; the breadcrumb shows the path.
