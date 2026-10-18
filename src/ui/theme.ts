import { mix } from "@/utils/color";

/**
 * HiraxCode colour system.
 *
 * A near-black surface (`#0a0a0a`), raised `#141414` panels, `#eeeeee` body
 * text and `#484848` hairlines. The user's accent tints the interactive
 * highlights on top of that neutral ladder.
 */
export interface Theme {
  /** The raw accent the user picked. */
  accent: string;
  /** Lighter accent for titles and highlights. */
  accentBright: string;
  /** Mid-dark accent for subtle fills. */
  accentDim: string;
  /** Deep accent, good for rails and faint glyphs. */
  accentDeep: string;
  /** Border colour for focused/active surfaces. */
  borderActive: string;
  /** Border colour for idle surfaces. */
  border: string;
  /** Very subtle border / hairline. */
  borderFaint: string;
  /** Conversation rails. */
  rail: string;
  /** Default readable text. */
  text: string;
  /** Secondary text. */
  textDim: string;
  /** Tertiary / metadata text. */
  muted: string;
  /** Warm label tone (role prompts, headings). */
  label: string;
  /** Tool-call markers (the `●` bullet, tool name). */
  tool: string;
  /** Composer prompt glyph. */
  prompt: string;
  /** Reasoning/thinking body text. */
  thinking: string;
  /** Raised surface (panels, selected code). */
  surface: string;
  /** Selected-row background in pickers. */
  activeRow: string;
  /** Status-rule foreground grey. */
  statusFg: string;
  success: string;
  danger: string;
  warning: string;
  info: string;
  /** Monospace-ish code text. */
  code: string;
  /** Filled user bubble background. */
  bubble: string;
  /** Foreground on top of a filled accent block. */
  onAccent: string;
  /** App background. */
  bg: string;
  /** Raised panel background. */
  bgRaised: string;
  /** Element background (selected rows, code blocks). */
  bgElement: string;
}

/** Base surface. */
const BG = "#0a0a0a";
/** Raised panel. */
const RAISED = "#141414";
/** Element background. */
const ELEMENT = "#1e1e1e";
/** Body text. */
const TEXT = "#eeeeee";
/** Muted text. */
const MUTED = "#808080";

export function makeTheme(accent: string): Theme {
  return {
    accent,
    accentBright: mix(accent, "#ffffff", 0.34),
    accentDim: mix(accent, BG, 0.4),
    accentDeep: mix(accent, BG, 0.66),
    borderActive: mix(accent, "#ffffff", 0.1),
    // Neutral hairlines.
    border: "#484848",
    borderFaint: "#282828",
    rail: "#3c3c3c",
    text: TEXT,
    textDim: "#b5b5b5",
    muted: MUTED,
    label: TEXT,
    tool: MUTED,
    prompt: TEXT,
    thinking: MUTED,
    surface: RAISED,
    activeRow: ELEMENT,
    statusFg: MUTED,
    success: "#7fd88f",
    danger: "#e06c75",
    warning: "#f5a742",
    info: "#56b6c2",
    code: "#cdd6e4",
    bubble: RAISED,
    onAccent: BG,
    bg: BG,
    bgRaised: RAISED,
    bgElement: ELEMENT,
  };
}
