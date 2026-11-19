/**
 * Settings → Agent access (task 2.2 slice 7, design §0 decisions 1 and 3).
 *
 * The one place a user meets the MCP server: a switch that starts and stops the
 * per-user socket ("Allow AI agents", off by default), the socket's path, the
 * three stdio client configurations with their real launcher path, and the last
 * calls the server logged. Nothing here carries a token or a port: v1 speaks
 * stdio only (design §0), and the launcher's file mode is the access control.
 *
 * The panel is offered only in the desktop shell (`hasAgentAccess()`), so the
 * browser build has no dead switch. Every state comes from the shell through
 * `window.dronecleanAgentAccess` (`src/studio/agent/access.ts`); a turn-on that
 * fails still answers the state, with the reason in `error`, so the switch and
 * the message come from one call.
 *
 * The log is read when the panel is opened: selecting the section mounts the
 * component, and the settings dialog unmounts it when another section is
 * chosen, so opening it again re-reads the last 50 lines.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { createLogger } from '@/shared/logging/logger'
import { cn } from '@/shared/ui/cn'
import { getAgentAccess, type AgentAccessInfo, type AgentLogLine } from '@/studio/agent/access'
import { agentAccessSnippets } from './agent-access-snippets'

const log = createLogger('AgentAccessPanel')

/** The clock time of a log line, or its raw timestamp when the field is not a date. */
function formatTime(at: string): string {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleTimeString()
}

/** A small copy control that says it copied, for two seconds. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    },
    [],
  )

  const copy = useCallback(() => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
        resetTimer.current = window.setTimeout(() => {
          setCopied(false)
          resetTimer.current = null
        }, 2000)
      })
      .catch((error: unknown) => {
        log.error('Failed to copy the Agent access configuration', error)
      })
  }, [text])

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 gap-1.5 px-2 text-xs"
      onClick={copy}
      aria-label={`${t('settings.agentAccess.copy')} ${label}`}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      {copied ? t('settings.agentAccess.copied') : t('settings.agentAccess.copy')}
    </Button>
  )
}

/** One log line: when, which tool, what it was asked, and how it ended. */
function LogLine({ line, t }: { line: AgentLogLine; t: TFunction }) {
  return (
    <li className="flex items-baseline gap-2 px-2 py-1">
      <span className="shrink-0 tabular-nums text-muted-foreground">{formatTime(line.at)}</span>
      <span className="shrink-0 font-medium">{line.tool}</span>
      <span className="min-w-0 flex-1 truncate" title={line.summary}>
        {line.summary}
      </span>
      {line.undoSteps !== undefined && line.undoSteps > 0 && (
        <span className="shrink-0 text-muted-foreground">
          {t('settings.agentAccess.undoSteps', { count: line.undoSteps })}
        </span>
      )}
      <span
        className={cn('shrink-0', line.code === 'OK' ? 'text-muted-foreground' : 'text-amber-400')}
        title={line.error}
      >
        {line.code}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {t('settings.agentAccess.duration', { ms: line.durationMs })}
      </span>
    </li>
  )
}

/** Why the switch is not simply on or off, when the shell reported a problem. */
function problemFor(info: AgentAccessInfo | null, t: TFunction): string | null {
  if (!info) return null
  if (info.error) return info.error
  if (info.status === 'conflict') return t('settings.agentAccess.conflict')
  if (info.status === 'error') return t('settings.agentAccess.error')
  return null
}

/** The switch, what it does in plain words, and why the last turn failed. */
function AccessSwitch({
  info,
  stateFailed,
  pending,
  onChange,
}: {
  info: AgentAccessInfo | null
  stateFailed: boolean
  pending: boolean
  onChange: (on: boolean) => void
}) {
  const { t } = useTranslation()
  const problem = problemFor(info, t)
  const description = stateFailed
    ? t('settings.agentAccess.stateFailed')
    : t('settings.agentAccess.description')
  const enabled = info !== null && info.enabled
  const disabled = info === null || pending

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4">
        <Label className="text-sm">{t('settings.agentAccess.enable')}</Label>
        <Switch
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onChange}
          aria-label={t('settings.agentAccess.enable')}
        />
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      {problem !== null && <p className="text-xs text-amber-400">{problem}</p>}
    </div>
  )
}

/** The socket the launcher connects to, with a copy button. */
function SocketPath({ info }: { info: AgentAccessInfo }) {
  const { t } = useTranslation()

  return (
    <>
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1">
        <code className="min-w-0 flex-1 truncate text-[11px]">{info.socketPath}</code>
        <CopyButton text={info.socketPath} label={info.socketPath} />
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.agentAccess.socketDescription')}</p>
    </>
  )
}

/** The three stdio client configurations, each paste-ready. */
function SnippetList({ launcherPath }: { launcherPath: string }) {
  const { t } = useTranslation()

  return (
    <>
      {agentAccessSnippets(launcherPath).map((snippet) => (
        <div key={snippet.id} className="space-y-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-medium">{t(snippet.titleKey)}</span>
            <CopyButton text={snippet.text} label={t(snippet.titleKey)} />
          </div>
          <p className="text-xs text-muted-foreground">{t(snippet.descriptionKey)}</p>
          <pre className="overflow-x-auto rounded-md border bg-muted/30 p-2 text-[11px] leading-relaxed">
            {snippet.text}
          </pre>
        </div>
      ))}
    </>
  )
}

/** The last calls, newest first; the panel's way to see what an agent did. */
function CallList({ lines, failed }: { lines: AgentLogLine[] | null; failed: boolean }) {
  const { t } = useTranslation()

  if (failed) return <p className="text-xs text-amber-400">{t('settings.agentAccess.logFailed')}</p>
  if (lines === null) return <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
  if (lines.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('settings.agentAccess.noCalls')}</p>
  }
  return (
    <ul className="max-h-48 divide-y overflow-y-auto rounded-md border text-[11px]">
      {[...lines].reverse().map((line, index) => (
        <LogLine key={`${line.at}-${line.argsHash}-${index}`} line={line} t={t} />
      ))}
    </ul>
  )
}

/**
 * The panel. It renders nothing outside the desktop shell; the settings dialog
 * also hides the section there, so the null is a second guard rather than the
 * way the browser is handled.
 */
export function AgentAccessPanel() {
  const { t } = useTranslation()
  const bridge = getAgentAccess()
  const [info, setInfo] = useState<AgentAccessInfo | null>(null)
  const [stateFailed, setStateFailed] = useState(false)
  const [lines, setLines] = useState<AgentLogLine[] | null>(null)
  const [logFailed, setLogFailed] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!bridge) return
    let live = true
    bridge.status().then(
      (next) => {
        if (!live) return
        setInfo(next)
        setStateFailed(false)
      },
      (error: unknown) => {
        log.error('Failed to read the Agent access state', error)
        if (live) setStateFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    let live = true
    bridge.log().then(
      (next) => {
        if (!live) return
        setLines(next)
        setLogFailed(false)
      },
      (error: unknown) => {
        log.error('Failed to read the agent log', error)
        if (live) setLogFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [bridge])

  const change = useCallback(
    async (on: boolean) => {
      if (!bridge) return
      setPending(true)
      try {
        setInfo(on ? await bridge.enable() : await bridge.disable())
      } catch (error) {
        log.error('Failed to change the Agent access setting', error)
        const message = error instanceof Error ? error.message : String(error)
        setInfo((current) => (current === null ? null : { ...current, error: message }))
      } finally {
        setPending(false)
      }
    },
    [bridge],
  )

  if (!bridge) return null

  return (
    <div className="space-y-4">
      <AccessSwitch
        info={info}
        stateFailed={stateFailed}
        pending={pending}
        onChange={(on) => {
          void change(on)
        }}
      />

      <Separator className="bg-white/8" />

      {!stateFailed && (
        <div className="space-y-1.5">
          <Label className="text-sm">{t('settings.agentAccess.socketPath')}</Label>
          {info === null ? (
            <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <SocketPath info={info} />
          )}
        </div>
      )}

      {info !== null && (
        <div className="space-y-3">
          <Label className="text-sm">{t('settings.agentAccess.snippetsTitle')}</Label>
          <SnippetList launcherPath={info.launcherPath} />
        </div>
      )}

      <Separator className="bg-white/8" />

      <div className="space-y-1.5">
        <Label className="text-sm">{t('settings.agentAccess.lastCalls')}</Label>
        <CallList lines={lines} failed={logFailed} />
      </div>
    </div>
  )
}
