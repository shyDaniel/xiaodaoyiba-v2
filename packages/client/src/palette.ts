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

/** Per-player accent color (FINAL_GOAL §C8/§C9, S-430).
 *
 *  v0..S-426 used FNV-1a(name) % 6 which routinely collided in 6-bot
 *  rooms (e.g. 'counter', 'counter#2', and 'random' all hashed onto the
 *  same red slot, leaving half the room visually indistinguishable).
 *
 *  S-430 fix: a fixed 8-color palette indexed by *join order*. The
 *  player roster (server-emitted snapshot or solo seed) registers its
 *  ordered ids via `setPlayerColorMap`; `playerColor(id)` then returns
 *  `PLAYER_PALETTE[joinOrder % 8]`. The 8 hues are spread across the
 *  hue wheel with high enough lightness contrast that any 6-pick subset
 *  satisfies CIE-Lab ΔE ≥ 25 pairwise.
 *
 *  Fallback: if an id was never registered (early call before snapshot
 *  arrived, headless tests, etc.) we hash the id into the same 8-slot
 *  palette — this is strictly better than the previous 6-slot hash and
 *  preserves determinism across reconnects. */
export const PLAYER_PALETTE: readonly number[] = [
  0x3a78c8, // azure blue
  0xe85a2a, // burnt orange
  0x38a868, // emerald green
  0xc8a838, // golden yellow
  0xa83898, // magenta purple
  0x38c8c8, // cyan teal
  0xe8408a, // hot pink
  0x6a48d8, // indigo violet
] as const;

const playerColorIndex = new Map<string, number>();

/** Register the canonical join-order for a roster of player ids.
 *  Call whenever the snapshot.players list changes (or when a solo
 *  game initializes its bot roster). Idempotent: re-registering an id
 *  with the same index is a no-op; re-registering with a new index
 *  updates the assignment so a player promoted in roster order moves
 *  to the new slot. */
export function setPlayerColorMap(ids: ReadonlyArray<string>): void {
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id === undefined) continue;
    playerColorIndex.set(id, i);
  }
}

/** Test/dev helper: clear the registry so a fresh game starts cleanly.
 *  Production code paths can ignore this — registrations naturally
 *  re-overwrite on the next snapshot. */
export function resetPlayerColorMap(): void {
  playerColorIndex.clear();
}

export function playerColor(id: string): number {
  const idx = playerColorIndex.get(id);
  if (idx !== undefined) {
    return PLAYER_PALETTE[idx % PLAYER_PALETTE.length] ?? 0xc8c8c8;
  }
  // Fallback hash — only hit for unregistered ids (pre-snapshot calls,
  // unit tests). Uses FNV-1a → 8-slot palette so the fallback range
  // matches the registered range and a transient unregistered render
  // doesn't pop off-palette.
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return PLAYER_PALETTE[h % PLAYER_PALETTE.length] ?? 0xc8c8c8;
}

/** Hex color → CSS string for React/Tailwind. */
export function toCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
