/**
 * The Agent access panel (task 2.2 slice 7): the switch, the socket path, the
 * three stdio snippets and the last calls.
 *
 * The bridge is faked on `window` exactly as the shell's preload installs it,
 * so the test drives the same getter the app does. The English copy is added to
 * the i18n instance here (as the studio tests do); the strings themselves are
 * reported to the coordinator, who applies them to the nine language files.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import i18n from '@/i18n'
import { hasAgentAccess, type AgentAccessInfo, type AgentLogLine } from '@/studio/agent/access'
import { AgentAccessPanel } from './agent-access-panel'

const INFO: AgentAccessInfo = {
  enabled: false,
  status: 'off',
  socketPath: '/Users/test/Library/Application Support/DroneClean Studio/mcp.sock',
  launcherPath: '/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp',
}

const SEARCH: AgentLogLine = {
  at: '2026-11-18T10:00:00.000Z',
  tool: 'search',
  argsHash: 'a1',
  summary: 'search "split"',
  durationMs: 12,
  code: 'OK',
}

const RUN: AgentLogLine = {
  at: '2026-11-18T10:01:00.000Z',
  tool: 'run',
  argsHash: 'b2',
  summary: 'run "trim the intro" (48 byte script)',
  durationMs: 34,
  code: 'OK',
  undoSteps: 2,
}

function makeBridge() {
  return {
    version: 1 as const,
    status: vi.fn(async (): Promise<AgentAccessInfo> => INFO),
    enable: vi.fn(async (): Promise<AgentAccessInfo> => ({ ...INFO, enabled: true, status: 'on' })),
    disable: vi.fn(async (): Promise<AgentAccessInfo> => INFO),
    log: vi.fn(async (): Promise<AgentLogLine[]> => []),
  }
}

let bridge: ReturnType<typeof makeBridge>

beforeAll(() => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      settings: {
        agentAccess: {
          title: 'Agent access',
          description:
            'Lets an AI agent running on this Mac read the open project, change it and start exports. Nothing leaves your Mac; off by default.',
          enable: 'Allow AI agents',
          socketPath: 'Socket',
          socketDescription:
            'The app listens here while the switch is on; only your user can read it.',
          copy: 'Copy',
          copied: 'Copied',
          conflict: 'Another DroneClean Studio window is already serving agent access.',
          error: 'Agent access could not start.',
          stateFailed: 'The Agent access state could not be read.',
          snippetsTitle: 'Connect a client',
          snippets: {
            claudeCodeTitle: 'Claude Code',
            codexTitle: 'Codex',
            genericTitle: 'Generic (stdio)',
            claudeCode: 'Run this once in a terminal.',
            codex: 'Add this to ~/.codex/config.toml.',
            generic:
              "The mcpServers entry of a stdio client, such as Claude Desktop's claude_desktop_config.json.",
          },
          lastCalls: 'Last calls',
          noCalls: 'No calls yet.',
          logFailed: 'The log could not be read.',
          duration: '{{ms}} ms',
          undoSteps: 'Undo × {{count}}',
        },
      },
    },
    true,
    true,
  )
})

beforeEach(() => {
  bridge = makeBridge()
  window.dronecleanAgentAccess = bridge
})

afterEach(() => {
  delete window.dronecleanAgentAccess
  vi.restoreAllMocks()
})

describe('AgentAccessPanel', () => {
  it('shows the switch, the socket and the three stdio snippets with the real launcher', async () => {
    const { container } = render(<AgentAccessPanel />)

    const toggle = await screen.findByRole('switch', { name: 'Allow AI agents' })
    await waitFor(() => expect(toggle).not.toBeDisabled())
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(INFO.socketPath)).toBeInTheDocument()

    const blocks = [...container.querySelectorAll('pre')].map((pre) => pre.textContent)
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toBe(`claude mcp add droneclean -- "${INFO.launcherPath}"`)
    expect(blocks[1]).toBe(
      `[mcp_servers.droneclean]\ncommand = ${JSON.stringify(INFO.launcherPath)}`,
    )
    expect(JSON.parse(blocks[2] ?? '{}')).toEqual({
      mcpServers: { droneclean: { command: INFO.launcherPath } },
    })
    expect(bridge.status).toHaveBeenCalledTimes(1)
  })

  it('turns the socket on and off, and shows why a turn-on failed', async () => {
    render(<AgentAccessPanel />)
    const toggle = await screen.findByRole('switch', { name: 'Allow AI agents' })
    await waitFor(() => expect(toggle).not.toBeDisabled())

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    expect(bridge.enable).toHaveBeenCalledTimes(1)
    expect(bridge.disable).not.toHaveBeenCalled()

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(bridge.disable).toHaveBeenCalledTimes(1)

    bridge.enable.mockResolvedValue({
      ...INFO,
      status: 'error',
      error: 'agent access: the socket is taken',
    })
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(screen.getByText('agent access: the socket is taken')).toBeInTheDocument(),
    )
    expect(toggle).not.toBeChecked()
  })

  it('says when the shell answers the state with a problem instead of an error message', async () => {
    bridge.status.mockResolvedValue({ ...INFO, enabled: true, status: 'conflict' })
    render(<AgentAccessPanel />)

    expect(
      await screen.findByText('Another DroneClean Studio window is already serving agent access.'),
    ).toBeInTheDocument()
  })

  it('says when the state itself cannot be read', async () => {
    bridge.status.mockRejectedValue(new Error('ipc is gone'))
    render(<AgentAccessPanel />)

    expect(await screen.findByText('The Agent access state could not be read.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Allow AI agents' })).toBeDisabled()
  })

  it('copies the path and each snippet, and says it copied', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(<AgentAccessPanel />)
    await screen.findByText(INFO.socketPath)

    fireEvent.click(screen.getByRole('button', { name: `Copy ${INFO.socketPath}` }))
    expect(writeText).toHaveBeenLastCalledWith(INFO.socketPath)

    const claudeCode = screen.getByRole('button', { name: 'Copy Claude Code' })
    fireEvent.click(claudeCode)
    expect(writeText).toHaveBeenLastCalledWith(
      `claude mcp add droneclean -- "${INFO.launcherPath}"`,
    )
    await waitFor(() => expect(within(claudeCode).getByText('Copied')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Copy Codex' }))
    expect(writeText).toHaveBeenLastCalledWith(
      `[mcp_servers.droneclean]\ncommand = ${JSON.stringify(INFO.launcherPath)}`,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy Generic (stdio)' }))
    expect(JSON.parse(String(writeText.mock.lastCall?.[0]))).toEqual({
      mcpServers: { droneclean: { command: INFO.launcherPath } },
    })
  })

  it('reads the last calls when it opens and shows the newest first', async () => {
    bridge.log.mockResolvedValue([SEARCH, RUN])
    const { container } = render(<AgentAccessPanel />)

    expect(await screen.findByText(RUN.summary)).toBeInTheDocument()
    const rows = [...container.querySelectorAll('li')].map((row) => row.textContent ?? '')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain(RUN.summary)
    expect(rows[0]).toContain('Undo × 2')
    expect(rows[0]).toContain('34 ms')
    expect(rows[1]).toContain(SEARCH.summary)
    expect(bridge.log).toHaveBeenCalledTimes(1)
  })

  it('shows a failed call in the log with its error as the tooltip', async () => {
    bridge.log.mockResolvedValue([
      { ...SEARCH, code: 'INVALID_ARGUMENT', error: 'the script did not parse' },
    ])
    render(<AgentAccessPanel />)

    const code = await screen.findByText('INVALID_ARGUMENT')
    expect(code).toHaveAttribute('title', 'the script did not parse')
  })

  it('says when nothing was called yet', async () => {
    render(<AgentAccessPanel />)
    expect(await screen.findByText('No calls yet.')).toBeInTheDocument()
  })

  it('says when the log cannot be read', async () => {
    bridge.log.mockRejectedValue(new Error('the log is not readable'))
    render(<AgentAccessPanel />)
    expect(await screen.findByText('The log could not be read.')).toBeInTheDocument()
  })

  it('is not offered outside the desktop shell', () => {
    delete window.dronecleanAgentAccess
    expect(hasAgentAccess()).toBe(false)

    const { container } = render(<AgentAccessPanel />)
    expect(container).toBeEmptyDOMElement()
  })
})
