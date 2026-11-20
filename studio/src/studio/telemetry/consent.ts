/**
 * The user's answer about crash reports and usage statistics (20 Nov 2026).
 *
 * The editor makes no network request the user did not ask for (AGENTS.md), so both are off until
 * the user says yes: a profile that has never answered sends nothing, and the first-launch notice
 * (`consent-notice.tsx`) asks. Each half is answered on its own, so a half added in a later release
 * (usage statistics before its PostHog project existed) is asked about then, and an earlier "no"
 * is never read as a yes.
 *
 * Where the answer lives: in the desktop app, `userData/telemetry.json`, through the shell's
 * `window.dronecleanTelemetry` (`desktop/src/preload/telemetry.ts`), so the main process reads the
 * same answer before any window opens; in the browser, this origin's localStorage. The shapes mirror
 * `desktop/src/shared/telemetry.ts`, which the page cannot import.
 *
 * `installId` is a random id of this installation, made when usage statistics are switched on and
 * forgotten when they are switched off: it lets PostHog count installations without knowing who
 * anyone is (no account, no `identify`).
 */
import { create } from 'zustand'
import { TELEMETRY_FEATURES, type TelemetryFeatures } from './config'

/** One half of the choice. */
export type TelemetryKind = keyof TelemetryFeatures

/** What the user answered; an absent half was never asked. */
export interface TelemetryChoice {
  crashReports?: boolean
  usageStats?: boolean
}

/** The stored answer: the choice, its format version and, while usage statistics are on, the id. */
export interface TelemetrySettings extends TelemetryChoice {
  version: 1
  installId?: string
}

/** What `window.dronecleanTelemetry` offers the page. */
interface TelemetryBridge {
  readonly version: 1
  /** The stored answer; `null` when the profile has none. */
  get(): Promise<TelemetrySettings | null>
  /** Store a new answer (merged into the old one) and apply it in the main process; answers what was stored. */
  set(choice: TelemetryChoice): Promise<TelemetrySettings>
}

declare global {
  interface Window {
    /** Installed by the shell's `preload/telemetry.ts`; absent in the browser. */
    dronecleanTelemetry?: TelemetryBridge
  }
}

/** The localStorage key of the browser build. */
const TELEMETRY_STORAGE_KEY = 'droneclean-telemetry'

function getTelemetryBridge(): TelemetryBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const bridge = window.dronecleanTelemetry
  return bridge?.version === 1 ? bridge : undefined
}

/**
 * Read a stored answer: the version-1 object with boolean halves, or `null`. Anything else (a
 * broken value, a future format) reads as never answered, which sends nothing.
 */
function parseTelemetrySettings(value: unknown): TelemetrySettings | null {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  if (record.version !== 1) return null
  const settings: TelemetrySettings = { version: 1, ...halvesOf(record) }
  const id = record.installId
  if (settings.usageStats === true && typeof id === 'string' && id !== '') settings.installId = id
  return settings
}

/** The boolean halves of a value; anything else in it is dropped. */
function halvesOf(record: Record<string, unknown>): TelemetryChoice {
  const choice: TelemetryChoice = {}
  if (typeof record.crashReports === 'boolean') choice.crashReports = record.crashReports
  if (typeof record.usageStats === 'boolean') choice.usageStats = record.usageStats
  return choice
}

/** Merge a new answer into the stored one; the id is made with usage statistics and dropped with them. */
function mergeTelemetryChoice(
  previous: TelemetrySettings | null,
  choice: TelemetryChoice,
  makeId: () => string,
): TelemetrySettings {
  const next: TelemetrySettings = {
    version: 1,
    ...halvesOf({ ...previous }),
    ...halvesOf({ ...choice }),
  }
  if (next.usageStats === true) next.installId = previous?.installId ?? makeId()
  return next
}

function readBrowserSettings(): TelemetrySettings | null {
  try {
    const text = window.localStorage.getItem(TELEMETRY_STORAGE_KEY)
    return text === null ? null : parseTelemetrySettings(JSON.parse(text))
  } catch {
    return null
  }
}

function writeBrowserSettings(settings: TelemetrySettings): void {
  try {
    window.localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage refused (private window, quota): the answer holds for this session only.
  }
}

/** Whether a half is on: answered yes and offered by this build. */
export function isTelemetryOn(
  settings: TelemetrySettings | null,
  kind: TelemetryKind,
  features: TelemetryFeatures = TELEMETRY_FEATURES,
): boolean {
  return features[kind] && settings?.[kind] === true
}

/** Whether the first-launch notice has something to ask: a half this build offers was never answered. */
export function needsTelemetryAnswer(
  settings: TelemetrySettings | null,
  features: TelemetryFeatures = TELEMETRY_FEATURES,
): boolean {
  return (
    (features.crashReports && settings?.crashReports === undefined) ||
    (features.usageStats && settings?.usageStats === undefined)
  )
}

interface TelemetryConsentState {
  /** Whether the stored answer has been read; nothing is asked or sent before. */
  loaded: boolean
  settings: TelemetrySettings | null
  /** Read the stored answer once at startup. */
  load(): Promise<void>
  /** Store an answer for one or both halves. */
  choose(choice: TelemetryChoice): Promise<void>
}

export const useTelemetryConsent = create<TelemetryConsentState>((set, get) => ({
  loaded: false,
  settings: null,
  async load() {
    const bridge = getTelemetryBridge()
    let settings: TelemetrySettings | null = null
    try {
      settings = bridge ? parseTelemetrySettings(await bridge.get()) : readBrowserSettings()
    } catch {
      settings = null
    }
    set({ loaded: true, settings })
  },
  async choose(choice) {
    const bridge = getTelemetryBridge()
    if (bridge) {
      const stored = parseTelemetrySettings(await bridge.set(choice))
      set({ settings: stored })
      return
    }
    const next = mergeTelemetryChoice(get().settings, choice, () => crypto.randomUUID())
    writeBrowserSettings(next)
    set({ settings: next })
  },
}))
