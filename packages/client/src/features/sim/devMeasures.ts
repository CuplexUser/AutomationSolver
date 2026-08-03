/**
 * Keeps React's development-only profiling entries from swallowing the tab.
 *
 * React's dev build emits a `performance.measure()` for **every component it
 * renders** — the DevTools "performance tracks". Measure entries are never
 * evicted from the performance timeline; nothing but `clearMeasures()` takes
 * them out. That is fine for a page that renders when the user clicks something,
 * and ruinous for this one: a running sim re-renders the whole editor twenty
 * times a second, and a ladder with a few rungs is a couple of hundred
 * `CellView`s per pass, so the timeline grows by roughly 3,000 entries a second.
 * Left alone the renderer process puts on tens of megabytes a second, keeps them
 * after Stop, and eventually takes the tab down with it.
 *
 * Production builds emit none of these, so this whole file is a no-op there.
 * The cost is that the performance tracks only hold the last couple of seconds
 * while a sim is running; stop the sim and they record normally again.
 */

/** How often the timeline is emptied while a sim runs. */
const TRIM_INTERVAL_MS = 2000;

/**
 * Starts trimming the performance timeline; returns the stop function, shaped
 * to be returned straight out of the effect that owns the scan loop.
 */
export function trimDevMeasures(): () => void {
  if (!import.meta.env.DEV || typeof performance.clearMeasures !== 'function') {
    return () => {};
  }
  const id = setInterval(() => performance.clearMeasures(), TRIM_INTERVAL_MS);
  return () => {
    clearInterval(id);
    performance.clearMeasures();
  };
}
