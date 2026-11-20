import type { DocPageContent } from '../docs-content'

// DroneClean Studio's own tools for drone and FPV footage (19 Nov 2026; the tools of 0.1.3-0.1.4 added 20 Nov 2026):
// what FreeCut's pages do not cover.
const page = {
  order: 27,
  slug: 'drone-footage',
  title: 'Drone footage: stabilize, grade, speed, share',
  description:
    'Gyro stabilization and framing, the D-Log M profile, looks and the sky, speed ramps with easing, motion blur and smooth slow motion, beat markers, the Instagram Reel export and agent access.',
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
            'Set the **Colour profile** of log clips (D-Log M for the Avata 2, D-Log): the flat picture becomes Rec.709 before anything else. DJI files do not say which profile they were shot in, so the first DJI import of a project asks once; **Yes, D-Log M** sets it on those clips.',
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
            ['Speed', 'One constant speed; the clip keeps its source range and its length follows.'],
            [
              'Curve…',
              'A speed curve with keys: ramp in, ramp out, or both, each segment Linear, Smooth, Ease in or Ease out. The panel shows the frames a second the clip really has at its slowest point.',
            ],
            [
              'Smooth ramp + zoom',
              'The drone-reel recipe in one click, in the speed panel: fast, about 0.45x in the middle, fast again, with smooth segments, smooth slow motion, motion blur and an eased zoom-in.',
            ],
            ['Motion blur', 'Above 1x, blends the source frames each output frame covers, with a shutter of 90° to 360°.'],
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
      title: 'Export for Instagram',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The **Instagram Reel** preset follows Meta’s Reel specification: H.264 MP4 at the project’s frame rate, 1080x1920 (the frame Instagram shows), 20 Mbps at 60 fps or 12 Mbps at 30 fps, under Meta’s 25 Mbps maximum, with AAC sound at 128 kbps, the index at the start of the file and no edit list. Instagram re-encodes every upload; giving it its own frame and size avoids a second scaling.',
        },
      ],
    },
    {
      title: 'Let an AI agent edit',
      blocks: [
        {
          kind: 'paragraph',
          text: 'In the desktop app, **Settings › Agent access › Allow AI agents** turns on a local MCP server. The panel shows the command for Claude Code or the config for other clients. An agent can then build and grade a project and export it through the same SDK the editor uses, and every change is an undo step you can see. Every call that changes the project saves it.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
