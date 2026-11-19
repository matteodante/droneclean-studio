/**
 * Feature pass 1.3, part two: the features that download a model when the user starts them (about 4 GB from
 * Hugging Face, into the throwaway profile only). See `feature-pass/README.md`.
 *
 *   scripts/heavy.sh --max-gb 6 -- node test/feature-pass-models.mjs [--only id,id] [--limit N] [--mode packaged|built] [--keep] [--list]
 */
import { runPass } from './feature-pass/lib/run.mjs'
import { modelFeatures } from './feature-pass/features-models.mjs'

process.exit(await runPass({ passName: 'models', features: modelFeatures }))
