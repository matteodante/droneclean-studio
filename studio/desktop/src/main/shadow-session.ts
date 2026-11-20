/**
 * The cloud sign-in's token and the one relay that uses it (design 4.1 section 7, slice E7;
 * review finding C8). The shared file `shared/shadow-session.ts` says what crosses the bridge.
 *
 * **Where the token lives.** In this process only: in memory, and on disk as
 * `<userData>/shadow-session.bin`, encrypted with Electron's `safeStorage` (the macOS keychain, the
 * Windows DPAPI, the Linux secret service). Without a secret store the token is kept in memory and
 * is never written; a Linux `basic_text` backend, which is not encryption, counts as no store.
 *
 * **What the page gets.** Nothing of the token. The page asks this process to make its calls to
 * the cloud, the relay attaches `Authorization: Bearer`, and the only calls it will make are the
 * ones the editor needs: `/v1/*` on the cloud's own origin, and the two routes of the device sign-in
 * (`POST /api/auth/device/code` and `…/token`). The answer to the second one carries the new token:
 * it is stored here and the page is handed a placeholder. A page, or a script in it, cannot read the
 * token, cannot send it to another host through this relay and cannot make the relay call another
 * route.
 *
 * **The keychain is touched only when the token is needed.** `status()` (which the page asks as soon as a
 * clip is selected) never reads the secret: "signed in" is read from the token file's existence, which is
 * the non-secret flag written when the sign-in is saved and removed on sign-out, on a 401 and when the file
 * turns out to be unreadable. The token is decrypted on the first `/v1/*` call or sign-out, that is, when
 * the pilot presses Follow, Clean, Sign in or Sign out. On an unsigned app macOS may ask for keychain access
 * at every update, so a pilot who never uses shadow removal must never see that question.
 *
 * **A 401** from `/v1/*` means the session is gone (Better Auth): the stored token is deleted.
 * **Sign-out** deletes it and, best effort, tells the cloud to end the session
 * (`POST /api/auth/sign-out`, Better Auth's own route, which the `bearer` plugin accepts).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ipcMain } from 'electron'
import {
  SHADOW_SESSION_CHANNELS,
  SHADOW_TOKEN_PLACEHOLDER,
  type ShadowRelayRequest,
  type ShadowRelayResponse,
  type ShadowSessionStatus,
} from '../shared/shadow-session'
import { appOnly } from './sender'

/** The cloud's origin: the website, which passes `/v1/*` and `/api/auth/*` on to the API. */
export const SHADOW_API_ORIGIN = 'https://droneclean.app'

const TOKEN_FILE = 'shadow-session.bin'

/** The most a relayed body may hold: the biggest JSON call is a job's ranges. */
const MAX_BODY_BYTES = 1024 * 1024

/** How long the best-effort sign-out waits for the cloud. */
const SIGN_OUT_TIMEOUT_MS = 5000

/** The headers of a relayed call that pass; the page's `authorization` is never one of them. */
const FORWARDED_HEADERS = new Set(['accept', 'content-type', 'x-droneclean-contract'])

const DEVICE_CODE_PATH = '/api/auth/device/code'
const DEVICE_TOKEN_PATH = '/api/auth/device/token'

/** The part of Electron's `safeStorage` this module uses. */
export interface SecretStorage {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Linux only: `basic_text` is a fixed password, not encryption. */
  getSelectedStorageBackend?(): string
}

export interface ShadowSessionOptions {
  /** The folder the encrypted token file lives in: the app's user data. */
  readonly dir: string
  readonly storage: SecretStorage
  /** The cloud's origin; the tests point it at a fake. */
  readonly origin?: string
  readonly fetch?: typeof fetch
}

/** A call the relay refuses: its text is for the developer, the page only learns that it failed. */
export class ShadowRelayError extends Error {
  constructor(message: string) {
    super(`refused: ${message}`)
    this.name = 'ShadowRelayError'
  }
}

type RelayTarget = { readonly kind: 'api' | 'device-code' | 'device-token'; readonly target: string }

export class ShadowSession {
  private readonly file: string
  private readonly origin: string
  private readonly doFetch: typeof fetch
  private token: string | null = null
  private loaded = false

  constructor(private readonly options: ShadowSessionOptions) {
    this.file = path.join(options.dir, TOKEN_FILE)
    this.origin = (options.origin ?? SHADOW_API_ORIGIN).replace(/\/+$/, '')
    this.doFetch = options.fetch ?? fetch
  }

  /** Whether the secret store can really encrypt. */
  private canEncrypt(): boolean {
    const { storage } = this.options
    if (!storage.isEncryptionAvailable()) return false
    return storage.getSelectedStorageBackend?.() !== 'basic_text'
  }

  /** The stored token, read from disk once; a file that cannot be decrypted is removed. */
  private async load(): Promise<string | null> {
    if (this.loaded) return this.token
    this.loaded = true
    if (!this.canEncrypt()) return this.token
    let encrypted: Buffer
    try {
      encrypted = await fs.readFile(this.file)
    } catch {
      return this.token
    }
    try {
      const token = this.options.storage.decryptString(encrypted)
      this.token = token.length > 0 ? token : null
    } catch {
      // Written by another user account or another keychain: it can never be read again.
      await fs.rm(this.file, { force: true })
      this.token = null
    }
    return this.token
  }

  private async store(token: string): Promise<void> {
    this.loaded = true
    this.token = token
    if (!this.canEncrypt()) return
    const temporary = `${this.file}.${process.pid}.tmp`
    await fs.mkdir(this.options.dir, { recursive: true })
    await fs.writeFile(temporary, this.options.storage.encryptString(token), { mode: 0o600 })
    await fs.rename(temporary, this.file)
  }

  private async forget(): Promise<void> {
    this.loaded = true
    this.token = null
    await fs.rm(this.file, { force: true })
  }

  /** Whether the encrypted token file is there: the flag, read without touching the secret store. */
  private async hasTokenFile(): Promise<boolean> {
    try {
      await fs.access(this.file)
      return true
    } catch {
      return false
    }
  }

  /**
   * What the page may know, without reading the secret. `persistent` is true when the token is on disk
   * (and, while signed out, assumed true: asking the secret store would touch the keychain).
   */
  async status(): Promise<ShadowSessionStatus> {
    const onDisk = await this.hasTokenFile()
    if (this.token !== null) return { signedIn: true, persistent: onDisk }
    // Once the file was read (or found unreadable) the memory is the truth; before, the file is.
    return { signedIn: !this.loaded && onDisk, persistent: true }
  }

  /** Ends the session: the token is deleted first, then the cloud is told, if it answers. */
  async signOut(): Promise<void> {
    // Signed out already: nothing to end, and no reason to read the secret.
    if (this.token === null && !(await this.hasTokenFile())) {
      await this.forget()
      return
    }
    const token = await this.load()
    await this.forget()
    if (token === null) return
    try {
      await this.doFetch(`${this.origin}/api/auth/sign-out`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}',
        redirect: 'error',
        signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS),
      })
    } catch {
      // Offline: the token is gone from this Mac either way, and the cloud ends it by age.
    }
  }

  /** Where a relayed path goes, or why it may not. */
  private route(request: ShadowRelayRequest): RelayTarget {
    const method = request.method.toUpperCase()
    if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
      throw new ShadowRelayError(`method ${request.method}`)
    }
    if (typeof request.path !== 'string' || !request.path.startsWith('/')) {
      throw new ShadowRelayError('path')
    }
    let url: URL
    try {
      url = new URL(request.path, this.origin)
    } catch {
      throw new ShadowRelayError('path')
    }
    // `new URL` resolves `..` and `%2e%2e`, so this is the path the cloud will really see.
    if (url.origin !== new URL(this.origin).origin) throw new ShadowRelayError('origin')
    const target = `${url.pathname}${url.search}`
    if (method === 'POST' && url.pathname === DEVICE_CODE_PATH && url.search === '') {
      return { kind: 'device-code', target }
    }
    if (method === 'POST' && url.pathname === DEVICE_TOKEN_PATH && url.search === '') {
      return { kind: 'device-token', target }
    }
    if (url.pathname.startsWith('/v1/')) return { kind: 'api', target }
    throw new ShadowRelayError('route')
  }

  /** The body a relayed call may carry: text, and not too much of it. */
  private checkedBody(body: unknown): string | undefined {
    if (body === undefined) return undefined
    if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new ShadowRelayError('body')
    }
    return body
  }

  /** The headers that pass, in lower case, and the token on a `/v1/*` call. */
  private async relayHeaders(
    request: ShadowRelayRequest,
    kind: RelayTarget['kind'],
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      const key = name.toLowerCase()
      if (FORWARDED_HEADERS.has(key) && typeof value === 'string') headers[key] = value
    }
    const token = kind === 'api' ? await this.load() : null
    if (token !== null) headers.authorization = `Bearer ${token}`
    return headers
  }

  /** Makes one call to the cloud for the page, with the token attached to `/v1/*`. */
  async request(request: ShadowRelayRequest): Promise<ShadowRelayResponse> {
    if (typeof request !== 'object' || request === null) throw new ShadowRelayError('request')
    const { kind, target } = this.route(request)
    const body = this.checkedBody(request.body)
    const response = await this.doFetch(`${this.origin}${target}`, {
      method: request.method.toUpperCase(),
      headers: await this.relayHeaders(request, kind),
      body,
      redirect: 'error',
    })
    let text = await response.text()
    if (kind === 'api' && response.status === 401) await this.forget()
    if (kind === 'device-token' && response.ok) text = await this.takeSignInToken(text)
    return {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
      body: text,
    }
  }

  /** Stores the token a completed sign-in answered with and hands back the same body without it. */
  private async takeSignInToken(text: string): Promise<string> {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return text
    }
    const answer = json as { access_token?: unknown }
    if (typeof answer.access_token !== 'string' || answer.access_token.length === 0) return text
    await this.store(answer.access_token)
    return JSON.stringify({ ...answer, access_token: SHADOW_TOKEN_PLACEHOLDER })
  }
}

/** Registers the three channels; each answers only the app's own frame. Called once per launch. */
export function installShadowSessionIpc(session: ShadowSession): void {
  ipcMain.handle(
    SHADOW_SESSION_CHANNELS.status,
    appOnly(() => session.status()),
  )
  ipcMain.handle(
    SHADOW_SESSION_CHANNELS.request,
    appOnly((_event: unknown, request: ShadowRelayRequest) => session.request(request)),
  )
  ipcMain.handle(
    SHADOW_SESSION_CHANNELS.signOut,
    appOnly(() => session.signOut()),
  )
}
