/**
 * A stand-in for the `electron` module, so the main process's own modules
 * (`index.ts`, `media/frame-protocol.ts`, `protocol-handler.ts`) run under plain
 * Node in a test and record what they ask Electron to do.
 *
 * It is not a model of Electron: it keeps what was registered (handlers,
 * switches, window options, listeners) and lets a test call them. A name the
 * shell uses that is not listed here answers a recording no-op, so a new import
 * does not break every test; what a test asserts is always something it reads
 * from `state`.
 *
 * Use it before the first `require` of anything under `out/main/`.
 */
const { EventEmitter } = require('node:events')
const Module = require('node:module')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/** A webContents-like emitter with an id. */
class FakeWebContents extends EventEmitter {
  constructor(id) {
    super()
    this.id = id
    this.destroyed = false
    this.executed = []
  }
  isDestroyed() {
    return this.destroyed
  }
  destroy() {
    this.destroyed = true
    this.emit('destroyed')
  }
  send() {}
  setWindowOpenHandler() {}
  loadURL(url) {
    this.loaded = url
    return Promise.resolve()
  }
  executeJavaScript(code) {
    this.executed.push(code)
    return Promise.resolve(undefined)
  }
}

function install({ isPackaged = false, userData, productName = 'DroneClean Studio' } = {}) {
  const profile = userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-fake-electron-'))
  const state = {
    profile,
    name: productName,
    switches: [],
    paths: {},
    handles: new Map(),
    listeners: new Map(),
    protocolHandlers: new Map(),
    windows: [],
    sessionListeners: [],
    permissionRequestHandler: null,
    permissionCheckHandler: null,
    ipcOrderAtWindowCreation: null,
    loadedUrls: [],
    nextWebContentsId: 1,
  }

  const app = Object.assign(new EventEmitter(), {
    isPackaged,
    getName: () => state.name,
    setName(name) {
      state.name = name
    },
    setPath(name, value) {
      state.paths[name] = value
    },
    getPath(name) {
      return state.paths[name] ?? path.join(profile, name)
    },
    getAppPath: () => path.resolve(__dirname, '../..'),
    requestSingleInstanceLock: () => true,
    quit() {},
    whenReady: () => Promise.resolve(),
    commandLine: {
      appendSwitch(name, value) {
        state.switches.push(value === undefined ? name : `${name}=${value}`)
      },
    },
  })

  const defaultSession = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler(handler) {
      state.permissionRequestHandler = handler
    },
    setPermissionCheckHandler(handler) {
      state.permissionCheckHandler = handler
    },
    registerPreloadScript() {},
    on(event, listener) {
      state.sessionListeners.push(event)
      return EventEmitter.prototype.on.call(this, event, listener)
    },
  })

  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.webContents = new FakeWebContents(state.nextWebContentsId++)
      state.windows.push(this)
      state.ipcOrderAtWindowCreation = [...state.handles.keys()]
    }
    loadURL(url) {
      state.loadedUrls.push(url)
      return Promise.resolve()
    }
    isDestroyed() {
      return false
    }
    isMinimized() {
      return false
    }
    show() {}
    focus() {}
    restore() {}
  }

  const ipcMain = {
    handle(channel, handler) {
      state.handles.set(channel, handler)
    },
    on(channel, handler) {
      state.listeners.set(channel, handler)
    },
    removeHandler(channel) {
      state.handles.delete(channel)
    },
  }

  const protocol = {
    registerSchemesAsPrivileged() {},
    handle(scheme, handler) {
      state.protocolHandlers.set(scheme, handler)
    },
  }

  const fake = {
    app,
    BrowserWindow,
    ipcMain,
    protocol,
    session: { defaultSession },
    shell: { openExternal: () => Promise.resolve() },
  }
  const module = new Proxy(fake, {
    get(target, name) {
      if (name in target) return target[name]
      return () => undefined
    },
  })

  const hadResources = Object.hasOwn(process, 'resourcesPath')
  const savedResources = process.resourcesPath
  process.resourcesPath = path.join(profile, 'Resources')

  const originalLoad = Module._load
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return module
    return originalLoad.call(this, request, ...rest)
  }

  return {
    state,
    FakeWebContents,
    restore() {
      Module._load = originalLoad
      if (hadResources) process.resourcesPath = savedResources
      else delete process.resourcesPath
    },
  }
}

module.exports = { install, FakeWebContents }
