import type { DocPageContent } from '../docs-content'

// DroneClean Studio's own tools for drone and FPV footage (19 Nov 2026): what FreeCut's pages do not cover.
const page = {
  order: 27,
  slug: 'drone-footage',
  title: 'Drone footage: stabilize, grade, speed, share',
  description:
    'Gyro stabilization, the D-Log M profile and creative looks, speed ramps with motion blur and smooth slow motion, the Instagram Reel export and agent access.',
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
      ],
    },
    {
      title: 'Colour: profile, look, grade',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Set the **Colour profile** of log clips (D-Log M for the Avata 2, D-Log): the flat picture becomes Rec.709 before anything else.',
            'Pick a **Look** (a `.cube` file of the workspace’s looks library; **Manage looks… › Add .cube** adds one) and its **Intensity**.',
            'Finish in **Effects**: Color Wheels for contrast, highlights and mid detail; a Secondary Qualifier on the bright, pale pixels gives a white overcast sky some colour; a Power Window rectangle with a wide feather at the top works as a graduated filter; Glow, Vignette and Sharpen finish the picture.',
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
              'A speed curve with keys: ramp in, ramp out, or both. The classic “smooth edit” enters fast, slows to about 0.4x in the middle and leaves fast.',
            ],
            ['Motion blur', 'Above 1x, blends the source frames each output frame covers, with a shutter of 90° to 360°.'],
            [
              'Smooth slow motion',
              'Below 1x, or for a 30 fps file in a 60 fps project, blends the two source frames around each output frame instead of showing one frame twice.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Cut on the strong beats of the song, not on every beat: mark them with markers (`M`), then let each clip run from one marker to the next.',
        },
      ],
    },
    {
      title: 'Export for Instagram',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The **Instagram Reel** preset writes H.264 MP4 at the project’s frame rate: 1440x2560 at 25 Mbps for a 2K vertical project at 60 fps (16 Mbps at 30 fps), otherwise 1080x1920 at 15 or 10 Mbps. Instagram plays Reels at 1080x1920 and scales a 2K upload down itself, from a sharper picture.',
        },
      ],
    },
    {
      title: 'Let an AI agent edit',
      blocks: [
        {
          kind: 'paragraph',
          text: 'In the desktop app, **Settings › Agent access › Allow AI agents** turns on a local MCP server. The panel shows the command for Claude Code or the config for other clients. An agent can then build and grade a project and export it through the same SDK the editor uses, and every change is an undo step you can see.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
