// The manual Refresh button and timer use the same guard, so requests never overlap.
export function pollWhileVisible(load: () => Promise<void>, repeat: boolean | (() => boolean) = true, intervalMs = 5000) {
  let active = true;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function refresh() {
    clearTimeout(timer);
    if (!active || running || document.hidden) return;
    running = true;
    try { await load(); }
    finally {
      running = false;
      const again = typeof repeat === 'function' ? repeat() : repeat;
      if (active && again && !document.hidden) timer = setTimeout(() => void refresh(), intervalMs);
    }
  }
  function visibilityChanged() {
    clearTimeout(timer);
    if (!document.hidden) void refresh();
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  void refresh();
  return {
    refresh,
    stop() { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', visibilityChanged); },
  };
}
