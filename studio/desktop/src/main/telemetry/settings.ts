/**
 * `userData/telemetry.json`: the user's answer about crash reports and usage statistics
 * (`shared/telemetry.ts`). Missing means never answered, which sends nothing; a file that cannot be
 * read as the version-1 object means the same, so a broken file never turns reports on.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  TELEMETRY_FILE,
  mergeTelemetryChoice,
  parseTelemetrySettings,
  type TelemetryChoice,
  type TelemetrySettings,
} from '../../shared/telemetry'

/** The answer's file in a profile folder. */
export function telemetrySettingsPath(userDataDir: string): string {
  return path.join(userDataDir, TELEMETRY_FILE)
}

/** The stored answer, or `null` when there is none or it cannot be read. */
export function readTelemetrySettings(filePath: string): TelemetrySettings | null {
  try {
    return parseTelemetrySettings(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch {
    return null
  }
}

/**
 * Merge a choice into the stored answer and write it whole (a temporary file renamed over the old
 * one, mode 0600), so a crash mid-write leaves the old answer or the new one, never half.
 */
export function writeTelemetryChoice(filePath: string, choice: TelemetryChoice): TelemetrySettings {
  const next = mergeTelemetryChoice(readTelemetrySettings(filePath), choice, randomUUID)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
  return next
}
