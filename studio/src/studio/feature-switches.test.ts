import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import switchesSource from './feature-switches.ts?raw'
import { FEATURE_SWITCHES, isFeatureShown, setFeatureOverride, type FeatureSwitchId } from './feature-switches'

// PLAN.md belongs to the private monorepo and is not in a published snapshot of the editor: there, the test that needs it
// is skipped (and says so in its name) instead of failing.
function findPlanFile(): string | null {
  let directory = process.cwd()
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = resolve(directory, 'PLAN.md')
    if (existsSync(candidate)) return candidate
    directory = resolve(directory, '..')
  }
  return null
}

const planFile = findPlanFile()
const ids = Object.keys(FEATURE_SWITCHES) as FeatureSwitchId[]

const SOURCE_ROOT = resolve(import.meta.dirname, '..')
const SWITCHES_FILE = resolve(import.meta.dirname, 'feature-switches.ts')

/** A test, mock or story file: it may read a switch, but that does not make the switch gate anything. */
function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /[\\/]__(tests|mocks)__[\\/]/.test(path)
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Every non-test source file under `src/`, as `[path, source without comments]`. */
function readAppSources(directory: string, out: [string, string][] = []): [string, string][] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      readAppSources(path, out)
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !isTestFile(path) && path !== SWITCHES_FILE) {
      out.push([path, stripComments(readFileSync(path, 'utf8'))])
    }
  }
  return out
}

/** The app files that read switch `id`: `isFeatureShown('id')` or `FEATURE_SWITCHES.id` / `['id']`. */
function readersOf(id: string, sources: [string, string][]): string[] {
  const readers = new RegExp(
    `isFeatureShown\\(\\s*['"\`]${id}['"\`]\\s*\\)|FEATURE_SWITCHES(?:\\.${id}\\b|\\[\\s*['"\`]${id}['"\`]\\s*\\])`,
  )
  return sources.filter(([, source]) => readers.test(source)).map(([path]) => path)
}

/** The doc comment directly above an entry, joined into one string. */
function getEntryDocComment(source: string, id: FeatureSwitchId): string | null {
  const lines = source.split('\n')
  const entryIndex = lines.findIndex((line) => line.trim().startsWith(`${id}:`))
  if (entryIndex < 0) return null

  const commentLines: string[] = []
  for (let index = entryIndex - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim()
    if (!line.startsWith('/**') && !line.startsWith('*')) break
    commentLines.unshift(line)
    if (line.startsWith('/**')) break
  }

  return commentLines.length > 0 ? commentLines.join('\n') : null
}

describe('FEATURE_SWITCHES', () => {
  it('has at least one switch', () => {
    expect(ids.length).toBeGreaterThan(0)
  })

  it('is read by app code for every switch: a switch nothing reads gates nothing', () => {
    const sources = readAppSources(SOURCE_ROOT)
    expect(sources.length, 'the scan found no source files').toBeGreaterThan(100)
    for (const id of ids) {
      expect(
        readersOf(id, sources),
        `${id} is read by no app file (tests do not count); remove it, or read it with isFeatureShown('${id}')`,
      ).not.toHaveLength(0)
    }
  })

  it('finds a reader by its call, and does not count a comment or a test file', () => {
    const sources: [string, string][] = [
      ['/app/a.ts', "const shown = isFeatureShown('alpha')"],
      ['/app/b.ts', stripComments("// isFeatureShown('beta')\n/* FEATURE_SWITCHES.beta */")],
    ]
    expect(readersOf('alpha', sources)).toEqual(['/app/a.ts'])
    expect(readersOf('beta', sources)).toEqual([])
    expect(isTestFile('/app/a.test.tsx')).toBe(true)
    expect(isTestFile('/app/a.tsx')).toBe(false)
  })

  it('names the PLAN.md task that finishes each entry', () => {
    for (const id of ids) {
      const docComment = getEntryDocComment(switchesSource, id)
      expect(docComment, `${id} has no doc comment`).not.toBeNull()

      const task = docComment?.match(/PLAN\.md task (\d+\.\d+)/)?.[1]
      expect(task, `${id} does not name a PLAN.md task`).toBeDefined()
    }
  })

  it.skipIf(planFile === null)(
    planFile === null
      ? 'finds each named task in PLAN.md (skipped: PLAN.md is not in this checkout)'
      : 'finds each named task in PLAN.md',
    () => {
      const planSource = readFileSync(planFile as string, 'utf8')
      for (const id of ids) {
        const task = getEntryDocComment(switchesSource, id)?.match(/PLAN\.md task (\d+\.\d+)/)?.[1]
        expect(planSource, `PLAN.md has no task ${task}`).toContain(`**${task} `)
      }
    },
  )
})

describe('setFeatureOverride', () => {
  it('turns a hidden switch on for a test, and gives it its own value back', () => {
    expect(isFeatureShown('motionBlur')).toBe(FEATURE_SWITCHES.motionBlur)
    setFeatureOverride('motionBlur', true)
    expect(isFeatureShown('motionBlur')).toBe(true)
    setFeatureOverride('motionBlur', undefined)
    expect(isFeatureShown('motionBlur')).toBe(FEATURE_SWITCHES.motionBlur)
  })
})
