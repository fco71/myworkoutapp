export function getRemainingSeconds(endAtMs: number, nowMs = Date.now()) {
  return Math.max(0, Math.ceil((endAtMs - nowMs) / 1000));
}

export function createTimer(onTick: (sec: number) => void) {
  let handle: number | undefined;
  let endAtMs: number | undefined;

  const stop = () => {
    if (handle !== undefined) {
      window.clearInterval(handle);
      handle = undefined;
    }
    endAtMs = undefined;
  };

  const tick = () => {
    if (endAtMs === undefined) return;

    const remainingSec = getRemainingSeconds(endAtMs);
    onTick(remainingSec);

    if (remainingSec === 0) {
      stop();
    }
  };

  const start = (seconds: number) => {
    stop();
    const durationSec = Math.max(0, Math.floor(seconds));
    endAtMs = Date.now() + durationSec * 1000;
    onTick(durationSec);

    if (durationSec > 0) {
      handle = window.setInterval(tick, 1000);
    }
  };

  return { start, stop };
}

export function formatMMSS(n: number) {
  const m = Math.floor(n / 60)
    .toString()
    .padStart(2, "0");
  const s = (n % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
