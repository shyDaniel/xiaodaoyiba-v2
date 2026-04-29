/**
 * Public audio surface for the rest of the client.
 *
 * Re-exports the named SFX presets (FINAL_GOAL §D1), the BGM driver with
 * lobby/battle/victory cross-fade (FINAL_GOAL §D2), and the mute toggle
 * (FINAL_GOAL §D3 — persisted to localStorage via zzfx.ts).
 */

export {
  SFX,
  play,
  type SfxName,
} from './presets.js';

export {
  startBgm,
  stopBgm,
  setVariant,
  isBgmWanted,
  getActiveVariant,
  isCrossfading,
  CROSSFADE_DURATION_MS,
  type BgmVariant,
} from './bgm.js';

export {
  isMuted,
  setMuted,
  toggleMuted,
  unlockAudio,
  onMuteChange,
} from './zzfx.js';
