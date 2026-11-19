// The guard of design 3.6 section 2.3: outside `src/studio/`, nobody reads a clip's `stabilization`, `inputColor`,
// `look` or `motionBlur` field directly. The question "does this clip change pixels?" has one answer
// (`needsSourceStages`) and "must it be drawn from the exact source frame?" has one (`needsExactSourceFrame`); a
// file that restates either by reading the fields is the bug this test exists to catch (S1: a stabilized clip drawn
// from a DOM `<video>`).
//
// `ALLOWED` lists FreeCut's files that may still read the fields, with how many reads each has. Slice 2
// (`stage-hooks`) replaced the last reads with the predicates and emptied it; it stays empty: a read anywhere outside
// `src/studio/` fails.

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const GUARDED_FIELD = /\??\.(stabilization|inputColor|look|motionBlur)\b/g

/** The reads of a guarded field in one source file's text, comments excluded. */
export function findDirectReads(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  return [...code.matchAll(GUARDED_FIELD)].map((match) => match[0])
}

/** Files outside `src/studio/` that read a guarded field today, and how many reads each has: none since slice 2. */
const ALLOWED: Record<string, number> = {}

const SRC = path.resolve(import.meta.dirname, '../../../../src')
const ROOT = path.resolve(SRC, '..')
const isSource = (file: string) =>
  /\.[cm]?tsx?$/.test(file) && !/\.(test|spec)\.[cm]?tsx?$/.test(file) && !/\.d\.ts$/.test(file)

function sourceFilesOutsideStudio(directory: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (full === path.join(SRC, 'studio') || entry.name === 'node_modules') continue
      sourceFilesOutsideStudio(full, out)
    } else if (isSource(entry.name)) out.push(full)
  }
  return out
}

describe('findDirectReads', () => {
  it('finds property reads, optional or not', () => {
    expect(findDirectReads('if (item.stabilization?.enabled) {}')).toEqual(['.stabilization'])
    expect(findDirectReads('x.inputColor !== undefined && y?.look && z.motionBlur')).toEqual([
      '.inputColor',
      '?.look',
      '.motionBlur',
    ])
  })

  it('ignores comments, longer names and the predicates themselves', () => {
    expect(findDirectReads('// item.stabilization\n/* a.look */ const x = item.lookup')).toEqual([])
    expect(findDirectReads('needsSourceStages(item)')).toEqual([])
  })
})

describe('no direct read of a stage field outside src/studio', () => {
  const found = new Map<string, number>()
  for (const file of sourceFilesOutsideStudio(SRC)) {
    const reads = findDirectReads(fs.readFileSync(file, 'utf8')).length
    if (reads > 0) found.set(path.relative(ROOT, file).split(path.sep).join('/'), reads)
  }

  it('has no read that is not on the shrinking list', () => {
    const extra = [...found].filter(([file, count]) => count > (ALLOWED[file] ?? 0))
    expect(
      extra,
      'use needsSourceStages / needsExactSourceFrame from @/studio/render/stages/predicates',
    ).toEqual([])
  })

  it('has no stale entry on the list', () => {
    const stale = Object.entries(ALLOWED).filter(([file, count]) => (found.get(file) ?? 0) < count)
    expect(stale, 'the read is gone: lower or remove its entry').toEqual([])
  })
})
