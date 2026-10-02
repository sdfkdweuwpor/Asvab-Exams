export type TaskStatus = 'running' | 'idle' | 'done' | 'failed' | 'stopped'

export type TaskEntry = {
  /** `main` for the main thread, otherwise the subagent's agentId. */
  id: string
  /** What the task is: the prompt for main, the Agent call's description otherwise. */
  label: string
  /** `main`, or the subagent type (`Explore`, `general-purpose`, ...). */
  kind: string
  /** The model id the task is running on (the last one that answered, once known). */
  model: string
  effort?: string
  status: TaskStatus
  /** Model requests made so far in the task's current run. */
  steps: number
  startedAt: number
  endedAt?: number
  /** The agentId of the subagent that spawned it; absent when main did. */
  parentId?: string
  isBackground: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'task-bar': { tasks: TaskEntry[]; isHidden: boolean; now: number }
  }
}
