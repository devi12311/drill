"use client";

import { ThinkingOrb, type OrbSize, type OrbState } from "thinking-orbs";

/**
 * Gold Leaf lifted toward lamplight. The one saturated mark on an otherwise
 * achromatic page — still the system's amber, so it reads as Drill rather than
 * as a new brand colour (DESIGN.md: accents are rationed, never a bright primary).
 */
export const ORB_INK = "#e6c27a";

/**
 * Drill's orb: the empty chat's hero and the live turn's status mark. Both carry
 * `data-orb`, which globals.css names for the first-send view transition, so
 * the hero visibly becomes the investigation. Decorative in both places — the
 * text beside it says what is happening — so it is hidden from assistive tech.
 */
export function DrillOrb({
  state,
  size,
  speed,
}: {
  state: OrbState;
  size: OrbSize;
  speed?: number;
}) {
  return (
    <ThinkingOrb
      data-orb
      aria-hidden
      state={state}
      size={size}
      speed={speed}
      // Pinned: Drill is dark-only, and `auto` would follow a light OS theme.
      theme="dark"
      color={ORB_INK}
    />
  );
}
