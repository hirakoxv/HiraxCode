/**
 * Ink's keypress parser does not understand SGR/X10 mouse reports or other
 * unknown escape sequences. It strips the leading `ESC` and hands the rest
 * (e.g. `[<65;66;31M` for a scroll-wheel tick) to `useInput` as *ordinary text*.
 * Terminals emit those on scroll/click when mouse reporting is left enabled, and
 * they used to be typed straight into the prompt — spamming the transcript with
 * control-sequence garbage.
 *
 * `sanitizeInput` scrubs such sequences (and stray control characters) out of a
 * keystroke before it is inserted into an editable field.
 */

// ESC [ < Cb ; Cx ; Cy M|m  (SGR mouse — what most modern terminals send)
const MOUSE_SGR = /\[<\d+;\d+;\d+[Mm]/g;
// ESC [ Cb ; Cx ; Cy M|m    (urxvt / rxvt mouse)
const MOUSE_URXVT = /\[\d+;\d+;\d+[Mm]/g;
// ESC [ M b x y             (X10 mouse — 3 raw bytes follow)
const MOUSE_X10 = /^\[M[\u0020-\u00ff]{3}$/;
// ESC [ 200~ / ESC [ 201~   (bracketed-paste markers)
const BRACKETED_PASTE = /\[20[01]~/g;
// A truncated SGR mouse report, e.g. `[<65;66;` when a read is split.
const MOUSE_SGR_PARTIAL = /^\[<[0-9;]*$/;
// A whitelist-ish CSI with parameters, e.g. `[1;2A`, `[?25l`.
const CSI_PARAMS = /^\[[?\d][\d;]*[A-Za-z~]$/;
// C0 control characters.
const CONTROL = /[\u0000-\u001f\u007f]/g;

export function sanitizeInput(input: string): string {
  if (!input) return "";

  // Ink already consumed the ESC that introduced the sequence, but keep this
  // robust in case a raw ESC ever arrives.
  let s = input.replace(/\u001b/g, "");

  s = s.replace(MOUSE_SGR, "");
  s = s.replace(MOUSE_URXVT, "");
  s = s.replace(BRACKETED_PASTE, "");

  if (MOUSE_X10.test(s)) return "";
  // `[<` is a strong enough signal to safely discard a split fragment.
  if (MOUSE_SGR_PARTIAL.test(s)) return "";
  if (CSI_PARAMS.test(s)) return "";

  s = s.replace(CONTROL, "");
  return s;
}

/** True when the keystroke is usable text after sanitising. */
export function isPrintableInput(input: string): boolean {
  return sanitizeInput(input).length > 0;
}
