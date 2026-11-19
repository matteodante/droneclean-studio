// The workspace the network check opens: one project, one text clip.
//
// A native folder picker cannot be clicked from a test. FreeCut keeps the
// workspace folder as a `FileSystemDirectoryHandle` in the IndexedDB database
// `freecut-handles-db` (store `handles`, key `workspace:current`, with a
// `workspace:{id}` record it points at), and browser storage hands out such a
// handle too: `navigator.storage.getDirectory()` returns a real
// `FileSystemDirectoryHandle` for the origin's origin-private file system, with
// permission always granted. Seeding that folder and that IndexedDB record
// before the app opens a project is therefore the same state FreeCut has after
// the user picks a folder — the app reads it, it does not know the difference.
//
// The project is written in the format `src/infrastructure/storage/workspace-fs`
// writes: `index.json` lists the projects, `projects/{id}/project.json` is the
// project, and the marker file makes it a schema 2.0 workspace. The text clip
// carries a catalogue font other than the default (`Inter`), so opening the
// editor exercises the app's font loader.

/** The project the check opens in the editor. */
export const PROJECT_ID = 'network-check-project'
export const PROJECT_NAME = 'Network origins check'
export const TEXT_CLIP_ID = 'network-check-text'
export const TEXT_CLIP_TEXT = 'DroneClean Studio network check'
export const TEXT_FONT_FAMILY = 'Roboto'
/** The folder name the seed uses inside the origin's private file system. */
export const SEED_DIRECTORY = 'network-check-workspace'

const FIXED_TIME = 1_700_000_000_000
/**
 * Matches `CURRENT_SCHEMA_VERSION` in `src/shared/projects/migrations/types.ts`.
 * The editor upgrades anything older before it opens, which would muddy what is
 * measured here; `checks/test/seeded-project.test.mjs` fails if the two drift.
 */
const SCHEMA_VERSION = 15

/** The project the editor opens: a 30 fps 1080p sequence with one text clip. */
export function buildSeededProject() {
  return {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    description: 'Written by checks/network-origins.mjs',
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    duration: 120,
    schemaVersion: SCHEMA_VERSION,
    metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#202020' },
    timeline: {
      masterBusDb: 0,
      currentFrame: 0,
      tracks: [
        {
          id: 'track-text',
          name: 'Text',
          kind: 'video',
          height: 60,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          order: 1,
        },
      ],
      items: [
        {
          id: TEXT_CLIP_ID,
          trackId: 'track-text',
          type: 'text',
          from: 0,
          durationInFrames: 120,
          label: 'Text',
          text: TEXT_CLIP_TEXT,
          fontFamily: TEXT_FONT_FAMILY,
          fontSize: 64,
          fontWeight: 'bold',
          color: '#ffffff',
          textAlign: 'center',
          verticalAlign: 'middle',
        },
      ],
      transitions: [],
      keyframes: [],
      compositions: [],
    },
  }
}

/**
 * Runs inside the page, on the app's own origin, before the app opens a project.
 * Written as one self-contained function because Playwright evaluates its source
 * in the browser: it uses only browser APIs.
 *
 * @param {{ directoryName: string, project: object, index: object, marker: object }} seed
 */
export async function seedWorkspaceInPage({ directoryName, project, index, marker }) {
  const storageRoot = await navigator.storage.getDirectory()
  const workspace = await storageRoot.getDirectoryHandle(directoryName, { create: true })

  async function writeText(segments, text) {
    let directory = workspace
    for (const segment of segments.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(segment, { create: true })
    }
    const file = await directory.getFileHandle(segments[segments.length - 1], { create: true })
    const writable = await file.createWritable()
    await writable.write(text)
    await writable.close()
  }

  await writeText(['projects', project.id, 'project.json'], JSON.stringify(project, null, 2))
  await writeText(['index.json'], JSON.stringify(index, null, 2))
  await writeText(['.freecut-workspace.json'], JSON.stringify(marker, null, 2))
  await writeText(['README.md'], '# Workspace written by the DroneClean Studio network check\n')

  // The app's own database: schema v1 of freecut-handles-db (handles-db.ts).
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('freecut-handles-db', 1)
    request.onupgradeneeded = () => {
      const created = request.result
      if (!created.objectStoreNames.contains('handles')) {
        const store = created.createObjectStore('handles', { keyPath: 'key' })
        store.createIndex('kind', 'kind', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  const workspaceId = 'network-check'
  const pickedAt = Date.now()
  const base = { kind: 'workspace', handle: workspace, name: workspace.name, pickedAt }
  const records = [
    { ...base, key: `workspace:${workspaceId}`, id: workspaceId },
    { ...base, key: 'workspace:current', id: 'current', activeWorkspaceId: workspaceId },
  ]
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('handles', 'readwrite')
    const store = transaction.objectStore('handles')
    for (const record of records) store.put(record)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
  database.close()

  return {
    name: workspace.name,
    permission: await workspace.queryPermission({ mode: 'readwrite' }),
  }
}

/** The `index.json` the app reads when it lists projects (`workspace-index.ts`). */
export function buildWorkspaceIndex(project) {
  return {
    version: '1.0',
    updatedAt: project.updatedAt,
    projects: [{ id: project.id, name: project.name, updatedAt: project.updatedAt }],
  }
}

/** The marker file that says this is a schema 2.0 workspace (`bootstrap.ts`). */
export function buildWorkspaceMarker(createdAt = FIXED_TIME) {
  return { schemaVersion: '2.0', createdAt }
}
