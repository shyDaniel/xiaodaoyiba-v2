// Extended palette for the Game stage. Hex numbers (PixiJS-friendly).
//
// 16 base hues plus light/dark variants, derived from the v1 palette and
// re-balanced for canvas rendering (where we don't get the chunky-pixel
// forgiveness that v1 leaned on). Each entry is documented so future
// iterations don't reach for `#888`.

export const palette = {
  // --- Sky / atmosphere ---
  skyTop: 0x1a2942,        // deep dusk
  skyMid: 0x4a5a8a,        // mid sky
  skyBottom: 0xe8a47a,     // sunset glow
  sun: 0xffd770,
  sunHalo: 0xffefa8,
  cloud: 0xf2e7d4,
  cloudShadow: 0xc8b690,

  // --- Mountains / horizon ---
  mountainFar: 0x3b4d5e,
  mountainNear: 0x2a3645,
  mountainCap: 0xeaf0f5,

  // --- Ground / road ---
  groundDark: 0x4a3520,
  groundMid: 0x6a4a2a,
  groundLight: 0x8a6a40,
  roadStripe: 0xd9b878,

  // --- Houses ---
  houseWall: 0xe8c89a,
  houseWallShadow: 0xc09870,
  houseRoof: 0xa84030,
  houseRoofShadow: 0x782028,
  houseDoor: 0x5a3018,
  houseDoorFrame: 0x3a1808,
  houseWindow: 0x80c8e0,
  houseWindowFrame: 0x6a4a2a,
  houseChimney: 0x5a3a28,
  housePlaque: 0xfff0c0,

  // --- Characters ---
  skin: 0xf4c89a,
  skinShadow: 0xc89868,
  hair: 0x281810,
  shirt1: 0x3a78c8, // blue
  shirt2: 0xc83838, // red
  shirt3: 0x38a868, // green
  shirt4: 0xc8a838, // yellow
  shirt5: 0xa83898, // purple
  shirt6: 0x38c8c8, // cyan
  pants: 0x3a3a4a,
  briefs: 0xe83040, // the iconic red briefs
  briefsShadow: 0x8a1820,

  // --- Knife ---
  knifeBlade: 0xd0d8e0,
  knifeBladeShadow: 0x808890,
  knifeEdge: 0xffffff,
  knifeHandle: 0x4a2810,

  // --- UI accents ---
  uiGold: 0xf7d774,
  uiGoldDeep: 0x6a4012,
  uiPaper: 0xf4ecd8,
  uiBattle: 0xd83828,
  uiTie: 0x707888,
  uiDodge: 0x38c8d8,
  uiPull: 0xf7d774,
  uiChop: 0xd83828,
  uiDeath: 0x8838a8,

  // --- Particles ---
  dust: 0xc8b890,
  cloth: 0xe83040,
  woodChip: 0x8a5a30,
  confetti1: 0xf7d774,
  confetti2: 0x38c8d8,
  confetti3: 0xd83828,
  confetti4: 0x38a868,
} as const;

/** Deterministic per-player accent color from a string id (FINAL_GOAL §C8/§C9). */
export function playerColor(id: string): number {
  const palette: number[] = [0x3a78c8, 0xc83838, 0x38a868, 0xc8a838, 0xa83898, 0x38c8c8];
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return palette[h % palette.length] ?? 0xc8c8c8;
}

/** Hex color → CSS string for React/Tailwind. */
export function toCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
