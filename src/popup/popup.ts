import { TimerState, MessageType } from "../types/timer";

// ---- Constants ----

const CIRCLE_RADIUS = 52;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS; // ~326.73

// ---- DOM References ----

const setupView = document.getElementById("setup-view") as HTMLDivElement;
const countdownView = document.getElementById(
  "countdown-view"
) as HTMLDivElement;

const inputHours = document.getElementById("input-hours") as HTMLInputElement;
const inputMinutes = document.getElementById(
  "input-minutes"
) as HTMLInputElement;
const inputSeconds = document.getElementById(
  "input-seconds"
) as HTMLInputElement;

const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;

const timeDisplay = document.getElementById("time-display") as HTMLDivElement;
const timerLabel = document.getElementById("timer-label") as HTMLDivElement;
const progressCircle = document.getElementById(
  "progress-circle"
) as unknown as SVGCircleElement;
const completionOverlay = document.getElementById(
  "completion-overlay"
) as HTMLDivElement;

const quickButtons = document.querySelectorAll<HTMLButtonElement>(".quick-btn");
const gradientStop1 = document.getElementById("gradient-stop-1") as unknown as SVGStopElement;
const gradientStop2 = document.getElementById("gradient-stop-2") as unknown as SVGStopElement;
const progressDotGroup = document.getElementById("progress-dot-group") as unknown as SVGGElement;
const progressDot = document.getElementById("progress-dot") as unknown as SVGCircleElement;

// ---- Local State ----

let currentState: TimerState | null = null;
let localTickInterval: ReturnType<typeof setInterval> | null = null;
// Local endTime mirror for smooth countdown between background ticks
let localEndTime: number | null = null;

// ---- Helpers ----

function sendMessage(message: MessageType): Promise<TimerState | null> {
  return chrome.runtime.sendMessage<MessageType, TimerState | null>(message);
}

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number): string => String(n).padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

// 시간대별 색상 팔레트
const COLOR_STAGES = [
  { threshold: 0.5, colors: ["#4f46e5", "#8b5cf6"] }, // 여유: 인디고 → 바이올렛
  { threshold: 0.2, colors: ["#f59e0b", "#f97316"] }, // 주의: 앰버 → 오렌지
  { threshold: 0,   colors: ["#ef4444", "#dc2626"] }, // 위험: 레드
] as const;

const CX = 60, CY = 60, RADIUS = 52;

function updateProgress(remaining: number, total: number): void {
  const fraction = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const offset = CIRCLE_CIRCUMFERENCE * (1 - fraction);
  progressCircle.style.strokeDashoffset = String(offset);

  // 단계 결정
  const stage = COLOR_STAGES.find((s) => fraction > s.threshold) ?? COLOR_STAGES[2];
  const dotColor = stage.colors[0];

  gradientStop1.style.stopColor = stage.colors[0];
  gradientStop2.style.stopColor = stage.colors[1];
  timeDisplay.style.color = stage === COLOR_STAGES[0] ? "" : dotColor;

  // 도트 위치: <g>의 transform으로 위치 제어 (CSS 애니메이션과 분리)
  const theta = -Math.PI / 2 + fraction * 2 * Math.PI;
  const dotX = CX + RADIUS * Math.cos(theta);
  const dotY = CY + RADIUS * Math.sin(theta);
  progressDotGroup.setAttribute("transform", `translate(${dotX}, ${dotY})`);

  // 도트 색상 + 글로우 (<circle>에만 적용)
  progressDot.setAttribute("fill", dotColor);
  progressDot.setAttribute("filter", `drop-shadow(0 0 5px ${dotColor})`);

  // 마지막 10초: 도트 깜빡임 (opacity만 — transform 충돌 없음)
  if (remaining <= 10 && remaining > 0) {
    progressDot.classList.add("dot-blink");
  } else {
    progressDot.classList.remove("dot-blink");
  }

  // fraction=0이면 도트 숨기기
  progressDotGroup.style.opacity = fraction > 0 ? "1" : "0";
}

function showSetupView(): void {
  setupView.classList.remove("hidden");
  countdownView.classList.add("hidden");
  completionOverlay.classList.add("hidden");
  stopLocalTick();
  // 색상 원복
  gradientStop1.style.stopColor = "#4f46e5";
  gradientStop2.style.stopColor = "#8b5cf6";
  timeDisplay.style.color = "";
  progressDot.classList.remove("dot-blink");
  progressDotGroup.style.opacity = "0";
}

function showCountdownView(): void {
  setupView.classList.add("hidden");
  countdownView.classList.remove("hidden");
  completionOverlay.classList.add("hidden");
}

function applyState(state: TimerState | null): void {
  currentState = state;

  if (!state || (!state.isRunning && !state.isPaused)) {
    showSetupView();
    return;
  }

  showCountdownView();

  const remaining = state.remainingSeconds;
  const total = state.totalSeconds;

  timeDisplay.textContent = formatTime(remaining);
  updateProgress(remaining, total);

  if (state.isPaused) {
    timeDisplay.classList.add("paused");
    pauseBtn.textContent = "Resume";
    pauseBtn.classList.add("resuming");
    localEndTime = null;
    stopLocalTick();
  } else {
    timeDisplay.classList.remove("paused");
    pauseBtn.textContent = "Pause";
    pauseBtn.classList.remove("resuming");
    localEndTime = state.endTime;
    startLocalTick(state);
  }
}

// ---- Local Tick (smooth visual between background updates) ----

function startLocalTick(state: TimerState): void {
  stopLocalTick();

  localTickInterval = setInterval(() => {
    if (!localEndTime || !currentState) return;

    const now = Date.now();
    const remainingMs = Math.max(0, localEndTime - now);
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    timeDisplay.textContent = formatTime(remainingSeconds);
    updateProgress(remainingSeconds, currentState.totalSeconds);

    if (remainingMs <= 0) {
      stopLocalTick();
    }
  }, 250); // Update every 250ms for smooth display
}

function stopLocalTick(): void {
  if (localTickInterval !== null) {
    clearInterval(localTickInterval);
    localTickInterval = null;
  }
}

// ---- Time Input Controls ----

interface TimeInputConfig {
  el: HTMLInputElement;
  max: number;
  prev: HTMLInputElement | null;
  next: HTMLInputElement | null;
}

const timeInputConfigs: TimeInputConfig[] = [
  { el: inputHours,   max: 99, prev: null,         next: inputMinutes },
  { el: inputMinutes, max: 59, prev: inputHours,   next: inputSeconds },
  { el: inputSeconds, max: 59, prev: inputMinutes, next: null },
];

function clampAndPad(value: string, max: number): string {
  const n = Math.min(parseInt(value, 10) || 0, max);
  return String(n).padStart(2, "0");
}

// Spin buttons (▲▼)
document.querySelectorAll<HTMLButtonElement>(".spin-btn").forEach((btn) => {
  const targetId = btn.dataset["target"]!;
  const targetEl = document.getElementById(targetId) as HTMLInputElement;
  const config = timeInputConfigs.find((c) => c.el === targetEl)!;
  const isUp = btn.classList.contains("spin-up");

  // 길게 누르면 빠르게 반복
  let repeatTimer: ReturnType<typeof setInterval> | null = null;

  const step = () => {
    const cur = parseInt(targetEl.value, 10) || 0;
    const next = isUp
      ? (cur + 1 > config.max ? 0 : cur + 1)
      : (cur - 1 < 0 ? config.max : cur - 1);
    targetEl.value = String(next).padStart(2, "0");
  };

  const stopRepeat = () => {
    if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
  };

  btn.addEventListener("mousedown", () => {
    step();
    repeatTimer = setInterval(step, 120);
    document.addEventListener("mouseup", stopRepeat, { once: true });
  });
  btn.addEventListener("mouseleave", stopRepeat);
});

timeInputConfigs.forEach(({ el, max, prev, next }) => {
  // 포커스 시 전체 선택
  el.addEventListener("focus", () => el.select());

  // 숫자만 입력 + 자동 다음 칸 이동
  el.addEventListener("input", () => {
    const raw = el.value.replace(/\D/g, "").slice(0, 2);
    el.value = raw;

    // 2자리 입력 완료 → 값 유효성 검사 후 다음 칸으로
    if (raw.length === 2) {
      const n = parseInt(raw, 10);
      if (n > max) {
        el.value = String(max).padStart(2, "0");
      }
      next?.focus();
    }
  });

  // blur 시 00 패딩
  el.addEventListener("blur", () => {
    el.value = clampAndPad(el.value, max);
  });

  // 백스페이스로 앞 칸 이동 (현재 칸이 비어있을 때)
  el.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && el.value === "" && prev) {
      e.preventDefault();
      prev.focus();
      // 앞 칸 마지막 자리 지우기
      prev.value = prev.value.slice(0, -1);
    }
    if (e.key === "ArrowLeft" && prev) {
      e.preventDefault();
      prev.focus();
    }
    if (e.key === "ArrowRight" && next) {
      e.preventDefault();
      next.focus();
    }
    if (e.key === "Enter") {
      startBtn.click();
    }
  });
});

// ---- Event Listeners ----

// Start button
startBtn.addEventListener("click", async () => {
  const h = parseInt(inputHours.value, 10) || 0;
  const m = parseInt(inputMinutes.value, 10) || 0;
  const s = parseInt(inputSeconds.value, 10) || 0;
  const totalSeconds = h * 3600 + m * 60 + s;

  if (totalSeconds <= 0) {
    inputMinutes.focus();
    return;
  }

  try {
    const state = await sendMessage({ type: "START", seconds: totalSeconds });
    applyState(state);
  } catch (err) {
    console.error("[popup] START error:", err);
  }
});

// Quick buttons
quickButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const seconds = parseInt(btn.dataset["seconds"] ?? "0", 10);
    if (seconds <= 0) return;

    try {
      const state = await sendMessage({ type: "START", seconds });
      applyState(state);
    } catch (err) {
      console.error("[popup] quick START error:", err);
    }
  });
});

// Pause / Resume button
pauseBtn.addEventListener("click", async () => {
  if (!currentState) return;

  try {
    if (currentState.isPaused) {
      const state = await sendMessage({ type: "RESUME" });
      applyState(state);
    } else {
      const state = await sendMessage({ type: "PAUSE" });
      applyState(state);
    }
  } catch (err) {
    console.error("[popup] PAUSE/RESUME error:", err);
  }
});

// Stop button
stopBtn.addEventListener("click", async () => {
  try {
    await sendMessage({ type: "STOP" });
    applyState(null);
    resetInputs();
  } catch (err) {
    console.error("[popup] STOP error:", err);
  }
});

function resetInputs(): void {
  inputHours.value = "00";
  inputMinutes.value = "00";
  inputSeconds.value = "00";
}

// ---- Background Message Listener ----

chrome.runtime.onMessage.addListener((message: MessageType) => {
  switch (message.type) {
    case "TIMER_UPDATE": {
      const state = message.state;
      currentState = state;

      if (!state.isPaused) {
        localEndTime = state.endTime;
        const remaining = state.remainingSeconds;
        const total = state.totalSeconds;
        timeDisplay.textContent = formatTime(remaining);
        updateProgress(remaining, total);
      }
      break;
    }

    case "TIMER_COMPLETE": {
      stopLocalTick();
      localEndTime = null;
      currentState = null;
      showCompletionAnimation();
      break;
    }

    default:
      break;
  }
});

// ---- Completion Animation ----

function showCompletionAnimation(): void {
  showCountdownView();
  timeDisplay.textContent = "00:00";
  updateProgress(0, 1);
  completionOverlay.classList.remove("hidden");

  // Auto-return to setup after 3 seconds
  setTimeout(() => {
    completionOverlay.classList.add("hidden");
    showSetupView();
    resetInputs();
  }, 3000);
}

// ---- Initialize on Popup Open ----

async function init(): Promise<void> {
  try {
    const state = await sendMessage({ type: "GET_STATUS" });
    applyState(state);
  } catch (err) {
    console.error("[popup] init GET_STATUS error:", err);
    showSetupView();
  }
}

init();
