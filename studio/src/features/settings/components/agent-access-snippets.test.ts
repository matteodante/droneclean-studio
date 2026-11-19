/**
 * The snippets the Agent access panel copies (task 2.2 slice 7).
 *
 * They are paste-ready: the launcher path is quoted for a shell and escaped for
 * JSON and TOML, whichever platform the app runs on. The last test holds them
 * to `studio/mcp/configs/`: the shipped reference and the panel are the same
 * configuration with `APP` replaced, so neither can drift alone.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import { agentAccessSnippets } from './agent-access-snippets'

const LAUNCHER = '/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp'

function textOf(id: 'claude-code' | 'codex' | 'generic', launcher = LAUNCHER): string {
  const snippet = agentAccessSnippets(launcher).find((entry) => entry.id === id)
  if (!snippet) throw new Error(`no ${id} snippet`)
  return snippet.text
}

describe('Agent access snippets', () => {
  it('gives one snippet per client, in the order the panel shows them', () => {
    const snippets = agentAccessSnippets(LAUNCHER)

    expect(snippets.map((snippet) => snippet.id)).toEqual(['claude-code', 'codex', 'generic'])
    for (const snippet of snippets) {
      expect(snippet.text).toContain(LAUNCHER)
      expect(snippet.text).not.toContain('APP')
    }
  })

  it('runs the launcher through the Claude Code command, quoted as a shell word', () => {
    expect(textOf('claude-code')).toBe(`claude mcp add droneclean -- "${LAUNCHER}"`)
  })

  it('writes the Codex table and the generic mcpServers entry with a JSON-escaped path', () => {
    expect(textOf('codex')).toBe(`[mcp_servers.droneclean]\ncommand = ${JSON.stringify(LAUNCHER)}`)
    expect(JSON.parse(textOf('generic'))).toEqual({
      mcpServers: { droneclean: { command: LAUNCHER } },
    })
  })

  it('keeps a Windows path literal in the shell and escaped in the configs', () => {
    const windows =
      'C:\\Users\\Pilot\\AppData\\Local\\Programs\\DroneClean Studio\\resources\\mcp\\droneclean-mcp.cmd'

    expect(textOf('claude-code', windows)).toBe(`claude mcp add droneclean -- "${windows}"`)
    expect(textOf('codex', windows)).toContain(
      `command = "C:\\\\Users\\\\Pilot\\\\AppData\\\\Local\\\\Programs\\\\DroneClean Studio\\\\resources\\\\mcp\\\\droneclean-mcp.cmd"`,
    )
    expect(JSON.parse(textOf('generic', windows))).toEqual({
      mcpServers: { droneclean: { command: windows } },
    })
  })

  it('is the shipped client config with the real launcher path', () => {
    const desktop = readFileSync('mcp/configs/claude-desktop.json', 'utf8')
    expect(JSON.parse(desktop.replaceAll('APP', LAUNCHER))).toEqual(JSON.parse(textOf('generic')))

    const codex = readFileSync('mcp/configs/codex.toml', 'utf8')
    expect(codex.replaceAll('APP', LAUNCHER)).toContain(textOf('codex'))

    const claudeCode = readFileSync('mcp/configs/claude-code.sh', 'utf8')
    expect(claudeCode.replaceAll('APP', LAUNCHER)).toContain(
      `claude mcp add droneclean -- "${LAUNCHER}"`,
    )
  })
})
