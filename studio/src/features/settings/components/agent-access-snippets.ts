/**
 * The client configuration the Agent access panel offers to copy (task 2.2
 * slice 7, design §0 decision 1 and §4.1).
 *
 * v1 speaks **stdio only**: every snippet names the app's stdio launcher
 * (`studio/mcp/droneclean-mcp`, `.cmd` on Windows) and nothing else — no URL,
 * no port, no token. They are the shipped reference in `studio/mcp/configs/`
 * with the `APP` placeholder replaced by the real launcher path;
 * `agent-access-snippets.test.ts` holds the two sides together, so editing one
 * without the other fails there.
 *
 * The texts are clipboard-ready: Claude Code's file is a commented example, so
 * the panel offers the command itself, and the Codex table has no comment line
 * because it is pasted into `~/.codex/config.toml`.
 */

/** One client configuration, as the panel shows and copies it. */
export interface AgentAccessSnippet {
  /** Stable id, also the React key. */
  readonly id: 'claude-code' | 'codex' | 'generic'
  /** i18n key of the client's name above the snippet. */
  readonly titleKey: string
  /** i18n key of the one sentence saying where the snippet goes. */
  readonly descriptionKey: string
  /** The clipboard text. */
  readonly text: string
}

/**
 * The launcher path as a shell word: always double-quoted, because every real
 * install path has a space ("DroneClean Studio.app", "Application Support").
 * Only the characters a POSIX shell or PowerShell would interpret inside double
 * quotes are escaped; backslashes of a Windows path are literal there and are
 * left alone.
 */
function shellWord(path: string): string {
  return `"${path.replace(/(["$`])/g, '\\$1')}"`
}

/**
 * The three snippets for a launcher path. A JSON string is also a TOML basic
 * string for a path (both escape backslashes and quotes the same way), so the
 * Codex table and the JSON use the same quoted value.
 */
export function agentAccessSnippets(launcherPath: string): AgentAccessSnippet[] {
  const quoted = JSON.stringify(launcherPath)
  return [
    {
      id: 'claude-code',
      titleKey: 'settings.agentAccess.snippets.claudeCodeTitle',
      descriptionKey: 'settings.agentAccess.snippets.claudeCode',
      text: `claude mcp add droneclean -- ${shellWord(launcherPath)}`,
    },
    {
      id: 'codex',
      titleKey: 'settings.agentAccess.snippets.codexTitle',
      descriptionKey: 'settings.agentAccess.snippets.codex',
      text: `[mcp_servers.droneclean]\ncommand = ${quoted}`,
    },
    {
      id: 'generic',
      titleKey: 'settings.agentAccess.snippets.genericTitle',
      descriptionKey: 'settings.agentAccess.snippets.generic',
      text: `{\n  "mcpServers": {\n    "droneclean": {\n      "command": ${quoted}\n    }\n  }\n}`,
    },
  ]
}
