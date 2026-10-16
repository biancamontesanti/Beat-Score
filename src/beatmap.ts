// Core rhythm constants — shared by game.ts and dancefloor.ts
export type Direction = 'left' | 'down' | 'up' | 'right' | 'upLeft' | 'upRight'

export const BPM                = 128
export const BEAT_DURATION      = 60 / BPM                          // ~0.469 s per beat
export const BEATS_PER_MEASURE  = 4
export const MEASURE_DURATION   = BEAT_DURATION * BEATS_PER_MEASURE  // ~1.875 s per measure
// One Easy sequence was removed so FINAL MOVE finishes with safe music headroom.
export const TOTAL_MEASURES     = 21
