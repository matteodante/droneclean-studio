/**
 * The microphone's system permission (macOS), asked for by the app instead of left to a prompt the page
 * cannot see.
 *
 * Chromium's `getUserMedia` waits for macOS to answer. When the app has never asked, or the answer is
 * pending, it can wait for ever and the voice-over button just spins. The main process asks first
 * (`systemPreferences.askForMediaAccess`) and tells the page the result, so the recording can say what
 * is wrong and how to fix it.
 *
 * `preload/index.ts` writes the channel name out (a sandboxed preload cannot import this file);
 * `test/microphone.test.mjs` holds the two copies together.
 */

export const MICROPHONE_CHANNELS = {
  request: 'microphone:request',
} as const

/** `systemPreferences.getMediaAccessStatus`'s answers; `granted` on systems that have no such switch. */
export type MicrophoneAccess = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'
