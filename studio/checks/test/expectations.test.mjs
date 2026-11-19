import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findUnexpectedRequests } from '../lib/expectations.mjs'

const STEPS = [
  { name: 'landing' },
  { name: 'editor', url: '/editor/1' },
  { name: 'lottie', noRequests: true },
]

test('a noRequests step that made requests is reported with their URLs', () => {
  const entries = [
    { step: 'landing', url: 'http://127.0.0.1:5123/' },
    { step: 'lottie', url: 'https://graphql.lottiefiles.com/2022-08' },
    { step: 'lottie', url: 'https://assets-v2.lottiefiles.com/a/b/c.gif' },
  ]

  assert.deepEqual(findUnexpectedRequests(STEPS, entries), [
    {
      step: 'lottie',
      count: 2,
      urls: [
        'https://graphql.lottiefiles.com/2022-08',
        'https://assets-v2.lottiefiles.com/a/b/c.gif',
      ],
    },
  ])
})

test('a noRequests step that made no request is not reported', () => {
  const entries = [{ step: 'landing', url: 'http://127.0.0.1:5123/' }]
  assert.deepEqual(findUnexpectedRequests(STEPS, entries), [])
})

test('an ordinary step may make requests', () => {
  const entries = [
    { step: 'editor', url: 'http://127.0.0.1:5123/assets/main.js' },
    { step: 'editor', url: 'http://127.0.0.1:5123/assets/font.woff2' },
  ]
  assert.deepEqual(findUnexpectedRequests(STEPS, entries), [])
})
