import type { DocPageContent } from '../docs-content'

// DroneClean Studio's own tools for drone and FPV footage (19 Nov 2026; the tools of 0.1.3-0.1.4 added 20 Nov 2026):
// what FreeCut's pages do not cover.
const page = {
  order: 27,
  slug: 'drone-footage',
  title: 'Drone footage: stabilize, grade, speed, share',
  description:
    'Gyro stabilization and framing, the D-Log M profile, looks and the sky, speed ramps with easing, motion blur and smooth slow motion, beat markers, the smooth edit in one click, the export for Instagram Reels, TikTok and YouTube Shorts, and agent access.',
  category: 'Creative Tools',
  related: ['effects-color', 'keyframes', 'export', 'properties'],
  sections: [
    {
      title: 'Stabilize from the gyro data',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DJI and GoPro files carry the camera’s motion. Select a clip and switch on **Stabilize this clip** under Properties › Video › Stabilization: the clip is steadied from that data, with no analysis pass, and **Smoothness** and **Horizon lock** tune it.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'A stabilized clip is drawn at the project’s shape. A 4:3 Avata clip in a 9:16 project fills the vertical frame by itself; you do not need to scale it.',
        },
        {
          kind: 'paragraph',
          text: '**Framing** (two sliders under Stabilization) moves the stabilized window sideways or up and down inside the picture, as far as the stabilization leaves room, so a vertical edit keeps its subject in view. The diamond beside each slider keys it, so the framing can follow the subject through the shot.',
        },
      ],
    },
    {
      title: 'Colour: profile, look, grade',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Set the **Colour profile** of log clips (D-Log M, D-Log): the flat picture becomes Rec.709 before anything else. DJI files do not say which profile they were shot in, so the first DJI import of a project asks once; **Yes, D-Log M** sets it on those clips. The profile was fitted on Avata 2 footage. DJI lists a D-Log M LUT for the Mini 4 Pro and the Air 3 too, and the panel names those drones, but their colour has not been checked here, so it says so.',
            'Pick a **Look** (a `.cube` file of the workspace’s looks library; **Manage looks… › Add .cube** adds one) and its **Intensity**.',
            'Finish in **Effects**: Color Wheels for contrast, highlights and mid detail; **Sky** gives a white overcast sky a graduated blue (horizon, angle, softness, and a protection that keeps it on the bright, pale pixels); a Secondary Qualifier and a Power Window do the same by hand; Glow, Vignette and Sharpen finish the picture.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ice and snow are white too: on icy shots keep the qualifier light and let the graduated window colour the sky.',
        },
      ],
    },
    {
      title: 'Speed, motion blur and smooth slow motion',
      blocks: [
        {
          kind: 'table',
          headers: ['Control', 'What it does'],
          rows: [
            [
              'Speed',
              'One constant speed; the clip keeps its source range and its length follows.',
            ],
            [
              'Curve…',
              'A speed curve with keys: ramp in, ramp out, or both, each segment Linear, Smooth, Ease in or Ease out. The panel shows the frames a second the clip really has at its slowest point.',
            ],
            [
              'Smooth ramp + zoom',
              'The drone-reel recipe in one click, in the speed panel: fast, about 0.45x in the middle, fast again, with smooth segments, smooth slow motion, motion blur and an eased zoom-in.',
            ],
            [
              'Motion blur',
              'Above 1x, blends the source frames each output frame covers, with a shutter of 90° to 360°.',
            ],
            [
              'Smooth slow motion',
              'Below 1x, or for a 30 fps file in a 60 fps project, makes the frames in between instead of showing one frame twice: Frame blending mixes the two source frames, Optical flow builds the frame from the motion between them (sharper, without double images).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Slow down only footage shot at a higher frame rate than the project. A 30 fps file in a 60 fps project already has half the frames it needs: keep it at 1x or faster, and slow 60 fps footage no further than 0.5x.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Cut on the strong beats of the song, not on every beat: right-click the song and choose **Mark Beats** (a marker on every strong bass hit), or mark them yourself with `M`, then let each clip run from one marker to the next.',
        },
      ],
    },
    {
      title: 'Smooth edit in one click',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Put your video clips and a song on the timeline, then click **Smooth edit…** (the sparkle button in the timeline toolbar). The editor finds the song’s beats, lays the video clips end to end from the song’s first beat, each cut to the number of bars you choose, and gives each the smooth-edit look: a fast, slow, fast speed ramp with optical-flow slow motion, motion blur and an eased zoom-in. It is the edit of the drone reels in one step.',
        },
        {
          kind: 'steps',
          items: [
            'Add the song and the clips to the timeline. If there is no audio clip, the dialog says **Add a song to the timeline first**.',
            'Click **Smooth edit…**, pick the song if there is more than one, the **shot length** (1, 2 or 4 bars; a bar is four beats) and whether to add a **short crossfade** at each cut.',
            'The dialog says how many clips will change. Click **Apply**.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Each clip keeps the in-point it has, so trim the start of a clip first to choose where its shot begins. The fast parts spend footage faster than it plays, so a one-bar shot uses about one and a half bars of the clip. A clip with too little footage after its in-point is skipped, and clips that would end after the song stay as they are, after the last shot. A stabilized clip keeps its stabilization. Nothing is deleted, and **Ctrl/Cmd+Z** undoes the whole edit in one step.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'An AI agent can do the same with one call, `studio.clips.smoothEditTimeline({ bars, crossfade })`, and still choose the best part of each clip itself before it.',
        },
      ],
    },
    {
      title: 'Export for Instagram, TikTok and Shorts',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The **Instagram Reel** preset follows Meta’s Reel specification: H.264 MP4 at the project’s frame rate, 20 Mbps at 60 fps or 12 Mbps at 30 fps, under Meta’s 25 Mbps maximum, with AAC sound at 128 kbps, the index at the start of the file and no edit list. In a vertical (9:16) project the frame is 1080x1920, the one Instagram shows; in any other project the preset keeps the project’s shape (1920x1080 for a 16:9 one) and never stretches it. Instagram re-encodes every upload; giving it its own frame and size avoids a second scaling.',
        },
        {
          kind: 'paragraph',
          text: 'The **TikTok** and **YouTube Shorts** presets are the same H.264 MP4 at the project’s frame rate (up to 60 fps): 1080x1920 in a vertical project, the project’s own shape in any other. **YouTube Shorts** uses YouTube’s published 1080p rates: 12 Mbps at 60 fps or 8 Mbps at 30 fps, with AAC stereo at 384 kbps. TikTok publishes no bitrate, so **TikTok** uses 16 Mbps at 60 fps or 10 Mbps at 30 fps, our choice, with AAC at 128 kbps. Both platforms re-encode every upload. For a vertical video, start from a vertical project of 1080x1920; the stabilization’s Framing then picks the part of the drone shot to keep.',
        },
      ],
    },
    {
      title: 'Let an AI agent edit',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The desktop app runs a local MCP server for AI agents on your computer, on by default: **Settings › Agent access › Allow AI agents** switches it off or on again, and only your user can reach it. The panel shows the command for Claude Code or the config for other clients. An agent can then build and grade a project and export it through the same SDK the editor uses, and every change is an undo step you can see. Every call that changes the project saves it.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
