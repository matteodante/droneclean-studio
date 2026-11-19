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

- The desktop app's MCP server listens only on a local socket that only your user can read, and it is off until you
  turn on **Allow AI agents**.
- The editor makes no network request you did not ask for: footage leaves the computer only when you send a piece of
  it to clean the shadow, and only to the DroneClean service.
