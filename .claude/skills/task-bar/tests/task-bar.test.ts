import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

/** What the engine would answer beneath the plugin in a session. */
function engine(on: On, model: string) {
  mock.clock(on, { now: 1_000_000 })
  on('session.start', $ => ({ cwd: '/' }))
  on('session.model', () => ({ value: model }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('agent.list', () => ({ value: [] }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine-band' }))
}

const BAND = {
  plugin: 'task-bar',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 12,
    bodyColumns: 110,
    scroll: { offset: 0, bodyRows: 11 },
    view: {},
  },
} as const

test('the bar lists main and each subagent with the Claude model it runs on', async ($, on) => {
  engine(on, 'claude-opus-5-5')
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5-20251001', agentId: 'agent-1' }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: null }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'Fix the login bug\nand add a test', turnId: 't1' })
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })
  for await (const _ of step) {
    // drain
  }
  await $.agent.spawn({
    tool_use_id: 'tu-1',
    prompt: 'Find where auth happens',
    description: 'Find auth code',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ text: /Opus 5\.5/ }))?.text).toBeDefined()
    expect((await ui.find({ text: /Haiku 4\.5/ }))?.text).toBeDefined()
    expect((await ui.find({ text: /Find auth code/ }))?.text).toBeDefined()
    expect((await ui.find({ text: /Fix the login bug/ }))?.text).toBeDefined()
    expect((await ui.find({ text: /2 running/ }))?.text).toBeDefined()
    await ui.unmount()
  }

  await $.turn.complete({
    answer: 'found it',
    durationMs: 5,
    isAborted: false,
    turnId: 'sub-1',
    agentId: 'agent-1',
    reason: 'answer',
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ text: /1 running · 1 finished/ }))?.text).toBeDefined()
  expect((await ui.find({ text: /✓/ }))?.text).toBeDefined()
  await ui.unmount()
})

test('/taskbar hide removes the bar and /taskbar list names each model', async ($, on) => {
  engine(on, 'claude-sonnet-5-5')

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const listed = await $.command.run({
    command: 'taskbar',
    args: 'list',
    origin: { kind: 'person' },
    presentation: { isFullscreen: false, columns: 100 },
  } as never)
  expect(listed.text).toMatch(/Sonnet 5\.5 \(claude-sonnet-5-5\)/)

  await $.command.run({
    command: 'taskbar',
    args: 'hide',
    origin: { kind: 'person' },
    presentation: { isFullscreen: false, columns: 100 },
  } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /Sonnet/ })).toBeUndefined()
  expect(await ui.find({ key: 'engine-band' })).toBeDefined()
  await ui.unmount()
})
