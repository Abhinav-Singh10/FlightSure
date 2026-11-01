// The manual Refresh button and timer use the same guard, so requests never overlap.
export function pollWhileVisible(load: () => Promise<void>, repeat = true) {
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
      if (active && repeat && !document.hidden) timer = setTimeout(() => void refresh(), 5000);
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
