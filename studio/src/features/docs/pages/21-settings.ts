import type { DocPageContent } from '../docs-content'

const page = {
  order: 21,
  slug: 'settings',
  title: 'Settings',
  description:
    'The General, Timeline, AI, Storage and Privacy tabs, plus where language and shortcuts are set.',
  category: 'Reference',
  related: ['keyboard-shortcuts', 'workspaces'],
  sections: [
    {
      title: 'The tabs',
      blocks: [
        {
          kind: 'table',
          headers: ['Tab', 'What you set'],
          rows: [
            [
              'General',
              'Auto-save on/off and interval (5–30 min); undo history depth (10–200 steps); interface sounds (on/off, volume, sound theme).',
            ],
            [
              'Timeline',
              'Snap by default; show waveforms and filmstrips; extract filmstrips on import.',
            ],
            ['AI', 'Caption sample interval (seconds or frames); default caption style.'],
            [
              'Storage',
              'Generate missing proxies; clear project cache; regenerate thumbnails; delete proxies; manage Local AI.',
            ],
            [
              'Privacy',
              'Crash reports and anonymous usage statistics, each on or off (both off until you allow them); in the desktop app, also **Check for new versions** (on by default).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Clearing the project cache removes regenerated data (waveforms, filmstrips, GIF frames, decoded audio); it never deletes source media. Use **Reset** in the dialog header to restore defaults.',
        },
      ],
    },
    {
      title: 'New versions',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The desktop app is not signed, so it cannot update itself. Instead, when it starts (at most once a day) it asks GitHub for the number of the latest release and, if a newer one exists, shows a small card with **Download** (opens that release page in your browser) and **Later** (hides it until tomorrow). Nothing is shown while an export is rendering. This is the one request the app makes without you asking, so it has a switch: **Settings › Privacy › Check for new versions**, on by default. GitHub sees your IP address; nothing else about you or your work is sent, and with the switch off no request is made. The web editor is always the latest version and never checks.',
        },
      ],
    },
    {
      title: 'Interface sounds',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio can play subtle synthesized interface sounds — short cues that confirm actions like selecting, confirming, toggling, and deleting. They are **off by default**, opt-in, and never affect exported audio.',
        },
        {
          kind: 'steps',
          items: [
            'Open **Settings** and go to the **General** tab.',
            'Turn on **Interface sounds**.',
            'Set **Sound volume** to taste (0–100%).',
            'Pick a **Sound theme** — **Signature**, **Velvet**, or **Crisp** — and use the **Preview** button to audition it.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Sounds are suppressed while the preview is playing, so they never bleed into the audio you are monitoring; exports are silent by design. Turning the toggle on plays a short confirmation.',
        },
      ],
    },
    {
      title: 'Crash reports and usage statistics',
      blocks: [
        {
          kind: 'paragraph',
          text: "DroneClean Studio sends nothing about you or your work unless you allow it. The first time it opens it asks, in a card in the bottom-left corner, whether to send **crash reports** and **anonymous usage statistics**; until you answer, and after **Don't allow**, nothing is sent. Change either one at any time in **Settings › Privacy**.",
        },
        {
          kind: 'table',
          headers: ['Report', 'What is sent', 'Where'],
          rows: [
            [
              'Crash reports',
              "The error, where it happened in the editor's code, the version and the operating system. Paths and file names are removed from messages before they leave.",
              'Sentry, in the EU',
            ],
            [
              'Usage statistics',
              'That the app was opened, a project created (its size and frame rate), an export finished (its format, size and length), an AI agent connected, or a shadow removed (its length), under a random id of this installation that is forgotten when you switch statistics off.',
              'PostHog, in the EU',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Never sent: your footage, frames, file and folder names, project names or your account. Your IP address is not stored. The desktop app keeps your answer in its profile folder, the web editor in your browser.',
        },
      ],
    },
    {
      title: 'Customizing keyboard shortcuts',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Keyboard shortcuts are fully customizable, but the editor is its own dialog opened from the **Keyboard** button in the toolbar — not this Settings dialog. It has an interactive on-screen keyboard, search and **Custom** / **Conflicts** / **Unassigned** filters, record-to-rebind, alternate bindings, per-command and **Reset All** defaults, conflict detection, and JSON preset **Import** / **Export**.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'See the **Keyboard shortcuts** page for the full command list and a step-by-step rebinding walkthrough.',
        },
      ],
    },
    {
      title: 'Set elsewhere',
      blocks: [
        {
          kind: 'list',
          items: [
            'Interface **language** is a separate control in the toolbar, not part of this dialog; DroneClean Studio ships in 10 languages.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio currently uses a single dark theme; there is no theme selector.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
