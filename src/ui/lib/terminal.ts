/**
 * Terminal escape-sequence helpers.
 *
 * HiraxCode is keyboard-driven and does not handle mouse input. Some terminals
 * (or a previously-run TUI that crashed) leave *mouse reporting* enabled, so
 * every scroll/click emits an `ESC [ < Cb ; Cx ; Cy M` sequence. Ink hands the
 * tail to `useInput` as text, which is confusing and noisy. We explicitly turn
 * mouse reporting off at startup and on exit so the terminal stops sending
 * those events in the first place.
 *
 * The text-input sanitizer (see `lib/input.ts`) is the second line of defence,
 * for terminals that ignore the disable request.
 */
const MOUSE_OFF = [
  "\u001b[?1000l", // normal tracking
  "\u001b[?1002l", // button-event tracking
  "\u001b[?1003l", // any-event tracking
  "\u001b[?1005l", // UTF-8 extended tracking
  "\u001b[?1006l", // SGR extended tracking
  "\u001b[?1015l", // urxvt extended tracking
].join("");

export function disableMouseTracking(): void {
  const out = process.stdout;
  if (!out.isTTY) return;
  try {
    out.write(MOUSE_OFF);
  } catch {
    // The terminal may already be gone during shutdown; nothing to do.
  }
}
