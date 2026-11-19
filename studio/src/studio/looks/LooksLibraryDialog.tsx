/**
 * The looks library dialog (design 5.1 §4.4, §6 slice 5.2b): the user's `.cube` files in the
 * workspace, added through the file picker or a drop, renamed, re-read in the other row order and
 * removed.
 *
 * A removal that clips use asks first and says how many: the clip keeps its look id, so a removed
 * look leaves those clips without a look (the picker shows "Look not in the library") rather than
 * silently editing the project. The library itself is not timeline history — none of these
 * actions is an undo step.
 *
 * The import rules are `import-cube.ts`'s: 65 points per side at most, `LUT_*_INPUT_RANGE` other
 * than 0…1 refused instead of silently misread, and the failures shown in plain words.
 */

import { useEffect, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUp, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CUBE_MAX_SIZE, type CubeEntryOrder } from '@/studio/color/cube'
import { countClipsUsingLook } from './usage'
import { useLooksStore, type LooksFailure } from './store'
import type { LookEntry } from './types'

/** One line of the failure, in the user's language and words a pilot understands. */
function LookFailureMessage({ failure }: { failure: LooksFailure }) {
  const { t } = useTranslation()
  switch (failure.code) {
    case 'range':
      return <>{t('presets.looks.error.range', { min: failure.min, max: failure.max })}</>
    case 'too-large':
      return <>{t('presets.looks.error.tooLarge', { size: failure.size, max: CUBE_MAX_SIZE })}</>
    case 'no-grid':
      return <>{t('presets.looks.error.noGrid')}</>
    case 'invalid':
      return <>{t('presets.looks.error.invalid', { detail: failure.detail })}</>
    case 'read':
      return <>{t('presets.looks.error.read')}</>
    case 'store':
      return <>{t('presets.looks.error.store')}</>
    case 'unavailable':
      return <>{t('presets.looks.error.unavailable')}</>
  }
}

/** The other row order, for the retry a blue-fastest file needs. */
function otherOrder(order: CubeEntryOrder): CubeEntryOrder {
  return order === 'red-fastest' ? 'blue-fastest' : 'red-fastest'
}

/** The library's list of looks, and the dialog's frame. */
export function LooksLibraryDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const looks = useLooksStore((state) => state.looks)
  const failure = useLooksStore((state) => state.error)
  const load = useLooksStore((state) => state.load)
  const add = useLooksStore((state) => state.add)
  const rename = useLooksStore((state) => state.rename)
  const remove = useLooksStore((state) => state.remove)
  const setEntryOrder = useLooksStore((state) => state.setEntryOrder)
  const report = useLooksStore((state) => state.report)

  const [renaming, setRenaming] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [removal, setRemoval] = useState<{ entry: LookEntry; count: number } | null>(null)

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // A closed dialog does not keep a half-typed name, a pending removal or an old error.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setRenaming(null)
      setRemoval(null)
      report(null)
    }
    onOpenChange(next)
  }

  const importText = async (fileName: string, text: Promise<string>) => {
    let content: string
    try {
      content = await text
    } catch {
      report({ code: 'read' })
      return
    }
    await add({ text: content, fileName })
  }

  const pickFile = async () => {
    if (typeof window.showOpenFilePicker !== 'function') {
      report({ code: 'unavailable' })
      return
    }
    let handles: FileSystemFileHandle[]
    try {
      handles = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: '3D LUT', accept: { 'application/octet-stream': ['.cube'] } }],
      })
    } catch {
      return // the user cancelled the picker
    }
    const handle = handles[0]
    if (handle === undefined) return
    await importText(
      handle.name,
      handle.getFile().then((file) => file.text()),
    )
  }

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const files = [...event.dataTransfer.files]
    void (async () => {
      for (const file of files) await importText(file.name, file.text())
    })()
  }

  const startRename = (entry: LookEntry) => {
    setRenaming(entry.id)
    setDraftName(entry.name)
  }

  const commitRename = async () => {
    if (renaming === null) return
    if (await rename(renaming, draftName)) setRenaming(null)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="looks-library-dialog"
        className="max-w-md"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t('presets.looks.title')}</DialogTitle>
        </DialogHeader>

        <div
          className="min-h-24 max-h-72 overflow-y-auto rounded-md border border-dashed border-input p-2 space-y-1"
          onDragOver={(event) => event.preventDefault()}
          onDrop={dropFiles}
          data-testid="looks-drop-zone"
        >
          {looks.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">{t('presets.looks.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {looks.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-1 min-w-0"
                  data-testid="look-row"
                  data-look-id={entry.id}
                >
                  {renaming === entry.id ? (
                    <Input
                      autoFocus
                      className="h-7 text-xs flex-1 min-w-0"
                      aria-label={t('presets.looks.rename')}
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={() => void commitRename()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void commitRename()
                        if (event.key === 'Escape') setRenaming(null)
                      }}
                      data-testid="look-rename-input"
                    />
                  ) : (
                    <span className="flex-1 min-w-0 truncate text-xs" title={entry.fileName}>
                      {entry.name}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        {entry.size}³
                        {entry.entryOrder === 'blue-fastest'
                          ? ` · ${t('presets.looks.blueFirst')}`
                          : ''}
                      </span>
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={t('presets.looks.rename')}
                    title={t('presets.looks.rename')}
                    onClick={() => startRename(entry)}
                    disabled={renaming === entry.id}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={t('presets.looks.rowOrder')}
                    title={t('presets.looks.rowOrder')}
                    onClick={() => void setEntryOrder(entry.id, otherOrder(entry.entryOrder))}
                    data-testid="look-row-order"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={t('presets.looks.remove')}
                    title={t('presets.looks.remove')}
                    onClick={() => setRemoval({ entry, count: countClipsUsingLook(entry.id) })}
                    data-testid="look-remove"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {failure !== null && (
          <p role="alert" className="text-[11px] text-destructive" data-testid="looks-error">
            <LookFailureMessage failure={failure} />
          </p>
        )}

        {removal !== null && (
          <div
            role="alertdialog"
            aria-label={t('presets.looks.remove')}
            className="space-y-2 rounded-md border border-input p-2"
            data-testid="look-remove-confirm"
          >
            <p className="text-xs">
              {removal.count > 0
                ? t('presets.looks.removeUsed', { count: removal.count })
                : t('presets.looks.removeConfirm', { name: removal.entry.name })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => setRemoval(null)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 px-2"
                onClick={() => {
                  void remove(removal.entry.id).then((removed) => {
                    if (removed) setRemoval(null)
                  })
                }}
                data-testid="look-remove-confirm-button"
              >
                {t('presets.looks.remove')}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2 gap-1.5"
            onClick={() => void pickFile()}
            data-testid="look-add"
          >
            <FileUp className="h-3 w-3" />
            {t('presets.looks.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
