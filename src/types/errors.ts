export type ErrorLevel = 'error' | 'rejection' | 'console'

export interface ConsoleError {
  id: string
  level: ErrorLevel
  message: string
  stack?: string
  source?: string
  line?: number
  col?: number
  startedAt: string
  startTime: number
}
