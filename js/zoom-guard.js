// Stops accidental zoom: double-tap, pinch, and trackpad pinch (Ctrl + wheel).
// Belt and braces, because browsers differ:
//  - the viewport meta tag stops it on Android Chrome,
//  - CSS touch-action: manipulation stops double-tap zoom on modern iOS/Android,
//  - these listeners cover iOS Safari, which ignores user-scalable=no for pinch.
// Keyboard zoom (Ctrl/Cmd +/-) is left alone for accessibility, and the whole
// guard can be switched off in Settings ("Allow zoom").

const DOUBLE_TAP_MS = 350;
const INTERACTIVE = 'button, a, input, select, textarea, label, [role="slider"], [role="radio"], [tabindex]';
const VIEWPORT_LOCKED = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
const VIEWPORT_FREE = 'width=device-width, initial-scale=1, viewport-fit=cover';

let on = false;
let lastTouchEnd = 0;

function onTouchEnd(e) {
  const now = e.timeStamp || performance.now();
  const quick = now - lastTouchEnd <= DOUBLE_TAP_MS;
  lastTouchEnd = now;
  // Buttons and fields already ignore double-tap zoom via touch-action, and
  // their second tap must still count, so only swallow taps elsewhere.
  if (quick && e.cancelable && !e.target.closest?.(INTERACTIVE)) e.preventDefault();
}
const onMultiTouch = (e) => { if (e.touches && e.touches.length > 1 && e.cancelable) e.preventDefault(); };
const onGesture = (e) => e.preventDefault();                       // iOS Safari pinch
const onWheel = (e) => { if (e.ctrlKey && e.cancelable) e.preventDefault(); };   // trackpad pinch

export function setZoomLock(lock) {
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', lock ? VIEWPORT_LOCKED : VIEWPORT_FREE);
  document.documentElement.classList.toggle('zoom-locked', lock);
  if (lock === on) return;
  on = lock;
  const add = lock ? 'addEventListener' : 'removeEventListener';
  document[add]('touchend', onTouchEnd, { passive: false });
  document[add]('touchmove', onMultiTouch, { passive: false });
  document[add]('gesturestart', onGesture, { passive: false });
  document[add]('gesturechange', onGesture, { passive: false });
  document[add]('gestureend', onGesture, { passive: false });
  window[add]('wheel', onWheel, { passive: false });
}
