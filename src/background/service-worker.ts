import { TimerState, MessageType } from "../types/timer";
import { ALARM_NAME, STORAGE_KEY, TICK_INTERVAL } from "../utils/constants";

// ---- Storage helpers ----

async function getState(): Promise<TimerState | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as TimerState) ?? null;
}

async function setState(state: TimerState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

async function clearState(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

// ---- Alarm helpers ----

async function createAlarm(endTime: number): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { when: endTime });
}

async function clearAlarm(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME);
}

// ---- Broadcast to popup ----

function broadcastToPopup(message: MessageType): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup may be closed — ignore silently
  });
}

// ---- Tick loop (1-second interval for UI sync) ----

setInterval(async () => {
  const state = await getState();
  if (!state || !state.isRunning || state.isPaused) return;

  const now = Date.now();
  const endTime = state.endTime;
  if (endTime === null) return;

  const remainingMs = Math.max(0, endTime - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  const updatedState: TimerState = {
    ...state,
    remainingSeconds,
  };

  await setState(updatedState);
  broadcastToPopup({ type: "TIMER_UPDATE", state: updatedState });
}, TICK_INTERVAL);

// ---- Alarm handler ----

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const state = await getState();
  const finalState: TimerState = {
    isRunning: false,
    isPaused: false,
    endTime: null,
    totalSeconds: state?.totalSeconds ?? 0,
    remainingSeconds: 0,
    pausedRemainingMs: null,
  };

  await setState(finalState);

  // Notify the user
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "JS Timer",
    message: "Time is up!",
    priority: 2,
  });

  broadcastToPopup({ type: "TIMER_COMPLETE" });
});

// ---- Message handler ----

chrome.runtime.onMessage.addListener(
  (message: MessageType, _sender, sendResponse) => {
    handleMessage(message)
      .then((response) => sendResponse(response))
      .catch((err) => {
        console.error("[service-worker] message error:", err);
        sendResponse(null);
      });
    return true; // Keep message channel open for async response
  }
);

async function handleMessage(
  message: MessageType
): Promise<TimerState | null> {
  switch (message.type) {
    case "START": {
      const { seconds } = message;
      const endTime = Date.now() + seconds * 1000;

      const state: TimerState = {
        isRunning: true,
        isPaused: false,
        endTime,
        totalSeconds: seconds,
        remainingSeconds: seconds,
        pausedRemainingMs: null,
      };

      await setState(state);
      await createAlarm(endTime);
      return state;
    }

    case "STOP": {
      await clearAlarm();
      await clearState();
      return null;
    }

    case "PAUSE": {
      const state = await getState();
      if (!state || !state.isRunning || state.isPaused) return state ?? null;

      const now = Date.now();
      const pausedRemainingMs =
        state.endTime !== null ? Math.max(0, state.endTime - now) : null;

      const pausedState: TimerState = {
        ...state,
        isPaused: true,
        pausedRemainingMs,
        remainingSeconds:
          pausedRemainingMs !== null ? Math.ceil(pausedRemainingMs / 1000) : 0,
      };

      await clearAlarm();
      await setState(pausedState);
      return pausedState;
    }

    case "RESUME": {
      const state = await getState();
      if (!state || !state.isPaused || state.pausedRemainingMs === null) {
        return state ?? null;
      }

      const endTime = Date.now() + state.pausedRemainingMs;

      const resumedState: TimerState = {
        ...state,
        isRunning: true,
        isPaused: false,
        endTime,
        pausedRemainingMs: null,
        remainingSeconds: Math.ceil(state.pausedRemainingMs / 1000),
      };

      await setState(resumedState);
      await createAlarm(endTime);
      return resumedState;
    }

    case "GET_STATUS": {
      const state = await getState();

      if (!state) return null;

      // Recalculate remaining seconds for running timers
      if (state.isRunning && !state.isPaused && state.endTime !== null) {
        const now = Date.now();
        const remainingMs = Math.max(0, state.endTime - now);
        const updatedState: TimerState = {
          ...state,
          remainingSeconds: Math.ceil(remainingMs / 1000),
        };
        return updatedState;
      }

      return state;
    }

    default:
      return null;
  }
}

// ---- Side Panel: open on action icon click ----

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id !== undefined) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ---- Restore timer on startup / install ----

async function restoreTimerIfNeeded(): Promise<void> {
  const state = await getState();
  if (!state || !state.isRunning || state.isPaused) return;

  if (state.endTime === null) return;

  const now = Date.now();
  if (state.endTime <= now) {
    // Timer already expired while service worker was inactive
    const finalState: TimerState = {
      ...state,
      isRunning: false,
      remainingSeconds: 0,
      endTime: null,
    };
    await setState(finalState);

    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "JS Timer",
      message: "Time is up!",
      priority: 2,
    });
  } else {
    // Recreate alarm
    await createAlarm(state.endTime);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  restoreTimerIfNeeded();
});

chrome.runtime.onStartup.addListener(() => {
  restoreTimerIfNeeded();
});
