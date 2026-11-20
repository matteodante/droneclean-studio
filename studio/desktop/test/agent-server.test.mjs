/**
 * The MCP server over its per-user socket (task 2.2, slices 0 and 1).
 *
 * The tests speak raw JSON-RPC over the real socket — no MCP client — and use
 * the fixture as corpus and message reference. They cover: the handshake, the
 * four tools, the agent log, the socket's mode, the setting that keeps the
 * socket from existing while off, one listener per user folder, and a second
 * client after the first one leaves.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import * as fixture from '../../mcp/fixture.mjs'
import { hashArguments } from '../out/main/mcp/log.js'
import { agentAccessSettingsPath, agentLogPath } from '../out/main/mcp/protocol.js'
import { createAgentAccess } from '../out/main/mcp/server.js'
import { createFakeStudio, createVmPage } from './support/fake-page.mjs'
import { connectSocket } from './support/socket-client.mjs'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-agent-server-'))
}

function makeAccess(userDataDir, page = createVmPage()) {
  return createAgentAccess({
    userDataDir,
    page,
    loadDocuments: async () => fixture.CORPUS,
    logger: () => undefined,
  })
}

/**
 * The editor page with the two bridges `frame` and `export` call, so those
 * tools are exercised end to end rather than answering their "no page" error:
 * a frame renderer answering a two-byte PNG, and the export bridge answering
 * one job. The script the server evaluates is still the generated one.
 */
function createToolPage() {
  const studio = createFakeStudio()
  const studioAgentFrame = {
    render(plan) {
      return {
        result: { png: 'UE5H', bytes: 3, width: plan.width, height: 720 },
        durationMs: 1,
      }
    },
  }
  const studioAgent = {
    export(request) {
      return {
        id: request.jobId ?? 'job-fixture',
        name: 'Fixture',
        status: 'rendering',
        progress: 42,
        inPoint: 0,
        outPoint: 150,
        durationFrames: 150,
        exportMode: 'video',
        fileName: 'fixture.mp4',
        createdAt: 1,
      }
    },
  }
  return {
    studio,
    execute(code) {
      const sandbox = {
        studio,
        window: { studio },
        studioAgent,
        studioAgentFrame,
        setTimeout,
        clearTimeout,
        console,
        AbortController,
      }
      return Promise.resolve(vm.runInNewContext(code, sandbox))
    },
  }
}

async function handshake(client) {
  client.send(fixture.INITIALIZE_REQUEST)
  const initialized = await client.receive()
  client.send(fixture.INITIALIZED_NOTIFICATION)
  return initialized
}

function callTool(client, id, name, arguments_) {
  client.send({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: arguments_ },
  })
  return client.receive()
}

const textOf = (message) => JSON.parse(message.result.content[0].text)

test('on by default: with no settings file the app listens at startup (Matteo, 20 Nov 2026)', async () => {
  const dir = tempDir()
  const access = makeAccess(dir)
  try {
    await access.startIfEnabled()
    assert.equal(access.status(), 'on')
    assert.equal(fs.existsSync(agentAccessSettingsPath(dir)), false, 'the default writes no file')
    assert.equal(fs.statSync(access.socketPath).mode & 0o777, 0o600)
    const client = await connectSocket(access.socketPath)
    client.close()
  } finally {
    await access.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('switched off: no socket at startup, and connecting fails', async () => {
  const dir = tempDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(agentAccessSettingsPath(dir), JSON.stringify(fixture.SETTINGS_OFF))
  const access = makeAccess(dir)
  try {
    await access.startIfEnabled()
    assert.equal(access.status(), 'off')
    assert.equal(fs.existsSync(access.socketPath), false)
    await assert.rejects(() => connectSocket(access.socketPath))
  } finally {
    await access.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('enable writes the setting, listens on a 0600 socket and answers the handshake', async () => {
  const dir = tempDir()
  const access = makeAccess(dir)
  const client = await (async () => {
    await access.enable()
    assert.equal(access.status(), 'on')
    assert.deepEqual(JSON.parse(fs.readFileSync(agentAccessSettingsPath(dir), 'utf8')), {
      version: 1,
      enabled: true,
    })
    assert.equal(fs.statSync(access.socketPath).mode & 0o777, 0o600)
    return connectSocket(access.socketPath)
  })()
  try {
    const initialized = await handshake(client)
    assert.equal(initialized.result.serverInfo.name, fixture.CONSTANTS.serverName)
    assert.equal(initialized.result.serverInfo.version, fixture.CONSTANTS.serverVersion)
    assert.equal(initialized.result.protocolVersion, fixture.INITIALIZE_RESULT.result.protocolVersion)
    assert.equal(initialized.result.instructions, fixture.INITIALIZE_RESULT.result.instructions)
    assert.ok(initialized.result.capabilities.tools)

    client.send(fixture.TOOLS_LIST_REQUEST)
    const tools = await client.receive()
    const names = tools.result.tools.map((tool) => tool.name)
    assert.deepEqual(names, fixture.EXPECTED_TOOL_NAMES)
    // The recorded fixture is what a client sees: title and description included.
    assert.deepEqual(
      tools.result.tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
      })),
      fixture.TOOLS_LIST_RESULT.result.tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
      })),
    )
    const frame = tools.result.tools.find((tool) => tool.name === 'frame')
    const exportTool = tools.result.tools.find((tool) => tool.name === 'export')
    assert.match(frame.description, /contact sheet/)
    assert.match(exportTool.description, /queues a job/)
    assert.doesNotMatch(frame.description, /UNSUPPORTED|not available/)
    assert.doesNotMatch(exportTool.description, /UNSUPPORTED|not available/)
  } finally {
    client.close()
    await access.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('run executes through the page, answers its result and logs a hash, not the script', async () => {
  const dir = tempDir()
  const page = createVmPage()
  const access = makeAccess(dir, page)
  await access.enable()
  const client = await connectSocket(access.socketPath)
  try {
    await handshake(client)
    const response = await callTool(
      client,
      10,
      'run',
      fixture.RUN_REQUEST.params.arguments,
    )
    assert.equal(response.result.isError, undefined)
    const result = textOf(response)
    assert.equal(result.value, 42)
    assert.equal(result.undoSteps, 1)
    assert.equal(result.changes.commands.length, 1)
    assert.equal(typeof result.durationMs, 'number')
    assert.deepEqual(page.studio.labels, ['agent: fixture'])

    const log = fs
      .readFileSync(agentLogPath(dir), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.equal(log.length, 1)
    assert.deepEqual(Object.keys(log[0]).sort(), [...fixture.MESSAGE_KEYS.LOG_LINE_RUN].sort())
    assert.equal(log[0].tool, 'run')
    assert.equal(log[0].code, 'OK')
    assert.equal(log[0].undoSteps, 1)
    assert.equal(log[0].argsHash, hashArguments(fixture.RUN_REQUEST.params.arguments))
    assert.equal(log[0].summary, fixture.LOG_LINES[0].summary)
    assert.equal(fs.readFileSync(agentLogPath(dir), 'utf8').includes('s.edit()'), false)
  } finally {
    client.close()
    await access.disable()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a run that hangs answers TIMEOUT and does not wedge the next call', async () => {
  const dir = tempDir()
  const access = makeAccess(dir)
  await access.enable()
  const client = await connectSocket(access.socketPath)
  try {
    await handshake(client)
    const startedAt = Date.now()
    const timedOut = await callTool(client, 11, 'run', {
      script: 'async s => new Promise(() => {})',
      label: 'hang',
      timeoutMs: 30,
    })
    assert.ok(Date.now() - startedAt < 3000)
    assert.equal(timedOut.result.isError, true)
    assert.equal(textOf(timedOut).code, 'TIMEOUT')

    const next = await callTool(client, 12, 'search', { query: 'split', limit: 2 })
    assert.equal(next.result.isError, undefined)
    assert.equal(textOf(next).results.length, 2)
  } finally {
    client.close()
    await access.disable()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('search answers the fixture’s hits over the socket', async () => {
  const dir = tempDir()
  const access = makeAccess(dir)
  await access.enable()
  const client = await connectSocket(access.socketPath)
  try {
    await handshake(client)
    const response = await callTool(
      client,
      20,
      'search',
      fixture.SEARCH_REQUEST.params.arguments,
    )
    assert.equal(response.result.isError, undefined)
    const recorded = JSON.parse(fixture.SEARCH_RESULT.result.content[0].text)
    assert.deepEqual(textOf(response), recorded)
  } finally {
    client.close()
    await access.disable()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('frame reaches the page and answers the PNG as an image content item', async () => {
  const dir = tempDir()
  const access = makeAccess(dir, createToolPage())
  await access.enable()
  const client = await connectSocket(access.socketPath)
  try {
    await handshake(client)
    const response = await callTool(client, 30, 'frame', { frame: 42, width: 640 })
    assert.equal(response.result.isError, undefined)
    assert.deepEqual(response.result.content[0], {
      type: 'image',
      data: 'UE5H',
      mimeType: 'image/png',
    })
    assert.deepEqual(JSON.parse(response.result.content[1].text), {
      bytes: 3,
      width: 640,
      height: 720,
    })
  } finally {
    client.close()
    await access.disable()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('export polls one job through the page and answers it at once', async () => {
  const dir = tempDir()
  const access = makeAccess(dir, createToolPage())
  await access.enable()
  const client = await connectSocket(access.socketPath)
  try {
    await handshake(client)
    const response = await callTool(client, 31, 'export', { jobId: 'job-fixture' })
    assert.equal(response.result.isError, undefined)
    const job = textOf(response)
    assert.equal(job.id, 'job-fixture')
    assert.equal(job.status, 'rendering')
    assert.equal(job.progress, 42)
  } finally {
    client.close()
    await access.disable()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('every call lands in the agent log with its code and duration', async () => {
  const dir = tempDir()
  const access = makeAccess(dir, createToolPage())
  await access.enable()
  const client = await connectSocket(access.socketPath)
  try {
    await handshake(client)
    await callTool(client, 40, 'search', { query: 'split', limit: 1 })
    await callTool(client, 41, 'run', { script: 's => { s.edit(); return 1 }', label: 'count' })
    await callTool(client, 42, 'frame', { frame: 0 })
    const lines = fs
      .readFileSync(agentLogPath(dir), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.deepEqual(
      lines.map((line) => [line.tool, line.code]),
      [
        ['search', 'OK'],
        ['run', 'OK'],
        ['frame', 'OK'],
      ],
    )
    for (const line of lines) {
      assert.match(line.argsHash, /^[0-9a-f]{64}$/)
      assert.equal(typeof line.durationMs, 'number')
      assert.equal(typeof line.at, 'string')
      assert.ok(line.summary.length <= fixture.CONSTANTS.logSummaryMaxChars)
    }
    assert.equal(lines[1].undoSteps, 1)
    assert.equal(lines[2].undoSteps, undefined)
  } finally {
    client.close()
    await access.disable()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a second client connects after the first one leaves', async () => {
  const dir = tempDir()
  const access = makeAccess(dir)
  await access.enable()
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const client = await connectSocket(access.socketPath)
      const initialized = await handshake(client)
      assert.equal(initialized.result.serverInfo.name, fixture.CONSTANTS.serverName)
      client.close()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  } finally {
    await access.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('one user folder has one listener: a second enable is a CONFLICT', async () => {
  const dir = tempDir()
  const first = makeAccess(dir)
  const second = makeAccess(dir)
  await first.enable()
  try {
    await assert.rejects(() => second.enable(), (error) => error.json?.code === 'CONFLICT')
    assert.equal(second.status(), 'conflict')
    // The first listener still answers.
    const client = await connectSocket(first.socketPath)
    const initialized = await handshake(client)
    assert.equal(initialized.result.serverInfo.name, fixture.CONSTANTS.serverName)
    client.close()
  } finally {
    await second.dispose()
    await first.disable()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('disable removes the socket and writes the setting off', async () => {
  const dir = tempDir()
  const access = makeAccess(dir)
  await access.enable()
  const socketPath = access.socketPath
  await access.disable()
  assert.equal(access.status(), 'off')
  assert.equal(fs.existsSync(socketPath), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(agentAccessSettingsPath(dir), 'utf8')), {
    version: 1,
    enabled: false,
  })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a stale socket file does not block the next launch', async () => {
  const dir = tempDir()
  const stalePath = path.join(dir, fixture.CONSTANTS.socketFileName)
  fs.mkdirSync(path.dirname(stalePath), { recursive: true })
  fs.writeFileSync(stalePath, 'stale')
  const access = makeAccess(dir)
  await access.enable()
  try {
    assert.equal(access.status(), 'on')
    const client = await connectSocket(access.socketPath)
    const initialized = await handshake(client)
    assert.equal(initialized.result.serverInfo.name, fixture.CONSTANTS.serverName)
    client.close()
  } finally {
    await access.disable()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
