// Transparent lettering sprites. Bounds trim only empty export padding at
// render time, preserving the original PNG and its natural letter proportions.
export const LEVEL_TITLES = {
  "easy": {
    "file": "easy",
    "width": 2172,
    "height": 724,
    "bounds": [
      268,
      77,
      1926,
      647
    ]
  },
  "intermediate": {
    "file": "intermediate",
    "width": 2172,
    "height": 724,
    "bounds": [
      45,
      186,
      2135,
      528
    ]
  },
  "reverse": {
    "file": "reverse-mode",
    "width": 2171,
    "height": 724,
    "bounds": [
      44,
      181,
      2123,
      538
    ]
  },
  "hard": {
    "file": "hard",
    "width": 2172,
    "height": 724,
    "bounds": [
      117,
      86,
      2080,
      632
    ]
  },
  "final": {
    "file": "final-move",
    "width": 2171,
    "height": 724,
    "bounds": [
      51,
      154,
      2139,
      566
    ]
  },
  "victory": {
    "file": "victory-spotlight",
    "width": 2172,
    "height": 724,
    "bounds": [
      30,
      194,
      2157,
      522
    ]
  },
  "solo": {
    "file": "solo-score",
    "width": 2172,
    "height": 724,
    "bounds": [
      44,
      152,
      2139,
      570
    ]
  }
} as const

export type LevelTitleKey = keyof typeof LEVEL_TITLES

export function getLevelTitleKey(mode: 'easy' | 'middle' | 'freestyle' | 'hard', finalMove: boolean): LevelTitleKey {
  if (finalMove) return 'final'
  return mode === 'middle' ? 'intermediate' : mode === 'freestyle' ? 'reverse' : mode
}
