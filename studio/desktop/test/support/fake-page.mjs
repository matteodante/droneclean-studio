/**
 * Test support: the editor page and the SDK, without Electron (task 2.2).
 *
 * `run` is evaluated as a string by `webContents.executeJavaScript` in the
 * real app; here a `node:vm` context plays the page. The generated script is
 * still the one the server sends, and `globalThis.studio` is a fake that
 * follows the SDK's transaction rules closely enough to observe the undo
 * grouping: an edit inside `transaction` is folded into one entry, an edit
 * after an `await` is an entry of its own.
 */
import vm from 'node:vm'

/** The fake SDK: `transaction`, `history.depth()` and one editing action. */
export function createFakeStudio() {
  let entries = []
  const labels = []
  const studio = {
    workspace: { isOpen: () => true },
    history: {
      depth() {
        return entries.length
      },
      undoLabel() {
        return entries.length > 0 ? entries[entries.length - 1].label : null
      },
    },
    transaction(label, fn) {
      labels.push(label)
      const before = entries.slice()
      const value = fn(studio)
      const made = entries.length - before.length
      if (made > 0) {
        entries = before
        entries.push({ label })
      }
      const changes = {
        commands: made > 0 ? Array.from({ length: made }, () => ({ type: 'EDIT' })) : [],
        added: [],
        removed: [],
        updated: [],
        undoSteps: made > 0 ? 1 : 0,
      }
      if (!value || typeof value.then !== 'function') return { value, changes }
      // Like the real one: a promise's `settled` reports the whole call, so the
      // entries each awaited edit added later count too.
      const afterSynchronous = entries.length
      const finish = () => {
        const later = entries.length - afterSynchronous
        return {
          ...changes,
          commands: [...changes.commands, ...Array.from({ length: later }, () => ({ type: 'EDIT' }))],
          undoSteps: changes.undoSteps + later,
        }
      }
      return { value, changes, settled: Promise.resolve(value).then(finish, finish) }
    },
    edit() {
      entries.push({ label: 'EDIT' })
    },
    labels,
    depth() {
      return entries.length
    },
  }
  return studio
}

/** A page bridge that evaluates the server's script in a vm with `studio`. */
export function createVmPage(studio = createFakeStudio()) {
  return {
    studio,
    execute(code) {
      const sandbox = { studio, window: { studio }, setTimeout, clearTimeout, console, AbortController }
      return Promise.resolve(vm.runInNewContext(code, sandbox))
    },
  }
}

/** A `BrowserWindow`-shaped object whose `executeJavaScript` never answers. */
export function createSilentWindow() {
  return {
    isDestroyed: () => false,
    webContents: { executeJavaScript: () => new Promise(() => {}) },
  }
}
