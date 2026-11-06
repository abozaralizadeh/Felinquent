/**
 * Made by tools/rig-all.sh, do not edit. How far a planted foot travels in one cycle of each gait,
 * in sprite pixels, so the player can advance the cycle by distance walked and the feet do not slide.
 */
export const GAIT_STRIDE: Record<string, { walk: number; trot: number; run: number }> = {
  bandit: { walk: 89.2, trot: 127.5, run: 285.3 },
  biscuit: { walk: 91.0, trot: 130.0, run: 290.9 },
  chili: { walk: 82.2, trot: 117.5, run: 262.9 },
  clover: { walk: 146.9, trot: 226.9, run: 427.2 },
  hazel: { walk: 178.8, trot: 268.2, run: 476.8 },
  inky: { walk: 103.2, trot: 147.5, run: 330.0 },
  mochi: { walk: 80.5, trot: 115.0, run: 257.3 },
  pearl: { walk: 78.7, trot: 112.5, run: 251.7 },
  tabby: { walk: 89.2, trot: 127.5, run: 285.3 },
};
