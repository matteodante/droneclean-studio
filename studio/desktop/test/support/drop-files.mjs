// Drag and drop of real disk files onto the page, shared by the desktop proof scripts.

/** Chromium's drag-and-drop with real files from the disk (Playwright has no API for a file payload). */
export async function dropFiles(page, x, y, files) {
  const client = await page.context().newCDPSession(page)
  const data = { items: [], files, dragOperationsMask: 1 }
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await client.send('Input.dispatchDragEvent', { type, x, y, data })
    }
  } finally {
    await client.detach()
  }
}

/** Installs a drop target with a known id and keeps the first drop on it in `window[windowKey]`. */
export async function installDropProbe(page, id, windowKey) {
  await page.evaluate(
    ({ elementId, key }) => {
      document.getElementById(elementId)?.remove()
      const div = document.createElement('div')
      div.id = elementId
      div.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px;z-index:2147483647'
      document.body.appendChild(div)
      window[key] = null
      div.addEventListener('dragover', (event) => event.preventDefault())
      div.addEventListener('drop', async (event) => {
        event.preventDefault()
        // Read the file list before awaiting: the DataTransfer is emptied once the handler yields.
        const file = event.dataTransfer.files[0] ?? null
        const item = event.dataTransfer.items[0]
        const handle = item ? await item.getAsFileSystemHandle() : null
        window[key] = { file, handle }
      })
    },
    { elementId: id, key: windowKey },
  )
}

/**
 * Seeds the workspace records the folder picker would have written, from a folder dropped on the page.
 * Returns the folder's name as the page saw it.
 */
export async function seedWorkspaceFromDrop(page, { workspaceDir, probeId, windowKey, workspaceId, timeout }) {
  await installDropProbe(page, probeId, windowKey)
  await dropFiles(page, 50, 50, [workspaceDir])
  await page.waitForFunction((key) => window[key] !== null, windowKey, { timeout })
  return page.evaluate(
    async ({ elementId, key, id }) => {
      const handle = window[key].handle
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('freecut-handles-db', 1)
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore('handles', { keyPath: 'key' })
          store.createIndex('kind', 'kind', { unique: false })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const write = (record) =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction('handles', 'readwrite')
          transaction.objectStore('handles').put(record)
          transaction.oncomplete = resolve
          transaction.onerror = () => reject(transaction.error)
        })
      const now = Date.now()
      await write({ key: `workspace:${id}`, kind: 'workspace', id, handle, name: handle.name, pickedAt: now })
      await write({
        key: 'workspace:current',
        kind: 'workspace',
        id: 'current',
        handle,
        name: handle.name,
        pickedAt: now,
        activeWorkspaceId: id,
      })
      document.getElementById(elementId)?.remove()
      return handle.name
    },
    { elementId: probeId, key: windowKey, id: workspaceId },
  )
}
