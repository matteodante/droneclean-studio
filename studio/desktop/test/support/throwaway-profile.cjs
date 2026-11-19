/**
 * The main script of the media-path proof: the shell's own main process, in a
 * throwaway profile.
 *
 * `src/main/index.ts` puts `userData` under `<appData>/DroneClean Studio`, so
 * moving `appData` moves the whole profile — IndexedDB, localStorage, the
 * workspace handle — away from the one `npm start` uses. The proof sets
 * `DRONECLEAN_PROFILE_ROOT` to a fresh temporary folder.
 */
const { app } = require('electron')

const root = process.env.DRONECLEAN_PROFILE_ROOT
if (!root) throw new Error('DRONECLEAN_PROFILE_ROOT is not set')
app.setPath('appData', root)

require('../../out/main/index.js')
