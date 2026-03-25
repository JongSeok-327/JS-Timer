export interface TimerState {
  isRunning: boolean;
  isPaused: boolean;
  endTime: number | null;           // absolute timestamp (ms)
  totalSeconds: number;              // original duration
  remainingSeconds: number;          // current remaining
  pausedRemainingMs: number | null;  // remaining ms when paused
}

export type MessageType =
  | { type: "START"; seconds: number }
  | { type: "STOP" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "GET_STATUS" }
  | { type: "TIMER_UPDATE"; state: TimerState }
  | { type: "TIMER_COMPLETE" };
