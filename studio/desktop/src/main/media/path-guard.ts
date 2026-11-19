/**
 * Paths that must never reach FFmpeg or the media registry (review finding D9).
 *
 * On Windows `path.isAbsolute` accepts `\\server\share\clip.mp4`, `//server/…` and
 * the device forms `\\?\…` and `\\.\…`. Opening one makes the machine authenticate
 * to a server the page chose (NTLM leak) or read a pipe. Everything that starts
 * with two separators is refused there; a local drive path (`C:\…`) is not.
 */

/** Whether `file` is a UNC, network or device path of Windows. Always false elsewhere. */
export function isUncPath(file: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' && /^[\\/]{2}/.test(file)
}

/** Throws the refusal for such a path; `what` names the caller in the message. */
export function refuseUncPath(
  file: string,
  what: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (isUncPath(file, platform)) {
    throw new Error(`${what}: a network (UNC) or device path is not allowed: ${JSON.stringify(file)}`)
  }
}
