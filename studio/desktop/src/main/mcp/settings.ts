/**
 * "Allow AI agents": the setting that turns the MCP socket on (task 2.2,
 * design §0 decision 3).
 *
 * It lives in `userData/agent-access.json` as `{ version: 1, enabled }` and is
 * **off by default**: a missing file, a malformed file or any value that is not
 * the version-1 object reads as disabled, so a fresh profile can never expose
 * a socket by accident. The file is small and deliberately readable: the
 * launcher reads it to tell "the app has not started yet" from "agent access is
 * off" without talking to the app.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AgentAccessSettings } from '../../../../mcp/protocol'
import { PROTOCOL_VERSION, agentAccessSettingsPath } from './protocol'

/** What a profile without the setting means. */
export const AGENT_ACCESS_OFF: AgentAccessSettings = { version: PROTOCOL_VERSION, enabled: false }

/**
 * Read the setting, falling back to off.
 *
 * Only the exact version-1 shape counts as enabled: a future format is read as
 * off until this code understands it, and a broken file cannot crash startup.
 */
export function readAgentAccessSettings(filePath: string): AgentAccessSettings {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
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

/** Whether the setting at `filePath` is on. A missing file is off. */
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
