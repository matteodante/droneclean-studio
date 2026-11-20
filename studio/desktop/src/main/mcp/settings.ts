/**
 * "Allow AI agents": the setting that turns the MCP socket on (task 2.2,
 * design §0 decision 3, changed on 20 Nov 2026).
 *
 * It lives in `userData/agent-access.json` as `{ version: 1, enabled }` and is
 * **on by default** (Matteo, 20 Nov 2026: an agent works with the app out of the
 * box): a profile with no file reads as enabled. A file that exists but is not
 * the version-1 object (malformed, unreadable, a future format) reads as
 * disabled, so a file the user may have switched off with is never read as on.
 * The socket is per user either way (its file mode, or the Windows pipe's ACL).
 * The file is small and deliberately readable: the launcher reads it to tell
 * "the app has not started yet" from "agent access is off" without talking to
 * the app.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AgentAccessSettings } from '../../../../mcp/protocol'
import { PROTOCOL_VERSION, agentAccessSettingsPath } from './protocol'

/** What a profile without the setting means: on. */
export const AGENT_ACCESS_DEFAULT: AgentAccessSettings = { version: PROTOCOL_VERSION, enabled: true }

/** What a setting file that cannot be read as the version-1 object means. */
export const AGENT_ACCESS_OFF: AgentAccessSettings = { version: PROTOCOL_VERSION, enabled: false }

/**
 * Read the setting: the default (on) when there is no file, off when the file
 * is not the version-1 object.
 *
 * A future format is read as off until this code understands it, and a broken
 * file cannot crash startup.
 */
export function readAgentAccessSettings(filePath: string): AgentAccessSettings {
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? AGENT_ACCESS_DEFAULT : AGENT_ACCESS_OFF
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return AGENT_ACCESS_OFF
  }
  if (typeof parsed !== 'object' || parsed === null) return AGENT_ACCESS_OFF
  const record = parsed as Record<string, unknown>
  if (record.version !== PROTOCOL_VERSION || typeof record.enabled !== 'boolean') {
    return AGENT_ACCESS_OFF
  }
  return { version: PROTOCOL_VERSION, enabled: record.enabled }
}

/** Whether the setting at `filePath` is on. A missing file is on (the default). */
export function isAgentAccessEnabled(filePath: string): boolean {
  return readAgentAccessSettings(filePath).enabled
}

/**
 * Write the setting, creating its folder. The write replaces the file rather
 * than editing it, so a crash mid-write leaves either the old or the new
 * setting and never half of one.
 */
export function writeAgentAccessSettings(
  filePath: string,
  settings: AgentAccessSettings,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(
    temporary,
    `${JSON.stringify({ version: PROTOCOL_VERSION, enabled: settings.enabled }, null, 2)}\n`,
    { mode: 0o600 },
  )
  fs.renameSync(temporary, filePath)
}

/** Whether the setting of this profile is on. */
export function isAgentAccessEnabledForUser(userDataDir: string): boolean {
  return isAgentAccessEnabled(agentAccessSettingsPath(userDataDir))
}
