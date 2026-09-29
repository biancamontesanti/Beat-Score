// One catalog for progression, HUD images, avatar labels and physical boards.
export const DANCE_RANKS = [
  { name: 'Hit Apprentice', points: 0, asset: 'hit-apprentice', labelAspect: 3, judgment: 'MISS!', judgmentScore: 0, primary: { r: 0.58, g: 0.04, b: 0.12 }, secondary: { r: 0.94, g: 0.15, b: 0.35 } },
  { name: 'Move Riser', points: 100, asset: 'move-riser', labelAspect: 3, judgment: 'GOOD!', judgmentScore: 100, primary: { r: 1, g: 0.56, b: 0.10 }, secondary: { r: 1, g: 0.76, b: 0.30 } },
  { name: 'Club Star', points: 250, asset: 'club-star', labelAspect: 3, judgment: 'COOL!', judgmentScore: 400, primary: { r: 0.76, g: 0.34, b: 1 }, secondary: { r: 0.49, g: 0.23, b: 0.85 } },
  { name: 'Step Legend', points: 500, asset: 'step-legend', labelAspect: 3, judgment: 'GREAT!', judgmentScore: 700, primary: { r: 0.34, g: 1, b: 0.54 }, secondary: { r: 0.12, g: 0.72, b: 0.52 } },
  { name: 'Dance Royalty', points: 900, asset: 'dance-royalty', labelAspect: 3, judgment: 'PERFECT!', judgmentScore: 1000, primary: { r: 0.18, g: 0.90, b: 1 }, secondary: { r: 0.10, g: 0.61, b: 0.90 } },
] as const

export function getDanceRankIndex(points: number): number {
  let index = 0
  for (let i = 1; i < DANCE_RANKS.length; i++) {
    if (points >= DANCE_RANKS[i].points) index = i
  }
  return index
}

export function getDanceRank(points: number) {
  const rank = DANCE_RANKS[getDanceRankIndex(points)]
  return {
    ...rank,
    badge: `assets/images/ui/ranks/${rank.asset}.png`,
    label: `assets/images/ui/ranks/labels/${rank.asset}-label.png`,
    confetti: [rank.primary, rank.secondary, rank.primary, { r: 1, g: 1, b: 1 }, rank.secondary],
  }
}

export const RANK_UP_DURATION = 6

export function smoothStep(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

// Shared slow entrance, gentle float and smooth exit for HUD and world badges.
export function rankUpMotion(elapsed: number) {
  const time = Math.max(0, elapsed)
  const entrance = smoothStep(time / 1.1)
  const fade = smoothStep((RANK_UP_DURATION - time) / 1.5)
  const alpha = entrance * fade
  const scale = (0.72 + 0.28 * entrance) * (0.9 + 0.1 * fade)
  return { alpha, scale: scale + Math.sin(time * 2.4) * 0.012 * alpha, rise: time * 0.07 }
}
