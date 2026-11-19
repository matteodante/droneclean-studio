// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { DesktopExportFile } from '../../../desktop/src/shared/bridge'
import * as shell from '../../../desktop/src/shared/export-file'
import { EXPORT_URL_SCHEME, exportBeginUrl, exportWriteUrl, type ExportFileBridge } from './wire'

/**
 * The shell's copy of the export file wire (`desktop/src/shared/export-file.ts`) against the editor's. The shell
 * is its own TypeScript project, so each side keeps what it speaks; the type assertion is the compile-time half
 * and the URL checks are the run-time half: a change on one side only fails here instead of in an export.
 */

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const sameBridge: Same<ExportFileBridge, DesktopExportFile> = true

describe('the shell and the editor describe the same export file wire', () => {
  it('has the same bridge member, at compile time', () => {
    expect(sameBridge).toBe(true)
  })

  it('has the same scheme', () => {
    expect(EXPORT_URL_SCHEME).toBe(shell.EXPORT_FILE_SCHEME)
  })

  it('builds URLs the shell reads back', () => {
    expect(shell.parseExportFileUrl(exportBeginUrl('exp-1'))).toEqual({
      ok: true,
      id: 'exp-1',
      operation: 'begin',
    })
    expect(shell.parseExportFileUrl(exportWriteUrl('exp-2', 4_194_304))).toEqual({
      ok: true,
      id: 'exp-2',
      operation: 'write',
      position: 4_194_304,
    })
  })

  it('refuses what the shell refuses', () => {
    expect(() => exportBeginUrl('a b')).toThrow('invalid export id')
    expect(() => exportWriteUrl('exp-1', -1)).toThrow('position')
    expect(shell.EXPORT_FILE_ID_PATTERN.test('a b')).toBe(false)
  })
})
