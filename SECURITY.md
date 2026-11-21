# Security policy

## Supported versions

Only the [latest release](https://github.com/matteodante/droneclean-studio/releases/latest) receives fixes.

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**.
Please do not open a public issue for it.

Say what is affected (the desktop app, the web editor at droneclean.app/studio, or the local MCP server), the version,
and the steps that show the problem. You will get an answer within a week, and a fix ships in the next release, with
credit if you want it.

## Scope worth knowing

- Agent access is on by default in the desktop app. Its MCP server listens only on this computer (a socket file that
  only your user can read, a per-user pipe on Windows), with no password: any program running as the same user can
  use it. **Settings › Agent access › Allow AI agents** switches it off.
- The app asks GitHub, once a day at most, for the number of the latest version, to show a "new version" notice. It
  can be switched off in **Settings › Privacy**. Apart from that, the editor makes no request you did not ask for:
  footage leaves the computer only when you send a piece of it to clean the shadow, and only to the DroneClean
  service. Crash reports and usage statistics are off until you say yes.
