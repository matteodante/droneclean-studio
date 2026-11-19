import test from 'node:test'
import assert from 'node:assert/strict'
import { assertThrowawayProfile, isInside } from './feature-pass/lib/profile.mjs'
import { STATUS, finalStatus, featureRow, summariseRequests, hostOf, isOwn } from './feature-pass/lib/report.mjs'

const real = '/Users/someone/Library/Application Support/DroneClean Studio'

test('the real profile is refused', () => {
  assert.throws(() => assertThrowawayProfile({ userData: real, throwawayRoot: '/tmp/work', real }), /real profile/)
  assert.throws(() => assertThrowawayProfile({ userData: `${real}/nested`, throwawayRoot: '/tmp/work', real }), /real profile/)
})

test('a profile outside the throwaway folder is refused, one inside is accepted', () => {
  assert.throws(() => assertThrowawayProfile({ userData: '/tmp/other/profile', throwawayRoot: '/tmp/work', real }), /not inside/)
  assert.throws(() => assertThrowawayProfile({ userData: '/tmp/work/../elsewhere', throwawayRoot: '/tmp/work', real }), /not inside/)
  assert.doesNotThrow(() =>
    assertThrowawayProfile({ userData: '/tmp/work/home/Library/Application Support/DroneClean Studio', throwawayRoot: '/tmp/work', real }),
  )
  assert.throws(() => assertThrowawayProfile({ userData: '', throwawayRoot: '/tmp/work', real }), /did not report/)
})

test('isInside', () => {
  assert.equal(isInside('/a/b', '/a/b/c'), true)
  assert.equal(isInside('/a/b', '/a/bc'), false)
})

test('requests: own origin is ignored, external is grouped and flagged by phase', () => {
  const summary = summariseRequests([
    { url: 'droneclean://app/projects', phase: 'open', bytes: 10 },
    { url: 'https://huggingface.co/a', phase: 'open', bytes: 100 },
    { url: 'https://huggingface.co/b', phase: 'act', bytes: 5_000_000 },
    { url: 'https://cdn.jsdelivr.net/x.wasm', phase: 'act', bytes: null },
  ])
  assert.equal(summary.external, 3)
  assert.deepEqual(summary.beforeUserAction, ['https://huggingface.co/a'])
  assert.equal(summary.hosts[0].host, 'huggingface.co')
  assert.equal(summary.hosts[0].bytes, 5_000_100)
  assert.equal(hostOf('https://x.test:8080/p'), 'x.test:8080')
  assert.equal(isOwn('blob:droneclean://app/abc'), true)
})

test('a model feature that downloads after the click is "after a download"; a plain one stays "works"', () => {
  const big = summariseRequests([{ url: 'https://huggingface.co/m', phase: 'act', bytes: 5_000_000 }])
  assert.equal(finalStatus(STATUS.works, big, { expectsDownload: true }), STATUS.afterDownload)
  assert.equal(finalStatus(STATUS.works, big), STATUS.works)
  assert.equal(finalStatus(STATUS.broken, big, { expectsDownload: true }), STATUS.broken)
})

test('the table row names requests made before the user acts', () => {
  const record = {
    name: 'Lottie',
    where: 'sidebar',
    status: STATUS.works,
    notes: '',
    requests: summariseRequests([{ url: 'https://graphql.lottiefiles.com/x', phase: 'open', bytes: 2000 }]),
    stored: { profile: [], workspace: [] },
  }
  assert.match(featureRow(record), /BEFORE the user acts/)
  assert.match(featureRow(record), /1 request\(s\) before the user acts/)
})
