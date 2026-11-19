import type { MediaTranscriptModel } from '@/types/storage'
import type { TranscriptionEngine } from './types'

const PARAKEET_MODEL: MediaTranscriptModel = 'parakeet-tdt-v3'

// When Parakeet cannot handle a job by design (a language outside its 25, or no WebGPU) the
// job is routed to Whisper base — the fastest Whisper tier with broad language coverage and a
// small download. This is routing decided up front, not recovery: a Parakeet run that fails to
// initialise is surfaced to the user (the dialog keeps the error and offers "Use Whisper
// instead") instead of silently re-running the download as another model.
const PARAKEET_ROUTED_WHISPER_MODEL: MediaTranscriptModel = 'whisper-base'

// Parakeet TDT 0.6B v3 covers 25 European languages (auto-detected). Anything outside this
// set — notably ja/ko/zh, which FreeCut supports — must fall back to Whisper.
export const PARAKEET_SUPPORTED_LANGUAGES: ReadonlySet<string> = new Set([
  'en',
  'es',
  'fr',
  'de',
  'bg',
  'hr',
  'cs',
  'da',
  'nl',
  'et',
  'fi',
  'el',
  'hu',
  'it',
  'lv',
  'lt',
  'mt',
  'pl',
  'pt',
  'ro',
  'sk',
  'sl',
  'sv',
  'ru',
  'uk',
])

export function isParakeetModel(model: MediaTranscriptModel | undefined): boolean {
  return model === PARAKEET_MODEL
}

function detectWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null
}

export interface ResolvedTranscriptionEngine {
  engine: TranscriptionEngine
  /** The model actually used — may differ from the requested one when falling back. */
  model: MediaTranscriptModel
  fallbackReason?: 'language' | 'no-webgpu'
}

/**
 * Decide which on-device engine runs a job. Parakeet is used when selected and viable
 * (supported language + WebGPU); otherwise the job is routed to Whisper. This never reacts to
 * a failure at run time — a failed Parakeet initialisation stays visible in the dialog, which
 * offers "Use Whisper instead". `webgpu` can be injected for testing; it defaults to runtime
 * feature detection.
 */
export function resolveTranscriptionEngine(
  model: MediaTranscriptModel,
  language: string | undefined,
  options: { webgpu?: boolean } = {},
): ResolvedTranscriptionEngine {
  if (!isParakeetModel(model)) {
    return { engine: 'whisper', model }
  }

  const normalizedLanguage = language?.trim().toLowerCase()
  if (normalizedLanguage && !PARAKEET_SUPPORTED_LANGUAGES.has(normalizedLanguage)) {
    return {
      engine: 'whisper',
      model: PARAKEET_ROUTED_WHISPER_MODEL,
      fallbackReason: 'language',
    }
  }

  const webgpu = options.webgpu ?? detectWebGpu()
  if (!webgpu) {
    return {
      engine: 'whisper',
      model: PARAKEET_ROUTED_WHISPER_MODEL,
      fallbackReason: 'no-webgpu',
    }
  }

  return { engine: 'parakeet', model }
}
