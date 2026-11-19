/**
 * Install the page bridges of the MCP (task 2.2) on the editor page.
 *
 * `src/main.tsx` calls this once, beside `installStudio()`: `frame` finds
 * `globalThis.studioAgentFrame` (`./frame.ts`) and `export` finds
 * `globalThis.studioAgent.export` (`./export.ts`), and `media` adds the by-path
 * import to the SDK's own method (`./media.ts`). `run` and `search` need no
 * page bridge. Each install keeps a key another agent module put on the page,
 * so the order of the installs does not matter.
 */
import { installAgentExport } from './export'
import { installAgentFrame } from './frame'
import { installAgentMedia } from './media'

/**
 * Put every agent bridge on the page. It is one call so the app entry point has
 * one hook, and a later bridge is added here rather than in `src/main.tsx`.
 */
export function installAgentBridges(): void {
  installAgentMedia()
  installAgentFrame()
  installAgentExport()
}
