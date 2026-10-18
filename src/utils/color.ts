export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

/** Push a colour toward its own grey (0 = unchanged, 1 = fully grey). */
export function desaturate(hex: string, amount: number): string {
  const c = hexToRgb(hex);
  const l = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return rgbToHex({
    r: c.r + (l - c.r) * amount,
    g: c.g + (l - c.g) * amount,
    b: c.b + (l - c.b) * amount,
  });
}

/** Collapse a colour to its perceptual grey. */
export function grayOf(hex: string): string {
  const c = hexToRgb(hex);
  const l = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return rgbToHex({ r: l, g: l, b: l });
}

/** Blend two hex colours and return the midpoint. */
export function blend(a: string, b: string): string {
  return mix(a, b, 0.5);
}

/** A light -> accent gradient of `steps` colours. */
export function gradient(accent: string, steps: number, from = "#ffffff", t0 = 0.62): string[] {
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = t0 + (1 - t0) * (steps === 1 ? 1 : i / (steps - 1));
    out.push(mix(accent, from, 1 - t));
  }
  return out;
}
