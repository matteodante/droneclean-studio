/**
 * Which environment variables a launch may obey.
 *
 * `DRONECLEAN_DEV_URL` (point the window at a dev server), `DRONECLEAN_USER_DATA`
 * (move the profile) and `DRONECLEAN_FFMPEG` (run another FFmpeg) are for
 * development, the proofs and the e2e. A packaged app is started by the user's
 * system, where any process can set them: one that did could load a page of its
 * own into the app's window, read another profile, or make the app run its binary.
 * So an installed app ignores all three (review finding D5).
 */

/** The three development variables, and what the shell does with them. */
export interface LaunchEnvironment {
  /** The dev server the window loads instead of the built editor, or null. */
  readonly devUrl: string | null
  /** A profile folder to use instead of the default one, or null. */
  readonly userData: string | null
  /** Whether `DRONECLEAN_FFMPEG` may name the FFmpeg to run. */
  readonly allowFfmpegOverride: boolean
}

/** What this launch may take from `env`; a packaged app takes nothing. */
export function resolveLaunchEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  isPackaged: boolean,
): LaunchEnvironment {
  if (isPackaged) return { devUrl: null, userData: null, allowFfmpegOverride: false }
  const devUrl = env.DRONECLEAN_DEV_URL
  const userData = env.DRONECLEAN_USER_DATA
  return {
    devUrl: devUrl === undefined || devUrl === '' ? null : devUrl,
    userData: userData === undefined || userData === '' ? null : userData,
    allowFfmpegOverride: true,
  }
}
