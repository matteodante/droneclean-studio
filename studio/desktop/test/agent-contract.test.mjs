/**
 * The contract test (task 2.2, slice 0): `studio/mcp/protocol.d.ts` and its
 * recorded fixture against the two implementations.
 *
 * It is the meeting point's check. Renaming a key in the fixture makes this
 * test name it (`MESSAGE_KEYS` no longer matches), and the launcher test, which
 * reads `SESSION[i].request/response`, fails on the same key. The socket path,
 * the setting's name, the log's name, the timeouts and the exit codes are
 * compared between the main process, the launcher and the fixture, so neither
 * side can drift alone.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as fixture from '../../mcp/fixture.mjs'
import * as launcher from '../../mcp/launcher.mjs'
import { hashArguments, summarizeCall } from '../out/main/mcp/log.js'
import * as protocol from '../out/main/mcp/protocol.js'

const keysOf = (value) => Object.keys(value).sort()

function assertKeys(name, value, expected) {
  assert.deepEqual(keysOf(value), [...expected].sort(), `${name} keys changed`)
}

test('every recorded message keeps its keys', () => {
  assertKeys('INITIALIZE_REQUEST', fixture.INITIALIZE_REQUEST, fixture.MESSAGE_KEYS.INITIALIZE_REQUEST)
  assertKeys('INITIALIZE params', fixture.INITIALIZE_REQUEST.params, fixture.MESSAGE_KEYS.INITIALIZE_PARAMS)
  assertKeys('INITIALIZE_RESULT', fixture.INITIALIZE_RESULT, fixture.MESSAGE_KEYS.INITIALIZE_RESULT)
  assertKeys(
    'INITIALIZED_NOTIFICATION',
    fixture.INITIALIZED_NOTIFICATION,
    fixture.MESSAGE_KEYS.INITIALIZED_NOTIFICATION,
  )
  assertKeys('TOOLS_LIST_REQUEST', fixture.TOOLS_LIST_REQUEST, fixture.MESSAGE_KEYS.TOOLS_LIST_REQUEST)
  assertKeys('TOOLS_LIST_RESULT', fixture.TOOLS_LIST_RESULT, fixture.MESSAGE_KEYS.TOOLS_LIST_RESULT)
  for (const tool of fixture.TOOLS_LIST_RESULT.result.tools) {
    assertKeys(`tool ${tool.name}`, tool, fixture.MESSAGE_KEYS.TOOLS_LIST_TOOL)
  }
  assertKeys('SEARCH_REQUEST', fixture.SEARCH_REQUEST, fixture.MESSAGE_KEYS.SEARCH_REQUEST)
  assertKeys(
    'SEARCH_REQUEST arguments',
    fixture.SEARCH_REQUEST.params.arguments,
    fixture.MESSAGE_KEYS.SEARCH_ARGUMENTS,
  )
  assertKeys('SEARCH_RESULT', fixture.SEARCH_RESULT, fixture.MESSAGE_KEYS.SEARCH_RESULT)
  assertKeys('RUN_REQUEST', fixture.RUN_REQUEST, fixture.MESSAGE_KEYS.RUN_REQUEST)
  assertKeys('RUN_REQUEST arguments', fixture.RUN_REQUEST.params.arguments, fixture.MESSAGE_KEYS.RUN_ARGUMENTS)
  assertKeys('RUN_RESULT', fixture.RUN_RESULT, fixture.MESSAGE_KEYS.RUN_RESULT)
  assertKeys('FRAME_REQUEST', fixture.FRAME_REQUEST, fixture.MESSAGE_KEYS.FRAME_REQUEST)
  assertKeys('EXPORT_REQUEST', fixture.EXPORT_REQUEST, fixture.MESSAGE_KEYS.EXPORT_REQUEST)
  assertKeys('SETTINGS_ON', fixture.SETTINGS_ON, fixture.MESSAGE_KEYS.SETTINGS_ON)
  assertKeys('SETTINGS_OFF', fixture.SETTINGS_OFF, fixture.MESSAGE_KEYS.SETTINGS_OFF)
  assertKeys('LOG_LINES[0]', fixture.LOG_LINES[0], fixture.MESSAGE_KEYS.LOG_LINE_RUN)
  assertKeys('LOG_LINES[1]', fixture.LOG_LINES[1], fixture.MESSAGE_KEYS.LOG_LINE_FRAME)
  const hits = JSON.parse(fixture.SEARCH_RESULT.result.content[0].text).results
  assert.ok(hits.length > 0)
  for (const hit of hits) assertKeys('search hit', hit, fixture.MESSAGE_KEYS.SEARCH_HIT)
})

test('the four tools are the fixture’s, in order, and none calls itself unavailable', () => {
  const tools = fixture.TOOLS_LIST_RESULT.result.tools
  assert.deepEqual(
    tools.map((tool) => tool.name),
    fixture.EXPECTED_TOOL_NAMES,
  )
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  assert.doesNotMatch(byName.get('frame').description, /NOT AVAILABLE|not available/)
  assert.doesNotMatch(byName.get('export').description, /NOT AVAILABLE|not available/)
  assert.match(byName.get('frame').description, /contact sheet/)
  assert.match(byName.get('export').description, /queues a job/)
  assert.doesNotMatch(byName.get('search').description, /NOT AVAILABLE/)
  assert.doesNotMatch(byName.get('run').description, /NOT AVAILABLE/)
})

test('the main process, the launcher and the fixture agree on every constant', () => {
  const constants = fixture.CONSTANTS
  assert.equal(protocol.PROTOCOL_VERSION, constants.protocolVersion)
  assert.equal(protocol.SERVER_NAME, constants.serverName)
  assert.equal(protocol.SERVER_VERSION, constants.serverVersion)
  assert.equal(protocol.SOCKET_FILE_NAME, constants.socketFileName)
  assert.equal(protocol.WINDOWS_PIPE_NAME_PREFIX, constants.windowsPipePrefix)
  assert.equal(protocol.SETTINGS_FILE_NAME, constants.settingsFileName)
  assert.equal(protocol.LOG_DIR_NAME, constants.logDirName)
  assert.equal(protocol.LOG_RETENTION_DAYS, constants.logRetentionDays)
  assert.equal(protocol.DEFAULT_RUN_TIMEOUT_MS, constants.defaultRunTimeoutMs)
  assert.equal(protocol.MAX_RUN_TIMEOUT_MS, constants.maxRunTimeoutMs)
  assert.equal(protocol.RUN_TIMEOUT_GRACE_MS, constants.runTimeoutGraceMs)
  assert.equal(protocol.MAX_SCRIPT_BYTES, constants.maxScriptBytes)
  assert.equal(protocol.MAX_RESULT_BYTES, constants.maxResultBytes)
  assert.equal(protocol.MAX_RUN_LABEL_CHARS, constants.maxRunLabelChars)
  assert.equal(protocol.LOG_SUMMARY_MAX_CHARS, constants.logSummaryMaxChars)
  assert.equal(protocol.DEFAULT_FRAME_WIDTH, constants.defaultFrameWidth)
  assert.equal(protocol.MAX_FRAME_COUNT, constants.maxFrameCount)
  assert.equal(protocol.MAX_EXPORT_WAIT_MS, constants.maxExportWaitMs)
  assert.equal(protocol.DEFAULT_SEARCH_LIMIT, constants.defaultSearchLimit)
  assert.equal(protocol.MAX_SEARCH_LIMIT, constants.maxSearchLimit)
  assert.equal(protocol.LAUNCHER_WAIT_MS, constants.launcherWaitMs)
  assert.equal(protocol.LAUNCHER_POLL_MS, constants.launcherPollMs)

  assert.equal(launcher.LAUNCHER_CONSTANTS.socketFileName, constants.socketFileName)
  assert.equal(launcher.LAUNCHER_CONSTANTS.windowsPipePrefix, constants.windowsPipePrefix)
  assert.equal(launcher.LAUNCHER_CONSTANTS.settingsFileName, constants.settingsFileName)
  assert.equal(launcher.LAUNCHER_CONSTANTS.launcherWaitMs, constants.launcherWaitMs)
  assert.equal(launcher.LAUNCHER_CONSTANTS.launcherPollMs, constants.launcherPollMs)
  assert.equal(launcher.LAUNCHER_CONSTANTS.exitOk, constants.exitCodes.ok)
  assert.equal(launcher.LAUNCHER_CONSTANTS.exitAgentAccessOff, constants.exitCodes.agentAccessOff)
  assert.equal(launcher.LAUNCHER_CONSTANTS.exitAppUnreachable, constants.exitCodes.appUnreachable)
  assert.equal(launcher.LAUNCHER_CONSTANTS.exitSocketClosed, constants.exitCodes.socketClosed)
})

test('the per-user socket is the same path for the app and the launcher', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    assert.equal(
      protocol.socketPathFor('/tmp/droneclean-user', platform, 'example'),
      launcher.socketPathFor('/tmp/droneclean-user', platform, 'example'),
      platform,
    )
  }
  assert.equal(protocol.socketPathFor('/tmp/u', 'darwin'), '/tmp/u/mcp.sock')
  assert.equal(
    protocol.socketPathFor('/tmp/u', 'win32', 'example'),
    `${fixture.CONSTANTS.windowsPipePrefix}${launcher.pipeUserPart('example')}`,
  )
  assert.equal(
    protocol.agentAccessSettingsPath('/tmp/u'),
    '/tmp/u/agent-access.json',
  )
  assert.equal(
    protocol.agentLogPath('/tmp/u', new Date('2026-11-18T10:00:00Z')),
    '/tmp/u/agent-log/2026-11-18.jsonl',
  )
})

test('the launcher’s userData folder is Electron’s on each platform', () => {
  assert.equal(
    launcher.userDataDirFor('darwin', { HOME: '/Users/example' }, '/Users/example'),
    fixture.USER_DATA_DIR,
  )
  assert.equal(
    launcher.userDataDirFor('linux', { XDG_CONFIG_HOME: '/home/example/.config' }, '/home/example'),
    '/home/example/.config/DroneClean Studio',
  )
  assert.equal(
    launcher.userDataDirFor('win32', { APPDATA: 'C:\\Users\\example\\AppData\\Roaming' }, 'C:\\Users\\example'),
    'C:\\Users\\example\\AppData\\Roaming\\DroneClean Studio',
  )
  assert.equal(
    launcher.settingsPathFor(fixture.USER_DATA_DIR),
    `${fixture.USER_DATA_DIR}/agent-access.json`,
  )
})

test('the recorded log line is what the log builds', () => {
  const line = fixture.LOG_LINES[0]
  assert.equal(hashArguments(fixture.RUN_REQUEST.params.arguments), line.argsHash)
  assert.equal(summarizeCall('run', fixture.RUN_REQUEST.params.arguments), line.summary)
  assert.equal(hashArguments({ label: 'x', script: 'y' }), hashArguments({ script: 'y', label: 'x' }))
  assert.match(line.argsHash, /^[0-9a-f]{64}$/)
})
