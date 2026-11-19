/**
 * Prints `app.getPath('appData')` and quits, with no window and no profile data read. The feature pass runs it
 * with a moved `$HOME` before it launches the packaged app, to learn whether the packaged app (which ignores
 * `DRONECLEAN_USER_DATA`) would keep its profile inside the throwaway folder.
 */
const { app } = require('electron')
app.whenReady().then(() => {
  process.stdout.write(`APPDATA=${app.getPath('appData')}\n`)
  app.quit()
})
