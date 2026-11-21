/**
 * Which links leave the app (audit of 21 Nov 2026): the rule of `main/external-links.ts`, the addresses the editor
 * really opens (read from `studio/src`), and the window-open handler of `main/index.ts`, run on the real module
 * against the stand-in `electron` (`test/support/fake-electron.cjs`).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { EXTERNAL_LINK_HOSTS, decideExternalLink, isGuideUrl } = require('../out/main/external-links.js')

const here = path.dirname(new URL(import.meta.url).pathname)

const opened = (url) => {
  const decision = decideExternalLink(url)
  assert.equal(decision.open, true, `${url} should open, got ${JSON.stringify(decision)}`)
  return decision.url
}

const refused = (url) => {
  const decision = decideExternalLink(url)
  assert.equal(decision.open, false, `${url} should be refused, got ${JSON.stringify(decision)}`)
  return decision.reason
}

test('the pages the editor links to open, as the parsed address', () => {
  assert.equal(opened('https://droneclean.app/device?code=ABCD-1234'), 'https://droneclean.app/device?code=ABCD-1234')
  assert.equal(opened('https://droneclean.app/profile?buy=1'), 'https://droneclean.app/profile?buy=1')
  assert.equal(opened('https://droneclean.app/#get-studio'), 'https://droneclean.app/#get-studio')
  assert.equal(opened('https://www.droneclean.app/'), 'https://www.droneclean.app/')
  assert.equal(opened('https://github.com/googlefonts/teko'), 'https://github.com/googlefonts/teko')
  assert.equal(opened('https://www.github.com/googlefonts/teko'), 'https://www.github.com/googlefonts/teko')
  opened('https://openfontlicense.org/open-font-license-official-text/')
  opened('https://www.apache.org/licenses/LICENSE-2.0')
  opened('https://creativecommons.org/licenses/by-nc/4.0/')
  opened('https://huggingface.co/Supertone/supertonic-3')
  opened('https://lottiefiles.com/page/license')
  // Case and the default port are the parser's business: the host compared is the normalised one.
  assert.equal(opened('HTTPS://DroneClean.APP/Profile'), 'https://droneclean.app/Profile')
  assert.equal(opened('https://droneclean.app:443/profile'), 'https://droneclean.app/profile')
})

test('look-alike hosts are refused', () => {
  for (const url of [
    'https://droneclean.app.evil.example/',
    'https://evildroneclean.app/',
    'https://droneclean-app.example/',
    'https://sub.droneclean.app/',
    'https://gist.github.com/x',
    'https://github.com.evil.example/x',
    'https://droneclean.app./', // a trailing dot is another name for the parser
    'https://drоneclean.app/', // a Cyrillic "о"
    'https://evil.example/droneclean.app',
    'https://evil.example/?u=https://droneclean.app',
    'https://evil.example#@droneclean.app',
  ]) {
    assert.match(refused(url), /is not a host the app links to/, url)
  }
})

test('a user name or password in the address is refused, whatever the host', () => {
  assert.match(refused('https://droneclean.app@evil.example/'), /user name or password/)
  assert.match(refused('https://droneclean.app:pw@evil.example/'), /user name or password/)
  assert.match(refused('https://user@droneclean.app/'), /user name or password/)
  // The backslash is a separator in an https address: this is evil.example with a path, not a user name.
  assert.match(refused('https://evil.example\\@droneclean.app/'), /evil\.example is not a host/)
})

test('anything but https on the default port is refused', () => {
  assert.match(refused('http://droneclean.app/'), /http: address/)
  assert.match(refused('javascript:alert(1)'), /javascript: address/)
  assert.match(refused('file:///etc/passwd'), /file: address/)
  assert.match(refused('droneclean://app/docs'), /droneclean: address/)
  assert.match(refused('about:blank'), /about: address/)
  assert.match(refused('data:text/html,<script>alert(1)</script>'), /data: address/)
  assert.match(refused(''), /not a valid address/)
  assert.match(refused('not a url'), /not a valid address/)
  assert.match(refused('https://droneclean.app:8443/'), /port 8443/)
  assert.match(refused('https://127.0.0.1/'), /not a host/)
  assert.match(refused('https://[::1]/'), /not a host/)
})

test('a refusal names the host at most, never the path or the query', () => {
  const reason = refused('https://evil.example/secret/path?token=abc123')
  assert.equal(reason.includes('secret'), false)
  assert.equal(reason.includes('abc123'), false)
})

test('every https address the editor opens in a new window is on the list', () => {
  // The files that hold those addresses (search for `window.open` and `target="_blank"` in studio/src, 21 Nov 2026).
  // The Licenses page renders `font-licenses.ts`; the cloud's sign-in page comes from the API (`droneclean.app/device`).
  const sources = [
    'studio/licenses/font-licenses.ts',
    'studio/licenses/licenses-page.tsx',
    'studio/licenses/model-license-notice.tsx',
    'features/lottie-browser/components/lottie-browser-panel.tsx',
    'studio/shadow/ui/use-shadow-session.ts',
    'studio/shadow/cloud-defaults.ts',
    'studio/shadow/install-desktop.ts',
    'studio/web/desktop-app-notice.tsx',
  ]
  const found = new Set()
  for (const source of sources) {
    const text = fs.readFileSync(path.resolve(here, '../../src', source), 'utf8')
    for (const [url] of text.matchAll(/https:\/\/[^\s'"`)|<>]+/g)) found.add(url)
  }
  assert.ok(found.size > 50, `found ${found.size} addresses`)
  const refusedLinks = [...found].filter((url) => !decideExternalLink(url).open)
  assert.deepEqual(refusedLinks, [], 'add the host to EXTERNAL_LINK_HOSTS with the place that links to it')
  // And no host is on the list for nothing.
  const hosts = new Set([...found].map((url) => new URL(url).hostname))
  for (const host of EXTERNAL_LINK_HOSTS) assert.ok(hosts.has(host) || host === 'www.droneclean.app', `${host} is used`)
})

test('the window-open handler opens only allowed links, in the system browser, and never a window', async () => {
  const { install, FakeWebContents } = require('./support/fake-electron.cjs')
  const fake = install({ isPackaged: true })
  const savedSetter = FakeWebContents.prototype.setWindowOpenHandler
  FakeWebContents.prototype.setWindowOpenHandler = function record(handler) {
    this.windowOpenHandler = handler
  }
  const openedExternally = []
  const warnings = []
  const savedWarn = console.warn
  try {
    require('electron').shell.openExternal = (url) => {
      openedExternally.push(url)
      return Promise.resolve()
    }
    console.warn = (message) => warnings.push(String(message))
    require('../out/main/index.js')
    await new Promise((resolve) => setTimeout(resolve, 150))
    const handler = fake.state.windows[0]?.webContents.windowOpenHandler
    assert.equal(typeof handler, 'function', 'the window has a window-open handler')

    for (const url of [
      'https://droneclean.app/profile?buy=1',
      'https://evil.example/',
      'https://droneclean.app@evil.example/',
      'about:blank',
      'droneclean://app/docs',
    ]) {
      assert.deepEqual(handler({ url }), { action: 'deny' }, url)
    }
    assert.deepEqual(openedExternally, ['https://droneclean.app/profile?buy=1'])
    // The toolbar's user guide opens in the app's own window, not refused and not in the browser.
    assert.equal(fake.state.loadedUrls.at(-1), 'droneclean://app/docs')
    const refusals = warnings.filter((line) => line.startsWith('[desktop] a link was not opened'))
    assert.equal(refusals.length, 3, JSON.stringify(warnings))
  } finally {
    console.warn = savedWarn
    FakeWebContents.prototype.setWindowOpenHandler = savedSetter
    fake.restore()
  }
})

test('the user guide opens in the app window, nothing else of the app does', () => {
  assert.equal(isGuideUrl('droneclean://app/docs', null), true)
  assert.equal(isGuideUrl('droneclean://app/docs/workspaces', null), true)
  assert.equal(isGuideUrl('droneclean://app/docsx', null), false)
  assert.equal(isGuideUrl('droneclean://app/projects', null), false)
  assert.equal(isGuideUrl('droneclean://other/docs', null), false)
  assert.equal(isGuideUrl('https://droneclean.app/docs', null), false)
  assert.equal(isGuideUrl('', null), false)
  assert.equal(isGuideUrl('http://localhost:5173/docs', 'http://localhost:5173'), true)
})
