/**
 * `userData/updates.json`: the "check for new versions" switch and what the last check found
 * (`shared/updates.ts`). A missing or unreadable file is the defaults: the check is on.
 */
import fs from 'node:fs'
import path from 'node:path'
import { UPDATES_FILE, parseUpdateSettings, type UpdateSettings } from '../../shared/updates'

/** The file in a profile folder. */
export function updateSettingsPath(userDataDir: string): string {
  return path.join(userDataDir, UPDATES_FILE)
}

/** The stored state, or the defaults. */
export function readUpdateSettings(filePath: string): UpdateSettings {
  try {
    return parseUpdateSettings(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch {
    return { version: 1 }
  }
}

/** Write the state whole (a temporary file renamed over the old one, mode 0600). */
export function writeUpdateSettings(filePath: string, settings: UpdateSettings): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}
