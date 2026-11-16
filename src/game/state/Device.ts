/** True on phones/tablets (coarse primary pointer). Add `?touch` to the URL to force it on desktop for testing. */
export const isTouchDevice: boolean = (() => {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(location.search).has('touch')) return true;
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
})();
