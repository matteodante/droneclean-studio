// The one way the shadow flow asks the editor to save the open project. It imports nothing: the
// editor's persistence module registers its own save function here, so the shadow code never
// imports the persistence module (that import made a cycle with the persistence module's own
// lazy import of the shadow session).

type ProjectSaver = () => Promise<void>

let saver: ProjectSaver | null = null

/** Registers how to save the open project; `null` removes it. */
export function setProjectSaver(fn: ProjectSaver | null): void {
  saver = fn
}

/** Saves the open project through the registered saver, or rejects when none is registered. */
export async function saveOpenProject(): Promise<void> {
  if (saver === null) throw new Error('The editor has not registered a way to save the project.')
  await saver()
}
