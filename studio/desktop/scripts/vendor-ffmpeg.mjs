// Puts the app's own FFmpeg in vendor/ before packaging (`npm run package`, `npm run package:test`), on the system
// the package is for: on macOS scripts/build-ffmpeg.sh builds it from source; on Windows scripts/build-ffmpeg-win.sh
// cross-builds it inside WSL (PLAN.md task 8.1). Both stamp what they built, so a repeated run is a no-op. npm runs
// scripts through cmd.exe on Windows, which has no `sh`: this file is the one command both systems understand.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The command that builds this system's FFmpeg, or null where the app is not packaged. */
export function vendorCommand(platform) {
  if (platform === 'darwin') return { command: 'sh', args: ['scripts/build-ffmpeg.sh'] }
  // WSL starts in the Windows folder it is called from, translated to /mnt/<drive>/...
  if (platform === 'win32') return { command: 'wsl', args: ['-e', 'sh', 'scripts/build-ffmpeg-win.sh'] }
  return null
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const step = vendorCommand(process.platform)
  if (step === null) {
    console.log(`vendor-ffmpeg: no bundled FFmpeg for ${process.platform}; the app uses the one on PATH`)
  } else {
    const result = spawnSync(step.command, step.args, { cwd: desktopDir, stdio: 'inherit' })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  }
}
