import { atom, read, update } from 'claude-code'
import type {
  BoxProps,
  ElementConstructor,
  EngineInterface,
  Register,
  RenderElement,
  TextProps,
} from 'claude-code'

import type { TaskEntry, TaskStatus } from '../types'

const PANE = 'task-bar'
const MAIN = 'main'
const MAX_TASKS = 40

const tasks = atom({ plugin: 'task-bar', key: 'tasks' } as const, [])
const isHidden = atom({ plugin: 'task-bar', key: 'isHidden' } as const, false)
const now = atom({ plugin: 'task-bar', key: 'now' } as const, 0)

type Draw = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
}

const FAMILY_COLOR: Record<string, string> = {
  opus: 'magenta',
  sonnet: 'cyan',
  haiku: 'green',
  fable: 'yellow',
}

const STATUS_GLYPH: Record<TaskStatus, { glyph: string; color?: string }> = {
  running: { glyph: '●', color: 'yellow' },
  idle: { glyph: '○' },
  done: { glyph: '✓', color: 'green' },
  failed: { glyph: '✗', color: 'red' },
  stopped: { glyph: '■' },
}

/** `claude-opus-5-5` → `Opus 5.5`, `us.anthropic.claude-haiku-4-5-20251001-v1:0` → `Haiku 4.5`. */
export function modelName(id: string): { name: string; color?: string } {
  const isLong = /\[1m\]/i.test(id)
  const bare = id.toLowerCase()
  const modern = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(bare)
  const legacy = /claude-(\d+)(?:-(\d))?-(opus|sonnet|haiku)/.exec(bare)
  const family = modern?.[1] ?? legacy?.[3]
  const major = modern?.[2] ?? legacy?.[1]
  const minor = modern ? modern[3] : legacy?.[2]

  if (family === undefined || major === undefined) {
    return { name: id }
  }

  const title = family[0]!.toUpperCase() + family.slice(1)
  const version = minor === undefined ? major : `${major}.${minor}`

  return { name: `${title} ${version}${isLong ? ' 1M' : ''}`, color: FAMILY_COLOR[family] }
}

export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.slice(0, 160) ?? ''
}

function mainEntry(model: string, at: number): TaskEntry {
  return {
    id: MAIN,
    label: 'main thread',
    kind: MAIN,
    model,
    status: 'idle',
    steps: 0,
    startedAt: at,
    isBackground: false,
  }
}

/** Keeps main and the newest tasks, dropping the oldest finished ones first. */
function cap(list: TaskEntry[]): TaskEntry[] {
  let over = list.length - MAX_TASKS
  if (over <= 0) return list

  return list.filter(t => {
    if (over > 0 && t.id !== MAIN && t.status !== 'running') {
      over -= 1
      return false
    }
    return true
  })
}

function upsert(
  list: TaskEntry[],
  id: string,
  fn: (t: TaskEntry | undefined) => TaskEntry | undefined,
): TaskEntry[] {
  const at = list.findIndex(t => t.id === id)
  const next = fn(list[at])
  if (next === undefined) return list
  if (at < 0) return cap([...list, next])

  return list.map((t, i) => (i === at ? next : t))
}

function statusFromAgentList(status: string): TaskStatus | undefined {
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'killed') return 'stopped'
  return undefined
}

/** Settles tasks the engine already finished whose completion we did not see. */
async function reconcile($: EngineInterface): Promise<void> {
  const agents = await $.agent.list()
  const at = await $.clock.now()
  const settled = new Map<string, TaskStatus>()
  for (const agent of agents) {
    const status = statusFromAgentList(agent.status)
    if (status !== undefined) settled.set(agent.id, status)
  }
  await update($, tasks, list =>
    list.map(t => {
      const status = settled.get(t.id)
      return t.status === 'running' && status !== undefined
        ? { ...t, status, endedAt: at }
        : t
    }),
  )
}

/** Main first, then each task under the one that spawned it. */
function ordered(list: TaskEntry[]): { task: TaskEntry; depth: number }[] {
  const ids = new Set(list.map(t => t.id))
  const out: { task: TaskEntry; depth: number }[] = []
  const visit = (parent: string | undefined, depth: number) => {
    for (const task of list) {
      if (task.id === MAIN) continue
      const owner = task.parentId !== undefined && ids.has(task.parentId) ? task.parentId : undefined
      if (owner !== parent) continue
      out.push({ task, depth })
      visit(task.id, depth + 1)
    }
  }
  const main = list.find(t => t.id === MAIN)
  if (main) out.push({ task: main, depth: 0 })
  visit(undefined, main ? 1 : 0)

  return out
}

export function drawTasks(
  { Box, Text }: Draw,
  list: TaskEntry[],
  at: number,
  columns: number,
  maxRows: number,
  viewing?: string,
): RenderElement {
  const rows = ordered(list)
  const running = list.filter(t => t.status === 'running').length
  const finished = list.filter(t => t.status === 'done' || t.status === 'failed' || t.status === 'stopped').length
  const isWide = columns >= 72
  const room = Math.max(1, maxRows - 1)
  const shown = rows.length > room ? rows.slice(0, room - 1) : rows
  const hiddenCount = rows.length - shown.length

  const inUse = new Map<string, number>()
  for (const t of list) {
    if (t.status !== 'running') continue
    const { name } = modelName(t.model)
    inUse.set(name, (inUse.get(name) ?? 0) + 1)
  }
  const models = [...inUse].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ')

  return (
    <Box flexDirection="column" width={columns}>
      <Box key="header" flexDirection="row" width={columns}>
        <Text bold>Tasks </Text>
        <Text dimColor wrap="truncate-end">
          {running} running · {finished} finished
          {models ? ` · on ${models}` : ''}
          {isWide ? '   /taskbar hide|clear|pane' : ''}
        </Text>
      </Box>
      {shown.map(({ task, depth }) => {
        const mark = STATUS_GLYPH[task.status]
        const model = modelName(task.model)
        const isDim = task.status !== 'running' && task.status !== 'idle'
        const took = task.status === 'running' ? at - task.startedAt : (task.endedAt ?? at) - task.startedAt
        const time = task.status === 'idle' && task.steps === 0 ? '' : elapsed(took)
        const indent = depth > 0 ? `${'  '.repeat(depth - 1)}↳ ` : ''
        const isViewed = viewing !== undefined && viewing === task.id

        return (
          <Box key={`task-${task.id}`} flexDirection="row" width={columns}>
            <Box flexShrink={0}>
              <Text color={mark.color} dimColor={mark.color === undefined}>
                {indent}
                {mark.glyph}{' '}
              </Text>
            </Box>
            <Box flexShrink={0} width={isWide ? 16 : 10}>
              <Text bold={!isDim} dimColor={isDim} inverse={isViewed} wrap="truncate-end">
                {task.kind}
                {task.isBackground ? '⇢' : ''}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0} marginRight={1}>
              <Text dimColor wrap="truncate-end">{isWide ? task.label : ''}</Text>
            </Box>
            <Box flexShrink={0} width={14}>
              <Text color={model.color} bold={!isDim} dimColor={isDim} wrap="truncate-end">
                {model.name}
              </Text>
            </Box>
            {isWide && (
              <Box flexShrink={0} width={7}>
                <Text dimColor>{task.effort ?? ''}</Text>
              </Box>
            )}
            {isWide && (
              <Box flexShrink={0} width={9}>
                <Text dimColor>{task.steps > 0 ? `step ${task.steps}` : ''}</Text>
              </Box>
            )}
            <Box flexShrink={0} width={7}>
              <Text dimColor={task.status !== 'running'}>{time}</Text>
            </Box>
          </Box>
        )
      })}
      {hiddenCount > 0 && (
        <Text key="more" dimColor>
          … {hiddenCount} more (/taskbar pane)
        </Text>
      )}
    </Box>
  )
}

function summary(list: TaskEntry[], at: number): string {
  if (list.length === 0) return 'No tasks yet.'

  return ordered(list)
    .map(({ task, depth }) => {
      const took = task.status === 'running' ? at - task.startedAt : (task.endedAt ?? at) - task.startedAt
      return `${'  '.repeat(depth)}${STATUS_GLYPH[task.status].glyph} ${task.kind}: ${task.label} — ${modelName(task.model).name} (${task.model})${task.effort ? `, effort ${task.effort}` : ''}, ${task.status}, ${elapsed(took)}`
    })
    .join('\n')
}

async function tick($: EngineInterface): Promise<void> {
  const list = await read($, tasks)
  if (!list.some(t => t.status === 'running')) return
  const at = await $.clock.now()
  await update($, now, () => at)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'taskbar',
      description: 'Task bar: show, hide, clear finished tasks, open as a pane, or list tasks with their Claude models',
      argumentHint: '[show|hide|clear|pane|list]',
      immediate: true,
    })
    const model = await $.session.model()
    const at = await $.clock.now()
    await update($, tasks, list =>
      upsert(list, MAIN, t => (t === undefined ? mainEntry(model, at) : t.status === 'running' ? t : { ...t, model })),
    )
    await update($, now, () => at)
    $.clock.every(1000, () => void tick($))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const model = await $.session.model()
    const at = await $.clock.now()
    const label = firstLine(e.text) || 'main thread'
    await update($, tasks, list =>
      upsert(
        list.filter(t => t.id === MAIN || t.status === 'running'),
        MAIN,
        t => ({
          ...(t ?? mainEntry(model, at)),
          label,
          model,
          effort: undefined,
          status: 'running',
          steps: 0,
          startedAt: at,
          endedAt: undefined,
        }),
      ),
    )
    await update($, now, () => at)

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const agentId = spawned.agentId
    if (spawned.deny !== undefined || agentId === undefined) return spawned

    const at = await $.clock.now()
    const entry: TaskEntry = {
      id: agentId,
      label: firstLine(e.description) || e.subagentType,
      kind: e.fork ? 'fork' : e.subagentType,
      model: spawned.model,
      status: 'running',
      steps: 0,
      startedAt: at,
      parentId: e.parentAgentId,
      isBackground: e.background,
    }
    await update($, tasks, list => upsert(list, agentId, () => entry))

    return spawned
  })

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId ?? MAIN
    const at = await $.clock.now()
    const known = (await read($, tasks)).some(t => t.id === id)
    let fresh: TaskEntry | undefined
    if (!known) {
      const info = e.agentId === undefined ? undefined : (await $.agent.list()).find(a => a.id === e.agentId)
      fresh = {
        id,
        label: info?.description ?? (id === MAIN ? 'main thread' : 'background model call'),
        kind: info?.type ?? (id === MAIN ? MAIN : 'internal'),
        model: e.model,
        status: 'running',
        steps: 0,
        startedAt: at,
        parentId: info?.parentId,
        isBackground: id !== MAIN,
      }
    }
    const effort = e.effort === undefined ? undefined : String(e.effort)
    await update($, tasks, list =>
      upsert(list, id, t => {
        const base = t ?? fresh
        if (base === undefined) return undefined
        const isNewRun = base.status !== 'running'
        return {
          ...base,
          model: e.model,
          effort,
          status: 'running',
          steps: e.index + 1,
          startedAt: isNewRun ? at : base.startedAt,
          endedAt: undefined,
        }
      }),
    )

    const result = yield* next(e)

    const answeredBy = result.usage?.model
    const isLoopDone = !known && id !== MAIN && result.stopReason !== 'tool_use' && result.stopReason !== 'pause_turn'
    if ((answeredBy !== undefined && answeredBy !== e.model) || isLoopDone) {
      const end = await $.clock.now()
      await update($, tasks, list =>
        upsert(list, id, t =>
          t === undefined
            ? undefined
            : {
                ...t,
                model: answeredBy ?? t.model,
                ...(isLoopDone && t.kind === 'internal' ? { status: 'done' as const, endedAt: end } : {}),
              },
        ),
      )
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const at = await $.clock.now()
    const status: TaskStatus = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
    await update($, tasks, list =>
      upsert(list, id, t =>
        t === undefined ? undefined : { ...t, status, endedAt: at, model: e.usage?.model ?? t.model },
      ),
    )
    await update($, now, () => at)
    if (id === MAIN) await reconcile($)

    return next(e)
  })

  on('command.run', { command: 'taskbar' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const at = await $.clock.now()

    if (arg === 'clear') {
      await update($, tasks, list => list.filter(t => t.id === MAIN || t.status === 'running'))
      return { text: 'Task bar: cleared finished tasks.' }
    }
    if (arg === 'pane') {
      await $.ui.open({ id: PANE, title: 'Tasks' })
      return { text: 'Task bar opened in a pane.' }
    }
    if (arg === 'list') {
      await reconcile($)
      return { text: summary(await read($, tasks), at) }
    }

    const hide = arg === 'hide' ? true : arg === 'show' ? false : !(await read($, isHidden))
    await update($, isHidden, () => hide)

    return { text: hide ? 'Task bar hidden (/taskbar show brings it back).' : 'Task bar shown above the prompt.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const list = await read($, tasks)
    if (list.length === 0) return next(e)
    const at = await read($, now)
    const { Box, Text } = $.ui.resolve(e)

    return drawTasks({ Box, Text }, list, at, e.props.bodyColumns, e.props.maxRows, e.props.view.agentId)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, tasks)
    const at = await read($, now)
    const { Box, Text } = $.ui.resolve(e)
    if (list.length === 0) return <Text dimColor>No tasks yet.</Text>

    return drawTasks({ Box, Text }, list, at, e.props.bodyColumns, Math.max(4, (e.viewport?.rows ?? 24) - 2))
  })
}
