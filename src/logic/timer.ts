export function createTimer(onTick: (sec: number) => void) {
    let handle: number | undefined;
    let sec = 0;
    const tick = () => {
      sec--;
      if (sec <= 0) {
        onTick(0);
        stop();
        return;
      }
      onTick(sec);
    };
    const start = (s: number) => {
      stop();
      sec = s;
      onTick(sec);
      handle = window.setInterval(tick, 1000);
    };
    const stop = () => {
      if (handle) {
        clearInterval(handle);
        handle = undefined;
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