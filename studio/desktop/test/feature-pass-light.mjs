/**
 * Feature pass 1.3, part one: the features with no or tiny downloads, in the packaged desktop app, in a throwaway
 * profile and workspace (never the real ones). See `feature-pass/README.md`.
 *
 *   scripts/heavy.sh --max-gb 6 -- node test/feature-pass-light.mjs [--only id,id] [--limit N] [--mode packaged|built] [--keep] [--list]
 */
import { runPass } from './feature-pass/lib/run.mjs'
import { lightFeatures } from './feature-pass/features-light.mjs'

process.exit(await runPass({ passName: 'light', features: lightFeatures }))
