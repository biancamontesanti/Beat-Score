import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { AudioSource, engine, InputAction, UiCanvasInformation } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { getPlayer } from '@dcl/sdk/players'
import {
  arrowInputFeedback,
  cancelMultiplayerReady,
  gameState,
  getSpaceWindow,
  isSoloTransitionPending,
  JUDGMENT_CENTER,
  mobileTapFeedback,
  joinMultiplayerMatch,
  rankUpPopup,
  resultsPresentation,
  isRankPopupBlockingResults,
  closeResults,
  dispatchUiAction,
  openLeaderboardMenu,
  openPlayMenu,
  readyForMultiplayer,
  requestMobileHit,
  requestJumpOff,
  returnToLobby,
  startSoloMode,
  type JudgmentText,
  type MatchPlayer,
  watchLiveMode,
} from './game'
import { Direction, TOTAL_MEASURES } from './beatmap'
import { DANCE_RANKS, getDanceRank, getDanceRankIndex, RANK_UP_DURATION, rankUpMotion, smoothStep } from './ranks'
import { LEVEL_TITLES, getLevelTitleKey, type LevelTitleKey } from './levelTitles'

// ──────────────────────────────────────────────────────────
// Per-direction style maps
// ──────────────────────────────────────────────────────────
const DIR_COLOR: Record<Direction, Color4> = {
  left: Color4.create(1.00, 0.400, 0.851, 1),
  down: Color4.create(0.482, 0.380, 1.00, 1),
  up: Color4.create(0.00, 0.831, 1.00, 1),
  right: Color4.create(0.188, 0.890, 0.420, 1),
  upLeft: Color4.create(0.482, 0.380, 1.00, 1),
  upRight: Color4.create(0.00, 0.831, 1.00, 1),
}
const REVERSE_COLOR = Color4.create(1.00, 0.125, 0.259, 1)
const HIT_COLOR = Color4.create(1.00, 0.722, 0.00, 1)

const DIR_SYMBOL: Record<Direction, string> = {
  left:  '◀',
  down:  '▼',
  up:    '▲',
  right: '▶',
  upLeft: '↖',
  upRight: '↗',
}

const CARDINAL_ARROW_TEXTURE: Record<string, string> = {
  '◀': 'assets/images/ui/arrow-left.png',
  '▶': 'assets/images/ui/arrow-right.png',
  '▲': 'assets/images/ui/arrow-up.png',
  '▼': 'assets/images/ui/arrow-down.png',
}

const DIR_KEY: Record<Direction, string> = {
  left: '←', down: '↓', up: '↑', right: '→', upLeft: 'Q/1', upRight: 'E',
}

type PercentUnit = `${number}%`

const BEAT_SCORE_LOGO = 'assets/images/beatscore-v3.png'
const BEAT_SCORE_LOGO_ASPECT = 3308 / 1902
const MENU_TITLE_ASPECT = 2172 / 724
const PUBLIC_MATCH_TITLE = 'assets/images/ui/levels/public-match.png'
const SOLO_STAGE_TITLE = 'assets/images/ui/levels/solo-stage.png'
const POINTS_TITLE = 'assets/images/ui/levels/points.png'
const JUMP_OFF_TITLE = 'assets/images/ui/levels/jump-off.png'
const DAILY_GOALS_TITLE = 'assets/images/ui/levels/daily-goals-bw.png'
const DAILY_GOALS_TITLE_ASPECT = 2152 / 408
const BUTTON_LABEL_ART: Partial<Record<string, { src: string; aspect: number }>> = {
  DANCE: { src: 'assets/images/ui/levels/dance-blue.png', aspect: 1914 / 508 },
  LEADERBOARD: { src: 'assets/images/ui/levels/leaderboard-gold.png', aspect: 2124 / 373 },
  'JUST WATCH': { src: 'assets/images/ui/levels/just-watch-pink.png', aspect: 2115 / 391 },
  SKIP: { src: 'assets/images/ui/levels/skip-pink.png', aspect: 1926 / 602 },
  BACK: { src: 'assets/images/ui/levels/back-pink.png', aspect: 1923 / 582 },
  NEXT: { src: 'assets/images/ui/levels/next-blue.png', aspect: 1854 / 582 },
  'SHOW MENU': { src: 'assets/images/ui/levels/show-menu-gold.png', aspect: 2103 / 362 },
  'PUBLIC MATCH': { src: 'assets/images/ui/levels/public-match-button.png', aspect: 2133 / 376 },
  'SOLO STAGE': { src: 'assets/images/ui/levels/solo-stage-button.png', aspect: 2126 / 405 },
  X: { src: 'assets/images/ui/levels/close-x-pink.png', aspect: 1111 / 868 },
}
const RANK_MENU_ART = [
  { src: 'assets/images/ui/levels/menu-hit-apprentice.png', aspect: 2044 / 550 },
  { src: 'assets/images/ui/levels/menu-move-riser.png', aspect: 2027 / 553 },
  { src: 'assets/images/ui/levels/menu-club-star.png', aspect: 2009 / 563 },
  { src: 'assets/images/ui/levels/menu-step-legend.png', aspect: 1879 / 562 },
  { src: 'assets/images/ui/levels/menu-dance-royalty.png', aspect: 2111 / 599 },
] as const
const POINTS_TITLE_BOUNDS = [229, 155, 1968, 580] as const
const JUMP_OFF_TITLE_BOUNDS = [187, 163, 2000, 567] as const
const JUDGMENT_GRADIENT = 'assets/images/ui/judgment-gradient.png'
const LEADERBOARD_TITLE_TEXTURES = {
  global: 'assets/images/ui/levels/global-leaderboard.png',
  last: 'assets/images/ui/levels/last-game.png',
} as const
const GLOBAL_LEADERBOARD_TITLE_BOUNDS = [31, 231, 2144, 485] as const
const LAST_GAME_TITLE_BOUNDS = [60, 157, 2122, 566] as const
const JUDGMENT_TEXTURES: Record<JudgmentText, string> = {
  'PERFECT!': 'assets/images/ui/judgment-perfect.png',
  'GREAT!': 'assets/images/ui/judgment-great.png',
  'COOL!': 'assets/images/ui/judgment-cool.png',
  'GOOD!': 'assets/images/ui/judgment-good.png',
  'MISS!': 'assets/images/ui/judgment-miss.png',
}
const BUTTON_SOUND = 'public/sounds/decentraland-button.mp3'
let buttonSoundEntity = engine.RootEntity
let buttonHoverSoundEntity = engine.RootEntity
let lastHoverSoundAt = 0
let tutorialPage = 0
let tutorialSequenceStartedAt = Date.now()
let leaderboardTab: 'global' | 'last' = 'global'
let leaderboardPage = 0
let buttonActionLockedUntil = 0

function getSafeCanvas() {
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const insets = canvas?.screenInsetArea
  const left = (insets?.left || 0) + 12
  const top = (insets?.top || 0) + 12
  const right = (insets?.right || 0) + 12
  const bottom = (insets?.bottom || 0) + 12
  return {
    left, top, right, bottom,
    width: Math.max(1, (canvas?.width || (isMobile() ? 720 : 1280)) - left - right),
    height: Math.max(1, (canvas?.height || (isMobile() ? 540 : 720)) - top - bottom),
  }
}

function RankLabelImage({ points, width, height }: { points: number; width: number; height?: number }): ReactEcs.JSX.Element {
  const rank = getDanceRank(points)
  const imageHeight = Math.min(height ?? width / rank.labelAspect, width / rank.labelAspect)
  return (
    <UiEntity uiTransform={{ width, height: height ?? imageHeight, alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: imageHeight * rank.labelAspect, height: imageHeight, pointerFilter: 'none' }}
        uiBackground={{ texture: { src: rank.label }, textureMode: 'stretch' }} />
    </UiEntity>
  )
}

function LevelTitleImage({ title, width, height }: { title: LevelTitleKey; width: number; height: number }): ReactEcs.JSX.Element {
  const sprite = LEVEL_TITLES[title]
  const [left, top, right, bottom] = sprite.bounds
  const scale = Math.min(width / (right - left), height / (bottom - top))
  return <UiEntity uiTransform={{ width, height, flexShrink: 0, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ positionType: 'relative', width: (right - left) * scale, height: (bottom - top) * scale, overflow: 'hidden', pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: -left * scale, top: -top * scale }, width: sprite.width * scale, height: sprite.height * scale, pointerFilter: 'none' }}
        uiBackground={{ texture: { src: `assets/images/ui/levels/${sprite.file}.png` }, textureMode: 'stretch' }} />
    </UiEntity>
  </UiEntity>
}

function LevelTitlePreload(): ReactEcs.JSX.Element {
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: 1, height: 1, pointerFilter: 'none' }}>
    {Object.values(LEVEL_TITLES).map(sprite => <UiEntity key={`preload-title-${sprite.file}`} uiTransform={{ positionType: 'absolute', width: 1, height: 1, pointerFilter: 'none' }}
      uiBackground={{ texture: { src: `assets/images/ui/levels/${sprite.file}.png` }, textureMode: 'stretch', color: Color4.create(1, 1, 1, 0) }} />)}
  </UiEntity>
}

function FloatingLeaderboardTitle({ title, panelWidth, contentWidth }: { title: 'global' | 'last'; panelWidth: number; contentWidth: number }): ReactEcs.JSX.Element {
  const bounds = title === 'global' ? GLOBAL_LEADERBOARD_TITLE_BOUNDS : LAST_GAME_TITLE_BOUNDS
  const visibleAspect = (bounds[2] - bounds[0]) / (bounds[3] - bounds[1])
  // LAST GAME is intentionally larger than its previous in-panel rendering
  // and floats 30% above the frame. GLOBAL stays narrower so the left edge no
  // longer reaches the BACK button on mobile landscape.
  const width = title === 'last'
    ? Math.min(540, contentWidth * 0.60)
    : Math.min(580, contentWidth * 0.68)
  const height = width / visibleAspect

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: -height * 0.30, left: (panelWidth - width) * 0.5 },
        width,
        height,
        zIndex: 6,
        pointerFilter: 'none',
      }}
    >
      <CroppedMenuTitleImage
        src={LEADERBOARD_TITLE_TEXTURES[title]}
        width={width}
        height={height}
        bounds={bounds}
      />
    </UiEntity>
  )
}

function MenuRankStrip({ width, height }: { width: number; height: number }): ReactEcs.JSX.Element {
  const rpHeight = Math.min(24, height * 0.36)
  const labelHeight = height - rpHeight
  const labelWidth = Math.min(220, width, labelHeight * getDanceRank(gameState.rankPoints).labelAspect)
  return (
    <UiEntity uiTransform={{ width, height, flexShrink: 0, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
      <RankLabelImage points={gameState.rankPoints} width={labelWidth} height={labelHeight} />
      <Label value={`${gameState.rankPoints} RP`} fontSize={Math.min(20, rpHeight * 0.85)}
        color={Color4.create(0.46, 0.92, 1, 1)} uiTransform={{ width: '100%', height: rpHeight }} textAlign="middle-center" />
    </UiEntity>
  )
}

function MenuRankText({ width, height }: { width: number; height: number }): ReactEcs.JSX.Element {
  const value = `${getDanceRank(gameState.rankPoints).name}  •  ${gameState.rankPoints} RP`
  return <Label value={value} fontSize={Math.min(22, height * 0.65, width / (value.length * 0.58))}
    color={Color4.create(0.46, 0.92, 1, 1)} textWrap="nowrap" textAlign="middle-center"
    uiTransform={{ width, height, flexShrink: 0, pointerFilter: 'none' }} />
}

// Layered lettering keeps the heavy result typography consistent across
// clients without relying on an explorer-specific rich-text font weight.
function ImpactLabel({ value, fontSize, color, height, align = 'middle-center' }: {
  value: string; fontSize: number; color: Color4; height: number; align?: 'middle-left' | 'middle-center' | 'middle-right'
}): ReactEcs.JSX.Element {
  return <UiEntity uiTransform={{ width: '100%', height, flexShrink: 0, positionType: 'relative', pointerFilter: 'none' }}>
    <Label value={value} fontSize={fontSize} color={Color4.create(0.015, 0.005, 0.035, 0.9)} textAlign={align} textWrap="nowrap"
      uiTransform={{ positionType: 'absolute', position: { left: 2, top: 3 }, width: '100%', height: '100%', pointerFilter: 'none' }} />
    {[0, 0.8].map(offset => <Label key={`weight-${offset}`} value={value} fontSize={fontSize} color={color} textAlign={align} textWrap="nowrap"
      uiTransform={{ positionType: 'absolute', position: { left: offset, top: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }} />)}
  </UiEntity>
}

function RankBadgeImage({ points, size, alpha = 1 }: { points: number; size: number; alpha?: number }): ReactEcs.JSX.Element {
  const rank = getDanceRank(points)
  return (
    <UiEntity key={`rank-badge-${rank.asset}`}
      uiTransform={{ width: size, height: size, minWidth: size, minHeight: size, flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ texture: { src: rank.badge }, textureMode: 'stretch', color: Color4.create(1, 1, 1, alpha) }} />
  )
}

function RankBadgePreload(): ReactEcs.JSX.Element {
  // Resolve the textures while the lobby is open, before a short-lived popup
  // requests its first frame. Keep these mounted across phase transitions.
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: 1, height: 1, pointerFilter: 'none' }}>
      {DANCE_RANKS.map(rank => (
        <UiEntity key={`preload-${rank.asset}`} uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: 1, height: 1, pointerFilter: 'none' }}
          uiBackground={{ texture: { src: getDanceRank(rank.points).badge }, textureMode: 'stretch', color: Color4.create(1, 1, 1, 0) }} />
      ))}
    </UiEntity>
  )
}

function RankUpConfetti({ elapsed, width, height, points }: { elapsed: number; width: number; height: number; points: number }): ReactEcs.JSX.Element {
  const time = Math.max(0, elapsed - 0.65)
  const colors = getDanceRank(points).confetti
  const alpha = smoothStep(time / 0.18) * (1 - smoothStep((time - 1.6) / 2.2))
  const reach = Math.min(width, height) * 0.43
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width, height, pointerFilter: 'none', overflow: 'hidden' }}>
      {Array.from({ length: isMobile() ? 32 : 48 }, (_, index) => {
        const angle = index * 2.39996
        const speed = 0.55 + (index % 7) * 0.07
        const travel = reach * (1 - Math.exp(-time * 2)) * speed
        const size = 8 + index % 5 * 2
        const color = colors[index % colors.length]
        return <Label key={`rank-confetti-${index}`} value={index % 3 === 0 ? '✦' : index % 2 === 0 ? '◆' : '●'}
          fontSize={size} color={Color4.create(color.r, color.g, color.b, alpha)}
          uiTransform={{ positionType: 'absolute', position: {
            left: width / 2 + Math.cos(angle) * travel + Math.sin(time * 3 + index) * time * 5 - size / 2,
            top: height / 2 + Math.sin(angle) * travel + time * time * 13 - size / 2,
          }, width: size + 4, height: size + 4, pointerFilter: 'none' }} textAlign="middle-center" />
      })}
    </UiEntity>
  )
}

function RankUpCelebration(): ReactEcs.JSX.Element | null {
  if (rankUpPopup.timer <= 0 || isSoloTransitionPending() || (gameState.phase === 'gameover' && resultsPresentation.elapsed > 0)) return null
  const elapsed = RANK_UP_DURATION - rankUpPopup.timer
  const motion = rankUpMotion(elapsed)
  const safe = getSafeCanvas()
  const areaSize = Math.floor(Math.min(isMobile() ? 410 : 560, safe.width, safe.height))
  const badgeSize = Math.round(areaSize * 0.76 * motion.scale)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', padding: { top: safe.top, left: safe.left, right: safe.right, bottom: safe.bottom }, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 30, pointerFilter: 'none' }}>
      <UiEntity key={`rank-up-${rankUpPopup.id}`} uiTransform={{ width: areaSize, height: areaSize, flexShrink: 0, positionType: 'relative', pointerFilter: 'none' }}>
        <RankUpConfetti elapsed={elapsed} width={areaSize} height={areaSize} points={rankUpPopup.points} />
        <UiEntity uiTransform={{ positionType: 'absolute', position: {
          left: (areaSize - badgeSize) / 2,
          top: (areaSize - badgeSize) / 2 + (1 - smoothStep(elapsed / 1.1)) * 24 - (1 - smoothStep(rankUpPopup.timer / 1.5)) * 22 + Math.sin(elapsed * 2.4) * 3,
        }, width: badgeSize, height: badgeSize, pointerFilter: 'none' }}>
          <RankBadgeImage points={rankUpPopup.points} size={badgeSize} alpha={motion.alpha} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

function judgmentAccent(text: JudgmentText, alpha = 1): Color4 {
  if (text === 'PERFECT!') return Color4.create(0.18, 0.90, 1.0, alpha)
  if (text === 'GREAT!') return Color4.create(0.34, 1.0, 0.54, alpha)
  if (text === 'COOL!') return Color4.create(0.76, 0.34, 1.0, alpha)
  if (text === 'GOOD!') return Color4.create(1.0, 0.56, 0.10, alpha)
  return Color4.create(0.58, 0.04, 0.12, alpha)
}

function judgmentLabel(text: JudgmentText, combo = 0): string {
  const base = text.replace('!', '')
  if (text === 'PERFECT!' && combo > 1) return `${base} ${combo}x`
  return base
}

function JudgmentWord({
  text,
  combo = 0,
  fontSize,
  alpha = 1,
}: {
  text: JudgmentText
  combo?: number
  fontSize: number
  alpha?: number
}): ReactEcs.JSX.Element {
  const accent = judgmentAccent(text, alpha)
  const shadow = text === 'MISS!'
    ? Color4.create(0.30, 0.0, 0.04, alpha * 0.78)
    : Color4.create(1.0, 0.35, 0.88, alpha * 0.36)

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'relative', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
      <Label
        value={judgmentLabel(text, combo)}
        font="serif"
        fontSize={fontSize}
        color={shadow}
        uiTransform={{ positionType: 'absolute', position: { top: 2, left: 2 }, width: '100%', height: '100%', pointerFilter: 'none' }}
        textAlign="middle-center"
      />
      <Label
        value={judgmentLabel(text, combo)}
        font="serif"
        fontSize={fontSize}
        color={accent}
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}
        textAlign="middle-center"
      />
    </UiEntity>
  )
}

function SparkleBurst({
  progress,
  color,
  width,
  height,
  distance,
  count = 12,
}: {
  progress: number
  color: Color4
  width: number
  height: number
  distance: number
  count?: number
}): ReactEcs.JSX.Element {
  const particles = Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count + (index % 2) * 0.11
    const speed = 0.72 + (index % 4) * 0.12
    return { x: Math.cos(angle), y: Math.sin(angle), speed }
  })
  const alpha = Math.max(0, 1 - progress) ** 1.45

  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width, height, pointerFilter: 'none' }}>
      {particles.map((particle, index) => {
        const travel = (8 + progress * distance) * particle.speed
        const size = Math.max(7, 19 - progress * 9 - (index % 3))
        return (
          <Label
            key={`judgment-spark-${index}`}
            value={index % 3 === 0 ? '★' : index % 2 === 0 ? '✦' : '◆'}
            fontSize={size}
            color={Color4.create(color.r, color.g, color.b, alpha)}
            uiTransform={{
              positionType: 'absolute',
              position: {
                left: width / 2 + particle.x * travel - size / 2,
                top: height / 2 + particle.y * travel - size / 2,
              },
              width: size,
              height: size,
              pointerFilter: 'none',
            }}
            textAlign="middle-center"
          />
        )
      })}
    </UiEntity>
  )
}

function judgmentPopScale(progress: number): number {
  if (progress < 0.14) {
    return 0.68 + (progress / 0.14) * 0.48
  }
  if (progress < 0.28) {
    return 1.16 - ((progress - 0.14) / 0.14) * 0.16
  }
  return 1
}

type ButtonTone = 'cyan' | 'magenta' | 'purple' | 'green' | 'gold' | 'red'

const BUTTON_GRADIENTS: Record<ButtonTone, { top: Color4; bottom: Color4; border: Color4 }> = {
  cyan: {
    top: Color4.create(0.04, 0.74, 0.92, 0.98),
    bottom: Color4.create(0.02, 0.34, 0.60, 0.98),
    border: Color4.create(0.38, 0.94, 1.0, 1),
  },
  magenta: {
    top: Color4.create(0.94, 0.20, 0.72, 0.98),
    bottom: Color4.create(0.46, 0.05, 0.44, 0.98),
    border: Color4.create(1.0, 0.48, 0.92, 1),
  },
  purple: {
    top: Color4.create(0.80, 0.40, 1.0, 0.98),
    bottom: Color4.create(0.31, 0.025, 0.72, 0.98),
    border: Color4.create(0.90, 0.56, 1.0, 1),
  },
  green: {
    top: Color4.create(0.08, 0.76, 0.50, 0.98),
    bottom: Color4.create(0.02, 0.34, 0.28, 0.98),
    border: Color4.create(0.42, 1.0, 0.76, 1),
  },
  gold: {
    top: Color4.create(1.0, 0.68, 0.10, 0.98),
    bottom: Color4.create(0.68, 0.25, 0.04, 0.98),
    border: Color4.create(1.0, 0.86, 0.28, 1),
  },
  red: {
    top: Color4.create(1.0, 0.16, 0.28, 0.98),
    bottom: Color4.create(0.54, 0.02, 0.10, 0.98),
    border: Color4.create(1.0, 0.36, 0.42, 1),
  },
}
const BUTTON_TEXTURES: Record<ButtonTone, string> = {
  cyan: 'assets/images/ui/button-cyan.png',
  magenta: 'assets/images/ui/button-magenta.png',
  purple: 'assets/images/ui/button-magenta.png',
  green: 'assets/images/ui/button-green.png',
  gold: 'assets/images/ui/button-gold.png',
  red: 'assets/images/ui/button-magenta.png',
}

function playButtonSound(): void {
  if (buttonSoundEntity === engine.RootEntity) return
  AudioSource.playSound(buttonSoundEntity, BUTTON_SOUND, true)
}

function playButtonHoverSound(): void {
  const now = Date.now()
  if (buttonHoverSoundEntity === engine.RootEntity || now - lastHoverSoundAt < 90) return
  lastHoverSoundAt = now
  AudioSource.playSound(buttonHoverSoundEntity, BUTTON_SOUND, true)
}

function runButtonAction(action: () => void): void {
  const now = Date.now()
  if (now < buttonActionLockedUntil) return
  buttonActionLockedUntil = now + (isMobile() ? 240 : 80)
  dispatchUiAction(action)
}

function BeatScoreLogo({ compact = false, maxHeight }: { compact?: boolean; maxHeight?: number }): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const baseWidth = compact ? (mobile ? 180 : 176) : (mobile ? 215 : 290)
  const baseHeight = compact ? (mobile ? 104 : 102) : (mobile ? 124 : 167)
  const height = Math.min(baseHeight, maxHeight ?? baseHeight)
  const width = baseWidth * height / baseHeight

  return (
    <UiEntity
      uiTransform={{ width, height, margin: { bottom: compact ? 2 : mobile ? 2 : 4 }, flexShrink: 0 }}
      uiBackground={{ texture: { src: BEAT_SCORE_LOGO }, textureMode: 'stretch' }}
    />
  )
}

function FloatingBeatScoreLogo({ panelWidth, height, outset = 0.58 }: { panelWidth: number; height: number; outset?: number }): ReactEcs.JSX.Element {
  const width = height * BEAT_SCORE_LOGO_ASPECT
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: -height * outset, left: (panelWidth - width) * 0.5 },
        width,
        height,
        zIndex: 4,
        pointerFilter: 'none',
      }}
      uiBackground={{ texture: { src: BEAT_SCORE_LOGO }, textureMode: 'stretch' }}
    />
  )
}

function MenuTitleImage({ src, width, height }: { src: string; width: number; height: number }): ReactEcs.JSX.Element {
  const renderedWidth = Math.min(width, height * MENU_TITLE_ASPECT)
  const renderedHeight = renderedWidth / MENU_TITLE_ASPECT
  return <UiEntity uiTransform={{ width, height, flexShrink: 0, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: renderedWidth, height: renderedHeight, pointerFilter: 'none' }}
      uiBackground={{ texture: { src }, textureMode: 'stretch' }} />
  </UiEntity>
}

function CroppedMenuTitleImage({
  src,
  width,
  height,
  bounds,
}: {
  src: string
  width: number
  height: number
  bounds: readonly [number, number, number, number]
}): ReactEcs.JSX.Element {
  const [left, top, right, bottom] = bounds
  const sourceWidth = 2172
  const sourceHeight = 724
  const scale = Math.min(width / (right - left), height / (bottom - top))
  const renderedWidth = (right - left) * scale
  const renderedHeight = (bottom - top) * scale

  return (
    <UiEntity uiTransform={{ width, height, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ positionType: 'relative', width: renderedWidth, height: renderedHeight, overflow: 'hidden', pointerFilter: 'none' }}>
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { left: -left * scale, top: -top * scale },
            width: sourceWidth * scale,
            height: sourceHeight * scale,
            pointerFilter: 'none',
          }}
          uiBackground={{ texture: { src }, textureMode: 'stretch' }}
        />
      </UiEntity>
    </UiEntity>
  )
}

function FloatingMenuTitle({ src, panelWidth, height }: { src: string; panelWidth: number; height: number }): ReactEcs.JSX.Element {
  const width = Math.min(panelWidth * 0.72, height * MENU_TITLE_ASPECT)
  return <UiEntity
    uiTransform={{
      positionType: 'absolute',
      position: { top: -height * 0.5, left: (panelWidth - width) * 0.5 },
      width,
      height: width / MENU_TITLE_ASPECT,
      zIndex: 5,
      pointerFilter: 'none',
    }}
    uiBackground={{ texture: { src }, textureMode: 'stretch' }}
  />
}

function GradientFill({ tone, borderRadius = 16 }: { tone: ButtonTone; borderRadius?: number }): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: '3%', left: '1%' },
        width: '98%',
        height: '94%',
        borderRadius: Math.max(0, borderRadius - 2),
        overflow: 'hidden',
        pointerFilter: 'none',
      }}
      uiBackground={{
        texture: { src: BUTTON_TEXTURES[tone] },
        textureMode: 'stretch',
        color: tone === 'red'
          ? Color4.create(0.92, 0.34, 0.38, 1)
          : tone === 'purple' ? Color4.create(0.90, 0.68, 1.0, 1) : Color4.White(),
      }}
    />
  )
}

function ButtonLabelGraphic({ label, height, maxWidth, useRankMenuArt = true, artOverride }: { label: string; height: number; maxWidth?: number; useRankMenuArt?: boolean; artOverride?: { src: string; aspect: number } }): ReactEcs.JSX.Element | null {
  const art = artOverride ?? (label === 'MENU' && useRankMenuArt
    ? RANK_MENU_ART[getDanceRankIndex(gameState.rankPoints)]
    : label === 'MENU'
      ? { src: 'assets/images/ui/levels/menu-bw.png', aspect: 1709 / 560 }
    : BUTTON_LABEL_ART[label])
  if (!art) return null
  const imageHeight = height * 0.62
  const imageWidth = Math.min(art.aspect * imageHeight, maxWidth ?? art.aspect * imageHeight)
  return <UiEntity uiTransform={{ width: imageWidth, height: imageHeight, zIndex: 2, pointerFilter: 'none' }}
    uiBackground={{ texture: { src: art.src }, textureMode: 'stretch', color: Color4.White() }} />
}

let hoveredButtonKey = ''
let pressedButtonKey = ''
let clickedButtonKey = ''
let clickAnimationLockedUntil = 0

function beginButtonPress(buttonKey: string): void {
  pressedButtonKey = buttonKey
  playButtonSound()
}

function beginButtonHover(buttonKey: string): void {
  if (hoveredButtonKey === buttonKey) return
  hoveredButtonKey = buttonKey
  if (!isMobile()) playButtonHoverSound()
}

function finishButtonPress(buttonKey: string, action: () => void): void {
  if (pressedButtonKey !== buttonKey) return
  pressedButtonKey = ''
  const now = Date.now()
  if (now < clickAnimationLockedUntil) return
  clickAnimationLockedUntil = now + 150
  clickedButtonKey = buttonKey
  setTimeout(() => {
    if (clickedButtonKey === buttonKey) clickedButtonKey = ''
    runButtonAction(action)
  }, 110)
}

function HoverAnimation({ buttonKey, borderRadius = 16 }: { buttonKey: string; borderRadius?: number }): ReactEcs.JSX.Element | null {
  const pressed = pressedButtonKey === buttonKey || clickedButtonKey === buttonKey
  if (hoveredButtonKey !== buttonKey && !pressed) return null
  const phase = (Math.sin(Date.now() / 115) + 1) * 0.5
  return <UiEntity
    uiTransform={{
      positionType: 'absolute',
      position: { top: 0, left: 0 },
      width: '100%',
      height: '100%',
      borderRadius,
      borderWidth: pressed ? 4 : 2,
      borderColor: Color4.create(1, 1, 1, pressed ? 1 : 0.48 + phase * 0.42),
      pointerFilter: 'none',
      zIndex: 8,
    }}
    uiBackground={{ color: pressed ? Color4.create(0.02, 0.01, 0.06, 0.30) : Color4.create(1, 1, 1, 0.035 + phase * 0.075) }}
  />
}

function MenuButton({
  label,
  tone,
  onClick,
  width,
  height,
  fontSize,
  marginBottom = 0,
  borderRadius = 16,
  disabled = false,
  useRankMenuColors = true,
  menuArt,
}: {
  label: string
  tone: ButtonTone
  onClick: () => void
  width: number | PercentUnit
  height: number
  fontSize: number
  marginBottom?: number
  borderRadius?: number
  disabled?: boolean
  useRankMenuColors?: boolean
  menuArt?: { src: string; aspect: number }
}): ReactEcs.JSX.Element {
  const hoverKey = `menu-button:${label}`
  const gradient = BUTTON_GRADIENTS[tone]
  const rankMenu = label === 'MENU' && useRankMenuColors
  const menuRank = getDanceRank(gameState.rankPoints)
  const hitApprenticeMenu = getDanceRankIndex(gameState.rankPoints) === 0
  const menuBottom = hitApprenticeMenu ? Color4.create(0.62, 0.015, 0.045, 0.99) : Color4.create(
    menuRank.primary.r + (1 - menuRank.primary.r) * 0.22,
    menuRank.primary.g + (1 - menuRank.primary.g) * 0.22,
    menuRank.primary.b + (1 - menuRank.primary.b) * 0.22,
    0.98,
  )
  const menuTop = hitApprenticeMenu ? Color4.create(1.0, 0.07, 0.11, 0.99) : Color4.create(
    menuRank.secondary.r + (1 - menuRank.secondary.r) * 0.40,
    menuRank.secondary.g + (1 - menuRank.secondary.g) * 0.40,
    menuRank.secondary.b + (1 - menuRank.secondary.b) * 0.40,
    0.98,
  )
  const touchHeight = isMobile() ? Math.max(48, height) : height
  const labelArt = menuArt ?? (label === 'MENU' ? RANK_MENU_ART[getDanceRankIndex(gameState.rankPoints)] : BUTTON_LABEL_ART[label])

  return (
    <UiEntity
      uiTransform={{
        width,
        height: touchHeight,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        margin: { bottom: marginBottom },
        borderRadius,
        borderWidth: rankMenu && isMobile() ? 0 : 2,
        borderColor: disabled ? Color4.create(0.30, 0.34, 0.44, 0.85) : rankMenu ? menuTop : gradient.border,
        overflow: 'hidden',
        pointerFilter: disabled ? 'none' : 'block',
      }}
      uiBackground={{ color: disabled ? Color4.create(0.09, 0.11, 0.16, 0.96) : rankMenu ? menuBottom : gradient.bottom }}
      onMouseDown={disabled ? undefined : () => beginButtonPress(hoverKey)}
      onMouseUp={disabled ? undefined : () => finishButtonPress(hoverKey, onClick)}
      onMouseEnter={disabled ? undefined : () => beginButtonHover(hoverKey)}
      onMouseLeave={disabled ? undefined : () => { if (hoveredButtonKey === hoverKey) hoveredButtonKey = ''; if (pressedButtonKey === hoverKey) pressedButtonKey = '' }}
    >
      {disabled || rankMenu ? null : <GradientFill tone={tone} borderRadius={borderRadius} />}
      {disabled || !rankMenu ? null : <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '55%', borderRadius, pointerFilter: 'none' }} uiBackground={{ color: menuTop }} />}
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 0, left: 0 },
          width: '100%',
          height: '30%',
          borderRadius,
          pointerFilter: 'none',
        }}
        uiBackground={{ color: Color4.create(1, 1, 1, 0.10) }}
      />
      {labelArt
        ? <ButtonLabelGraphic label={label} height={touchHeight} maxWidth={typeof width === 'number' ? width * 0.9 : undefined} useRankMenuArt={useRankMenuColors} artOverride={menuArt} />
        : <Label
            value={label}
            fontSize={fontSize}
            color={disabled ? Color4.create(0.66, 0.70, 0.78, 1) : Color4.White()}
            uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', zIndex: 2, pointerFilter: 'none' }}
            textAlign="middle-center"
          />}
      <HoverAnimation buttonKey={hoverKey} borderRadius={borderRadius} />
    </UiEntity>
  )
}

function KeyboardKey({
  symbol,
  color,
  wide = false,
  completed = false,
  active = false,
  sparkleProgress,
}: {
  symbol: string
  color: Color4
  wide?: boolean
  completed?: boolean
  active?: boolean
  sparkleProgress?: number
}): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const size = mobile ? 62 : 70
  const arrowTexture = CARDINAL_ARROW_TEXTURE[symbol]
  const keyColor = completed ? HIT_COLOR : color
  const background = completed
    ? Color4.create(0.42, 0.25, 0.01, 0.98)
    : Color4.create(color.r * 0.13, color.g * 0.13, color.b * 0.13, 0.96)

  return (
    <UiEntity
      uiTransform={{
        width: wide ? (mobile ? 148 : 172) : size,
        height: wide ? (mobile ? 52 : 54) : size,
        alignItems: 'center',
        justifyContent: 'center',
        margin: { left: mobile ? 3 : 5, right: mobile ? 3 : 5 },
        borderRadius: 14,
        borderWidth: active ? 4 : 2,
        borderColor: keyColor,
      }}
      uiBackground={{ color: background }}
    >
      {!wide && arrowTexture ? (
        <UiEntity
          uiTransform={{ width: mobile ? 50 : 56, height: mobile ? 50 : 56, pointerFilter: 'none' }}
          uiBackground={{ texture: { src: arrowTexture }, textureMode: 'stretch', color: completed ? HIT_COLOR : Color4.White() }}
        />
      ) : (
        <Label value={symbol} font="sans-serif" fontSize={wide ? (mobile ? 21 : 20) : (mobile ? 27 : 25)} color={completed ? HIT_COLOR : Color4.White()}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} textAlign="middle-center" />
      )}
      {sparkleProgress !== undefined ? (
        <SparkleBurst
          progress={sparkleProgress}
          color={color}
          width={size}
          height={size}
          distance={mobile ? 34 : 42}
          count={8}
        />
      ) : null}
    </UiEntity>
  )
}

function TutorialProgress(): ReactEcs.JSX.Element {
  return (
    <UiEntity uiTransform={{ width: 164, height: 8, flexDirection: 'row', justifyContent: 'space-between', margin: { bottom: 8 } }}>
      {[0, 1, 2, 3, 4].map(index => (
        <UiEntity
          key={`tutorial-progress-${index}`}
          uiTransform={{ width: index === tutorialPage ? 42 : 21, height: 6, borderRadius: 3 }}
          uiBackground={{
            color: index === tutorialPage
              ? Color4.create(1.0, 0.80, 0.20, 1)
              : Color4.create(0.30, 0.34, 0.48, 0.72),
          }}
        />
      ))}
    </UiEntity>
  )
}

function SequenceVisual(): ReactEcs.JSX.Element {
  return (
    <UiEntity uiTransform={{ width: '100%', height: isMobile() ? 72 : 84, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
      <KeyboardKey symbol="◀" color={DIR_COLOR.left} />
      <KeyboardKey symbol="▲" color={DIR_COLOR.up} />
      <KeyboardKey symbol="▶" color={DIR_COLOR.right} />
      <KeyboardKey symbol="▼" color={DIR_COLOR.down} />
    </UiEntity>
  )
}

function SequenceCompletionVisual(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const sequence = [
    { symbol: '◀', color: DIR_COLOR.left },
    { symbol: '▲', color: DIR_COLOR.up },
    { symbol: '▶', color: DIR_COLOR.right },
    { symbol: '▼', color: DIR_COLOR.down },
  ]
  const elapsed = Math.max(0, Date.now() - tutorialSequenceStartedAt)
  const cycleStep = (elapsed / 520) % 7
  const phase = Math.floor(cycleStep)
  const completedCount = Math.min(sequence.length, phase)

  return (
    <UiEntity uiTransform={{ width: '100%', height: mobile ? 128 : 136, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: '100%', height: mobile ? 70 : 76, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
        {sequence.map((key, index) => (
          <KeyboardKey
            symbol={key.symbol}
            color={key.color}
            completed={index < completedCount}
            active={index === completedCount}
            sparkleProgress={phase >= 1 && phase <= sequence.length && index === phase - 1 ? cycleStep - phase : undefined}
          />
        ))}
      </UiEntity>
      <Label
        value={completedCount === sequence.length ? 'SEQUENCE COMPLETE' : `INPUT ${completedCount + 1} OF ${sequence.length}`}
        fontSize={mobile ? 20 : 18}
        color={completedCount === sequence.length ? HIT_COLOR : Color4.create(0.70, 0.82, 0.96, 1)}
        uiTransform={{ width: '100%', height: mobile ? 30 : 26, margin: { top: 8 } }}
        textAlign="middle-center"
      />
    </UiEntity>
  )
}

function TimingVisual(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const cycle = Date.now() % 3400
  const travelDuration = 2300
  const feedbackDuration = 520
  const hitPressed = cycle >= travelDuration && cycle < travelDuration + feedbackDuration
  const hitProgress = hitPressed ? (cycle - travelDuration) / feedbackDuration : 0
  const markerVisible = cycle < travelDuration + feedbackDuration
  const travelProgress = Math.min(1, cycle / travelDuration)
  const markerLeft = 5 + (74 * travelProgress)

  return (
    <UiEntity uiTransform={{ width: mobile ? '100%' : 400, height: mobile ? 150 : 126, flexDirection: 'column', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{ width: mobile ? '72%' : '100%', height: mobile ? 30 : 38, positionType: 'relative', borderRadius: 15, overflow: 'visible', borderWidth: 1, borderColor: Color4.create(0.46, 0.66, 1, 0.75) }}
        uiBackground={{ color: Color4.create(0.03, 0.04, 0.12, 0.96) }}
      >
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: '72%' }, width: '20%', height: '100%' }}
          uiBackground={{ texture: { src: JUDGMENT_GRADIENT }, textureMode: 'stretch' }} />
        {markerVisible ? (
          <UiEntity uiTransform={{ positionType: 'absolute', position: { top: mobile ? 4 : 5, left: `${markerLeft}%` }, width: mobile ? 22 : 28, height: mobile ? 22 : 28, borderRadius: 14 }}
            uiBackground={{ color: hitPressed ? Color4.create(0.15, 0.92, 1, 1) : Color4.create(0.34, 0.68, 1, 1) }} />
        ) : null}
        {hitPressed ? (
          <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: `${markerLeft}%` }, width: 1, height: mobile ? 30 : 38, pointerFilter: 'none', zIndex: 4 }}>
            <SparkleBurst progress={hitProgress} color={HIT_COLOR} width={1} height={mobile ? 30 : 38} distance={mobile ? 34 : 46} count={10} />
          </UiEntity>
        ) : null}
      </UiEntity>
      {mobile ? (
        <UiEntity uiTransform={{ width: '82%', height: 104, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', margin: { top: 4 } }}>
          <Label value="TAP ONCE" fontSize={20} color={Color4.create(0.74, 0.84, 0.96, 1)}
            uiTransform={{ width: 88, height: 36 }} textAlign="middle-right" />
          <TutorialHitButton pressed={hitPressed} sparkleProgress={hitProgress} />
          <Label value={'WHEN THE CIRCLE IS INSIDE\nTHE COLORED TIMING ZONE'} fontSize={16} color={Color4.create(0.74, 0.84, 0.96, 1)}
            uiTransform={{ width: 250, height: 56 }} textAlign="middle-left" />
        </UiEntity>
      ) : (
        <UiEntity uiTransform={{ width: '100%', height: 79, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: { top: 8 } }}>
          <UiEntity uiTransform={{ width: 184, height: 54, positionType: 'relative', alignItems: 'center', justifyContent: 'center' }}>
            <KeyboardKey symbol="SPACE" color={Color4.create(1, 0.48, 0.84, 1)} wide completed={hitPressed} />
            {hitPressed ? (
              <SparkleBurst progress={hitProgress} color={HIT_COLOR} width={184} height={54} distance={48} count={12} />
            ) : null}
          </UiEntity>
          <Label value="PRESS ONCE — DO NOT HOLD" fontSize={15} color={Color4.create(0.74, 0.84, 0.96, 1)}
            uiTransform={{ width: '100%', height: 20, margin: { top: 3 } }} textAlign="middle-center" />
        </UiEntity>
      )}
    </UiEntity>
  )
}

function ReverseStyleVisual(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const sequence = [
    { displayDirection: 'left' as Direction, inputDirection: 'right' as Direction, inverted: true },
    { displayDirection: 'up' as Direction, inputDirection: 'up' as Direction, inverted: false },
    { displayDirection: 'right' as Direction, inputDirection: 'left' as Direction, inverted: true },
    { displayDirection: 'down' as Direction, inputDirection: 'down' as Direction, inverted: false },
  ]
  const elapsed = Math.max(0, Date.now() - tutorialSequenceStartedAt)
  const cycleStep = (elapsed / 520) % 7
  const phase = Math.floor(cycleStep)
  const completedCount = Math.min(sequence.length, phase)

  return (
    <UiEntity uiTransform={{ width: '100%', height: mobile ? 112 : 146, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: '100%', height: mobile ? 58 : 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        {sequence.map((key, index) => (
          <ArrowBox
            displayDirection={key.displayDirection}
            inputDirection={key.inputDirection}
            inverted={key.inverted}
            state={index < completedCount ? 'done' : index === completedCount ? 'active' : 'pending'}
            sparkleProgress={phase >= 1 && phase <= sequence.length && index === phase - 1 ? cycleStep - phase : undefined}
          />
        ))}
      </UiEntity>
      <Label
        value={completedCount === sequence.length ? 'REVERSE SEQUENCE COMPLETE' : `INPUT ${completedCount + 1} OF ${sequence.length}`}
        fontSize={mobile ? 20 : 16}
        color={completedCount === sequence.length ? HIT_COLOR : Color4.create(0.70, 0.82, 0.96, 1)}
        uiTransform={{ width: '100%', height: mobile ? 30 : 26, margin: { top: 8 } }}
        textAlign="middle-center"
      />
    </UiEntity>
  )
}

function JudgmentGuideVisual(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const judgments: Array<{ text: JudgmentText; points: string }> = [
    { text: 'GOOD!', points: '100' },
    { text: 'COOL!', points: '400' },
    { text: 'GREAT!', points: '700' },
    { text: 'PERFECT!', points: '1000' },
    { text: 'GREAT!', points: '700' },
    { text: 'COOL!', points: '400' },
    { text: 'GOOD!', points: '100' },
  ]
  return (
    <UiEntity uiTransform={{ width: mobile ? '98%' : 500, height: mobile ? 120 : 142, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: '100%', height: mobile ? 34 : 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {judgments.map((result, index) => (
          <UiEntity key={`tutorial-judgment-name-${index}`} uiTransform={{ width: '14.2%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <UiEntity uiTransform={{ width: '100%', height: mobile ? 30 : 34 }}
              uiBackground={{ texture: { src: JUDGMENT_TEXTURES[result.text] }, textureMode: 'stretch' }} />
          </UiEntity>
        ))}
      </UiEntity>
      <UiEntity
        uiTransform={{ width: '100%', height: mobile ? 14 : 16, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: Color4.create(0.56, 0.76, 1.0, 0.72) }}
        uiBackground={{ texture: { src: JUDGMENT_GRADIENT }, textureMode: 'stretch' }}
      />
      <UiEntity uiTransform={{ width: '100%', height: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', margin: { top: 3 } }}>
        {judgments.map((result, index) => (
          <UiEntity key={`tutorial-judgment-points-${index}`} uiTransform={{ width: '14.2%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <Label value={`${result.points} PTS`} fontSize={mobile ? 14 : 13} color={Color4.White()}
              uiTransform={{ width: '100%', height: 24 }} textAlign="middle-center" />
          </UiEntity>
        ))}
      </UiEntity>
      <Label value="MISS • 0 PTS — WRONG SEQUENCE OR NO BEAT TAP" fontSize={mobile ? 16 : 14} color={judgmentAccent('MISS!')}
        uiTransform={{ width: '100%', height: 26, margin: { top: 6 } }} textAlign="middle-center" />
    </UiEntity>
  )
}

function TutorialHitButton({ pressed, sparkleProgress = 0 }: { pressed: boolean; sparkleProgress?: number }): ReactEcs.JSX.Element {
  const outerSize = pressed ? 64 : 72
  const innerSize = pressed ? 54 : 62
  const glowSize = pressed ? 104 : 82

  return (
    <UiEntity
      uiTransform={{ width: 110, height: 80, positionType: 'relative', alignItems: 'center', justifyContent: 'center' }}
    >
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { left: (110 - glowSize) / 2, top: (80 - glowSize) / 2 },
          width: glowSize,
          height: glowSize,
          borderRadius: Math.floor(glowSize / 2),
          borderWidth: pressed ? 4 : 2,
          borderColor: Color4.create(1, 0.78, 0.08, pressed ? 0.72 : 0.18),
        }}
        uiBackground={{ color: Color4.create(1, 0.62, 0.02, pressed ? 0.18 : 0.03) }}
      />
      <UiEntity
      uiTransform={{
        width: outerSize,
        height: outerSize,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Math.floor(outerSize / 2),
        borderWidth: 3,
        borderColor: Color4.create(HIT_COLOR.r, HIT_COLOR.g, HIT_COLOR.b, pressed ? 1 : 0.48),
      }}
      uiBackground={{ color: Color4.create(0.02, 0.01, 0.015, 0.96) }}
    >
      <UiEntity
        uiTransform={{ width: innerSize, height: innerSize, alignItems: 'center', justifyContent: 'center', borderRadius: Math.floor(innerSize / 2), borderWidth: 2, borderColor: HIT_COLOR }}
        uiBackground={{ color: pressed ? Color4.create(0.40, 0.23, 0.01, 0.98) : Color4.create(0.07, 0.035, 0.01, 0.96) }}
      >
        <Label value="★" fontSize={pressed ? 35 : 40} color={HIT_COLOR}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} textAlign="middle-center" />
      </UiEntity>
      </UiEntity>
      {pressed ? (
        <SparkleBurst progress={sparkleProgress} color={HIT_COLOR} width={110} height={80} distance={48} count={10} />
      ) : null}
    </UiEntity>
  )
}

function TutorialSlide({ width = 500, height = 330 }: { width?: number; height?: number }): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const titles = ['READ THE SEQUENCE', 'ENTER THE MOVES', 'HIT THE BEAT', 'REVERSE STYLE', 'JUDGMENTS']
  const descriptions = [
    'Follow the arrows from left to right.',
    mobile ? 'Tap the matching direction buttons.' : 'Press the matching arrow keys in order.',
    mobile ? 'Tap once when the circle enters the colored zone.' : 'When the circle enters the colored zone.\nPress SPACE once.',
    'Red arrows mean press the opposite direction.\nDo not reverse the entire sequence.',
    'Timing accuracy determines your result and points.\nCloser to the center = more points.',
  ]

  const nextTutorialPage = (): void => {
    const nextPage = Math.min(5, tutorialPage + 1)
    if ((tutorialPage === 0 && nextPage === 1) || nextPage === 3) tutorialSequenceStartedAt = Date.now()
    tutorialPage = nextPage
  }
  const previousTutorialPage = (): void => {
    const nextPage = Math.max(0, tutorialPage - 1)
    if ((tutorialPage === 2 && nextPage === 1) || nextPage === 3) tutorialSequenceStartedAt = Date.now()
    tutorialPage = nextPage
  }
  const skipTutorial = (): void => {
    tutorialPage = 5
  }

  const short = height < 260
  const progressHeight = short ? 0 : 16
  const navHeight = 58
  const navMargin = short ? 4 : 8
  const panelHeight = Math.max(120, height - progressHeight - navHeight - navMargin)
  const panelPadding = short ? 6 : mobile ? 10 : 12
  const stepHeight = short ? 0 : 22
  const titleHeight = short ? 30 : mobile ? 40 : 44
  const descriptionHeight = short ? 34 : mobile ? 44 : 46
  const visualHeight = Math.max(30, panelHeight - panelPadding * 2 - stepHeight - titleHeight - descriptionHeight)
  const compactExample = width < 500 || visualHeight < 150
  const step = Math.floor(((Date.now() - tutorialSequenceStartedAt) / 520) % 7)
  const marker = (Date.now() % 3400) / 3400
  const inputDirections: Direction[] = ['left', 'up', 'right', 'down']
  return (
    <UiEntity uiTransform={{ width: '100%', height, flexShrink: 0, flexDirection: 'column', alignItems: 'center' }}>
      {!short ? <TutorialProgress /> : null}
      <UiEntity uiTransform={{ width: '100%', height: panelHeight, flexShrink: 0, flexDirection: 'column', alignItems: 'center', padding: panelPadding, borderRadius: short ? 12 : 18, overflow: 'hidden' }}
        uiBackground={{ color: Color4.create(0.025, 0.035, 0.10, 0.76) }}>
        {!short ? <Label value={`STEP ${tutorialPage + 1}  /  5`} fontSize={mobile ? 16 : 17} color={HIT_COLOR} uiTransform={{ width: '100%', height: stepHeight }} textAlign="middle-center" /> : null}
        <Label value={titles[tutorialPage]} fontSize={Math.min(short ? 22 : mobile ? 32 : 36, width / Math.max(9, titles[tutorialPage].length * 0.56))} color={Color4.White()} uiTransform={{ width: '100%', height: titleHeight, flexShrink: 0 }} textAlign="middle-center" />
        <Label value={descriptions[tutorialPage]} fontSize={short ? 14 : Math.min(mobile ? 19 : 20, width / 18)} color={Color4.create(0.78, 0.87, 0.98, 1)} uiTransform={{ width: '94%', height: descriptionHeight, flexShrink: 0 }} textAlign="middle-center" />
        <UiEntity uiTransform={{ width: '100%', height: visualHeight, flexShrink: 0, alignItems: 'center', justifyContent: 'center', positionType: 'relative', position: { top: mobile && tutorialPage === 3 ? 12 : 0 } }}>
        {!compactExample ? (tutorialPage === 0 ? <SequenceVisual /> : tutorialPage === 1 ? <SequenceCompletionVisual /> : tutorialPage === 2 ? <TimingVisual /> : tutorialPage === 3 ? <ReverseStyleVisual /> : <JudgmentGuideVisual />) : tutorialPage === 2 ? (
          <UiEntity uiTransform={{ width: '92%', height: Math.min(mobile ? 42 : 38, visualHeight - 4), positionType: 'relative', overflow: 'visible', borderRadius: 14 }} uiBackground={{ color: Color4.create(0.03, 0.04, 0.12, 1) }}>
            <UiEntity uiTransform={{ positionType: 'absolute', position: { left: '72%', top: 0 }, width: '20%', height: '100%' }} uiBackground={{ texture: { src: JUDGMENT_GRADIENT }, textureMode: 'stretch' }} />
            <UiEntity uiTransform={{ positionType: 'absolute', position: { left: `${5 + Math.min(1, marker / 0.68) * 74}%` as PercentUnit, top: 2 }, width: Math.min(26, visualHeight - 8), height: Math.min(26, visualHeight - 8), borderRadius: 14 }} uiBackground={{ color: marker > 0.68 ? HIT_COLOR : DIR_COLOR.up }} />
            {mobile && marker >= 0.68 ? <UiEntity uiTransform={{ positionType: 'absolute', position: { left: '79%', top: 0 }, width: 1, height: '100%', zIndex: 4, pointerFilter: 'none' }}>
              <SparkleBurst progress={(marker - 0.68) / 0.32} color={HIT_COLOR} width={1} height={Math.min(mobile ? 42 : 38, visualHeight - 4)} distance={38} count={12} />
            </UiEntity> : null}
          </UiEntity>
        ) : tutorialPage === 4 ? <UiEntity uiTransform={{ width: '100%', height: Math.min(78, visualHeight), flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <UiEntity uiTransform={{ width: '100%', height: Math.min(52, Math.max(30, visualHeight - 24)), flexDirection: 'row', justifyContent: 'space-between' }}>
            {(['GOOD!', 'COOL!', 'GREAT!', 'PERFECT!'] as JudgmentText[]).map(text => <UiEntity key={text} uiTransform={{ width: '24%', height: '100%' }} uiBackground={{ texture: { src: JUDGMENT_TEXTURES[text] }, textureMode: 'stretch' }} />)}
          </UiEntity>
          <UiEntity uiTransform={{ width: '100%', height: 24, flexDirection: 'row', justifyContent: 'space-between' }}>
            {['100 PTS', '400 PTS', '700 PTS', '1000 PTS'].map(points => <Label key={points} value={points} fontSize={mobile ? 15 : 13} color={Color4.White()}
              uiTransform={{ width: '24%', height: 24 }} textAlign="middle-center" textWrap="nowrap" />)}
          </UiEntity>
        </UiEntity> : <UiEntity uiTransform={{ width: '100%', height: Math.min(mobile ? 70 : 76, visualHeight), flexDirection: 'row', justifyContent: 'center' }}>
          {inputDirections.map((direction, index) => {
            const reverse = tutorialPage === 3 && (index === 0 || index === 2)
            const complete = tutorialPage > 0 && index < step
            const display = reverse && !complete ? (direction === 'left' ? 'right' : 'left') : direction
            const size = Math.min(mobile ? 62 : 68, visualHeight - 4, (width - 32) / 4)
            const sparkleProgress = ((Date.now() - tutorialSequenceStartedAt) / 520) % 1
            const sparkling = mobile && complete && index === Math.max(0, Math.min(inputDirections.length - 1, step - 1))
            return <UiEntity key={direction} uiTransform={{ width: size, height: size, positionType: 'relative', flexShrink: 0, margin: { left: 4, right: 4 }, borderRadius: 8, borderWidth: 2, borderColor: complete ? HIT_COLOR : reverse ? REVERSE_COLOR : DIR_COLOR[direction], padding: 4 }} uiBackground={{ texture: { src: CARDINAL_ARROW_TEXTURE[DIR_SYMBOL[display]] }, textureMode: 'stretch', color: complete ? HIT_COLOR : Color4.White() }}>
              {sparkling ? <SparkleBurst progress={sparkleProgress} color={HIT_COLOR} width={size} height={size} distance={size * 0.56} count={10} /> : null}
            </UiEntity>
          })}
        </UiEntity>}
        </UiEntity>
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: navHeight, flexShrink: 0, flexDirection: 'row', justifyContent: 'space-between', margin: { top: navMargin } }}>
        <MenuButton label={tutorialPage === 0 ? 'SKIP' : 'BACK'} tone="magenta" onClick={tutorialPage === 0 ? skipTutorial : previousTutorialPage} width="38%" height={navHeight} fontSize={22} borderRadius={13} />
        <MenuButton label={tutorialPage === 4 ? 'SHOW MENU' : 'NEXT'} tone={tutorialPage === 4 ? 'gold' : 'cyan'} onClick={nextTutorialPage} width="58%" height={navHeight} fontSize={Math.min(25, width * 0.58 / 7)} borderRadius={13} />
      </UiEntity>
    </UiEntity>
  )
}

function CloseButton({ onClick }: { onClick: () => void }): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const hoverKey = 'close-button'
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 12, right: 12 },
        width: mobile ? 52 : 42,
        height: mobile ? 52 : 42,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: Color4.create(1.0, 0.40, 0.86, 0.85),
        pointerFilter: 'block',
      }}
      uiBackground={{ color: Color4.create(0.04, 0.03, 0.08, 0.92) }}
      onMouseDown={() => beginButtonPress(hoverKey)}
      onMouseUp={() => finishButtonPress(hoverKey, onClick)}
      onMouseEnter={() => beginButtonHover(hoverKey)}
      onMouseLeave={() => { if (hoveredButtonKey === hoverKey) hoveredButtonKey = ''; if (pressedButtonKey === hoverKey) pressedButtonKey = '' }}
    >
      <ButtonLabelGraphic label="X" height={mobile ? 42 : 34} maxWidth={mobile ? 38 : 30} />
      <HoverAnimation buttonKey={hoverKey} borderRadius={12} />
    </UiEntity>
  )
}

function BackButton({ onClick }: { onClick: () => void }): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const hoverKey = 'back-button'
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 12, left: 12 },
        width: mobile ? 94 : 96,
        height: mobile ? 50 : 42,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: Color4.create(1.0, 0.40, 0.86, 0.85),
        pointerFilter: 'block',
      }}
      uiBackground={{ color: Color4.create(0.16, 0.025, 0.13, 0.92) }}
      onMouseDown={() => beginButtonPress(hoverKey)}
      onMouseUp={() => finishButtonPress(hoverKey, onClick)}
      onMouseEnter={() => beginButtonHover(hoverKey)}
      onMouseLeave={() => { if (hoveredButtonKey === hoverKey) hoveredButtonKey = ''; if (pressedButtonKey === hoverKey) pressedButtonKey = '' }}
    >
      <ButtonLabelGraphic label="BACK" height={mobile ? 46 : 38} maxWidth={mobile ? 82 : 82} />
      <HoverAnimation buttonKey={hoverKey} borderRadius={12} />
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Arrow box in the Keynote bar
// state: 'done' | 'active' | 'pending' | 'failed'
// ──────────────────────────────────────────────────────────
function ArrowBox({
  displayDirection,
  inputDirection,
  inverted,
  state,
  sparkleProgress,
}: {
  displayDirection: Direction
  inputDirection: Direction
  inverted: boolean
  state: 'done' | 'active' | 'pending' | 'failed'
  sparkleProgress?: number
}): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const boxSize = mobile ? 62 : 68
  const c = inverted ? REVERSE_COLOR : DIR_COLOR[displayDirection]
  const sym = state === 'done' && inverted ? DIR_SYMBOL[inputDirection] : DIR_SYMBOL[displayDirection]
  const arrowTexture = CARDINAL_ARROW_TEXTURE[sym]

  let bg: Color4
  let fg: Color4

  switch (state) {
    case 'done':
      if (sparkleProgress !== undefined) {
        bg = Color4.create(
          c.r + (HIT_COLOR.r - c.r) * sparkleProgress,
          c.g + (HIT_COLOR.g - c.g) * sparkleProgress,
          c.b + (HIT_COLOR.b - c.b) * sparkleProgress,
          1,
        )
      } else {
        bg = HIT_COLOR
      }
      fg = Color4.White()
      break
    case 'active':
      bg = Color4.create(c.r * 0.45, c.g * 0.45, c.b * 0.45, 1)
      fg = Color4.create(c.r,        c.g,         c.b,        1)
      break
    case 'pending':
      bg = Color4.create(c.r * 0.12, c.g * 0.12, c.b * 0.12, 1)
      fg = Color4.create(c.r * 0.55, c.g * 0.55, c.b * 0.55, inverted ? 1 : 0.8)
      break
    case 'failed':
      bg = Color4.create(0.25, 0.06, 0.06, 1)
      fg = Color4.create(0.55, 0.18, 0.18, 0.6)
      break
  }

  return (
    <UiEntity
      uiTransform={{
        width: boxSize,
        height: boxSize,
        margin: { left: mobile ? 2 : 3, right: mobile ? 2 : 3 },
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 1,
        borderRadius: mobile ? 8 : 10,
        borderWidth: state === 'active' ? 2 : 1,
        borderColor: Color4.create(fg.r, fg.g, fg.b, state === 'active' ? 0.90 : 0.36),
      }}
      uiBackground={{ color: bg }}
    >
      {arrowTexture ? (
        <UiEntity
          uiTransform={{ width: mobile ? 38 : 42, height: mobile ? 38 : 42, pointerFilter: 'none' }}
          uiBackground={{ texture: { src: arrowTexture }, textureMode: 'stretch', color: fg }}
        />
      ) : (
        <Label value={sym} font="sans-serif" fontSize={mobile ? 33 : 36} color={fg}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} textAlign="middle-center" />
      )}
      {sparkleProgress !== undefined ? [
        { x: 0, y: -1 },
        { x: 0.71, y: -0.71 },
        { x: 1, y: 0 },
        { x: 0.71, y: 0.71 },
        { x: 0, y: 1 },
        { x: -0.71, y: 0.71 },
        { x: -1, y: 0 },
        { x: -0.71, y: -0.71 },
      ].map((sparkle, index) => {
        const distance = boxSize * 0.40 + sparkleProgress * (mobile ? 25 : 31)
        const sparkleSize = (mobile ? 17 : 21) - sparkleProgress * (mobile ? 7 : 9)
        const center = boxSize / 2
        const alpha = Math.max(0, 1 - sparkleProgress) ** 1.35
        return (
        <Label
          key={`sequence-spark-${index}`}
          value={index % 3 === 0 ? '★' : index % 2 === 0 ? '✦' : '◆'}
          fontSize={sparkleSize}
          color={Color4.create(
            c.r + (HIT_COLOR.r - c.r) * sparkleProgress,
            c.g + (HIT_COLOR.g - c.g) * sparkleProgress,
            c.b + (HIT_COLOR.b - c.b) * sparkleProgress,
            alpha,
          )}
          uiTransform={{
            positionType: 'absolute',
            position: {
              left: center + sparkle.x * distance - sparkleSize / 2,
              top: center + sparkle.y * distance - sparkleSize / 2,
            },
            width: sparkleSize,
            height: sparkleSize,
            pointerFilter: 'none',
          }}
          textAlign="middle-center"
        />
        )
      }) : null}
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Keynote bar — the row of arrows to type
// ──────────────────────────────────────────────────────────
function KeynoteBar(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const seq   = gameState.currentSequence
  const idx   = gameState.inputIndex
  const failed = gameState.sequenceFailed
  const wrongInputFlash = arrowInputFeedback.timer > 0 && !arrowInputFeedback.correct
  const correctSparkleProgress = arrowInputFeedback.correct && arrowInputFeedback.timer > 0
    ? 1 - arrowInputFeedback.timer / arrowInputFeedback.duration
    : undefined
  const height = gameState.roundState === 'waiting' ? 58 : 76
  const isFinalMove = gameState.measureCount >= TOTAL_MEASURES - 1
  const hasReverseMechanic = gameState.roundMode === 'freestyle' || isFinalMove
  const waitingLabel = isFinalMove
    ? `RED ARROW: PRESS OPPOSITE  ${Math.ceil(gameState.waitTimer)}`
    : hasReverseMechanic
      ? `RED ARROWS: PRESS OPPOSITE  ${Math.ceil(gameState.waitTimer)}`
      : `NEXT COMBO  ${Math.ceil(gameState.waitTimer)}`

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: mobile ? 112 : 126, left: 0 },
        width: '100%',
        height,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {gameState.roundState === 'waiting' ? (
        <Label
          value={waitingLabel}
          fontSize={hasReverseMechanic ? (mobile ? 21 : 25) : 30}
          color={hasReverseMechanic ? REVERSE_COLOR : HIT_COLOR}
          uiTransform={{ width: '100%', height: 52, alignItems: 'center', justifyContent: 'center' }}
          textAlign="middle-center"
        />
      ) : seq.map((step, i) => {
        let state: 'done' | 'active' | 'pending' | 'failed'
        if (wrongInputFlash) state = 'failed'
        else if (i < idx)    state = 'done'
        else if (failed)     state = 'failed'
        else if (i === idx)  state = 'active'
        else                 state = 'pending'
        const sparkleProgress = i === arrowInputFeedback.sequenceIndex ? correctSparkleProgress : undefined
        return <ArrowBox displayDirection={step.displayDirection} inputDirection={step.inputDirection} inverted={step.inverted} state={state} sparkleProgress={sparkleProgress} />
      })}
      {gameState.roundState === 'active' && hasReverseMechanic ? (
        <Label
          value="RED ARROWS = PRESS OPPOSITE"
          fontSize={mobile ? 16 : 15}
          color={REVERSE_COLOR}
          uiTransform={{
            positionType: 'absolute',
            position: { top: -18, left: 0 },
            width: '100%',
            height: 20,
            pointerFilter: 'none',
          }}
          textAlign="middle-center"
        />
      ) : null}
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Rhythm timeline — moving ball + judgment zone
// ──────────────────────────────────────────────────────────
function RhythmTimeline(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const p = gameState.spacePressed ? gameState.hitMarkerProgress : gameState.measureProgress
  const spaceWindow = getSpaceWindow()
  const markerVisible = !gameState.spacePressed || gameState.spaceFlash > 0.25

  // How close is the ball to the judgment center? (0 = far, 1 = perfect)
  const distFromCenter  = Math.abs(p - JUDGMENT_CENTER)
  const jPulse          = Math.max(0, 1 - distFromCenter / 0.18)  // 1 at center, 0 outside ±0.18

  // The marker turns gold inside the score zone while the zone itself previews judgment quality.
  const inZone = p >= spaceWindow.start && p <= spaceWindow.end
  const ballColor = inZone
    ? Color4.create(1.0, 0.7 + jPulse * 0.3, 0.1 + jPulse * 0.1, 1)
    : Color4.create(0.4, 0.7, 1.0, 1)
  const markerAlpha = gameState.spacePressed ? Math.max(0, (gameState.spaceFlash - 0.25) / 0.75) : 1
  const markerColor = Color4.create(ballColor.r, ballColor.g, ballColor.b, markerAlpha)
  const judgmentProgress = gameState.judgment
    ? 1 - gameState.judgment.timer / gameState.judgment.totalDuration
    : 0
  const showJudgmentSparkles = !!gameState.judgment && gameState.judgment.text !== 'MISS!'

  const visualZoneWidth = Math.max(spaceWindow.end - spaceWindow.start, 0.14)
  const visualZoneStart = Math.max(0, Math.min(1 - visualZoneWidth, JUDGMENT_CENTER - visualZoneWidth / 2))
  const jZoneLeft = `${(visualZoneStart * 100).toFixed(2)}%` as PercentUnit
  const jZoneWidth = `${(visualZoneWidth * 100).toFixed(2)}%` as PercentUnit
  const ballLeftPct = `${(p * 100).toFixed(2)}%` as PercentUnit

  // Space key: "hit" if space already pressed this measure
  const spaceFlash = gameState.spaceFlash
  const spaceColor = Color4.create(1, 0.9 + spaceFlash * 0.1, 0.2 + spaceFlash * 0.3, 0.6 + spaceFlash * 0.4)
  const hitLabel = mobile ? 'TAP ★' : 'TAP SPACE'

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: mobile
          ? { top: 174, left: '23%' }
          : { top: 204, left: 350, right: 305 },
        width: mobile ? '54%' : undefined,
        minWidth: mobile ? undefined : 420,
        height: mobile ? 78 : 82,
        flexDirection: 'column',
        borderRadius: 12,
      }}
    >
      {/* Row: labels above the track */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: mobile ? 28 : 28,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          margin: { bottom: 5 },
        }}
      >
        <Label
          value="TYPE SEQUENCE →"
          fontSize={mobile ? 23 : 18}
          color={Color4.create(0.10, 0.86, 1.0, 1)}
          uiTransform={{ width: mobile ? '52%' : 180, height: '100%' }}
          textAlign="middle-left"
        />
        <Label
          value={`← ${hitLabel}`}
          fontSize={mobile ? 22 : 18}
          color={spaceColor}
          uiTransform={{ width: mobile ? '46%' : 160, height: '100%' }}
          textAlign="middle-right"
        />
      </UiEntity>

      {/* Track */}
      <UiEntity
        uiTransform={{ width: '100%', height: mobile ? 38 : 42, positionType: 'relative', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: Color4.create(0.38, 0.56, 0.94, 0.66) }}
        uiBackground={{ color: Color4.create(0.04, 0.04, 0.10, 0.92) }}
      >
        {/* Continuous score gradient from GOOD at the edges to PERFECT at center. */}
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { top: 0, left: jZoneLeft },
            width: jZoneWidth,
            height: '100%',
            overflow: 'hidden',
          }}
          uiBackground={{ texture: { src: JUDGMENT_GRADIENT }, textureMode: 'stretch' }}
        />

        {/* Freeze briefly at the pressed position, then disappear. */}
        {markerVisible ? (
          <UiEntity
            uiTransform={{
              positionType: 'absolute',
              position: { top: mobile ? 5 : 6, left: ballLeftPct },
              width: mobile ? 28 : 30,
              height: mobile ? 28 : 30,
              borderRadius: 15,
            }}
            uiBackground={{ color: markerColor }}
          />
        ) : null}
        {showJudgmentSparkles && gameState.judgment ? (
          <UiEntity
            uiTransform={{
              positionType: 'absolute',
              position: { top: 0, left: ballLeftPct },
              width: 1,
              height: mobile ? 38 : 42,
              pointerFilter: 'none',
              zIndex: 4,
            }}
          >
            <SparkleBurst
              progress={judgmentProgress}
              color={judgmentAccent(gameState.judgment.text)}
              width={1}
              height={mobile ? 38 : 42}
              distance={mobile ? 42 : 56}
              count={10}
            />
          </UiEntity>
        ) : null}
      </UiEntity>
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Judgment text (fades out)
// ──────────────────────────────────────────────────────────
function JudgmentDisplay(): ReactEcs.JSX.Element | null {
  if (!gameState.judgment) return null
  if (gameState.playMode === 'multiplayer') return null

  const mobile = isMobile()
  const { text, timer, totalDuration } = gameState.judgment
  const rawProgress = 1 - Math.min(1, timer / totalDuration)
  const intro = Math.min(1, rawProgress / 0.12)
  const outro = rawProgress < 0.75 ? 1 : Math.max(0, 1 - (rawProgress - 0.75) / 0.25)
  const fade = intro * outro
  const progress = rawProgress
  const popScale = judgmentPopScale(rawProgress)
  const graphicWidth = mobile ? 390 : 560
  const graphicHeight = mobile ? 95 : 137
  const renderedWidth = graphicWidth * popScale
  const renderedHeight = graphicHeight * popScale
  const hasSparkles = text !== 'MISS!'

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: mobile ? '46%' : '48%', left: '20%' },
        width: '60%',
        height: mobile ? 120 : 170,
        alignItems: 'center',
        justifyContent: 'center',
        pointerFilter: 'none',
      }}
    >
      <UiEntity
        uiTransform={{
          width: renderedWidth,
          height: renderedHeight,
          positionType: 'relative',
          pointerFilter: 'none',
        }}
      >
        {hasSparkles ? (
          <SparkleBurst
            progress={progress}
            color={judgmentAccent(text)}
            width={renderedWidth}
            height={renderedHeight}
            distance={mobile ? 76 : 108}
            count={14}
          />
        ) : null}
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { top: 0, left: 0 },
            width: renderedWidth,
            height: renderedHeight,
            pointerFilter: 'none',
            zIndex: 2,
          }}
          uiBackground={{
            texture: { src: JUDGMENT_TEXTURES[text] },
            textureMode: 'stretch',
          }}
        />
        {text === 'PERFECT!' && gameState.combo > 1 ? (
          <Label
            value={`${gameState.combo}x`}
            font="serif"
            fontSize={(mobile ? 44 : 66) * popScale}
            color={Color4.create(0.18, 0.82, 1.0, fade)}
            uiTransform={{
              positionType: 'absolute',
              position: { top: mobile ? renderedHeight * 0.54 : renderedHeight * 0.56, left: renderedWidth * 0.69 },
              width: renderedWidth * 0.30,
              height: renderedHeight * 0.34,
              pointerFilter: 'none',
              zIndex: 3,
            }}
            textAlign="middle-left"
          />
        ) : null}
      </UiEntity>
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Score panel (top right)
// ──────────────────────────────────────────────────────────
function ScorePanel(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const pointsWidth = mobile ? 160 : 190
  const pointsHeight = mobile ? 42 : 48
  const scoreDigits = String(gameState.score).length
  const scoreFontSize = mobile
    ? scoreDigits >= 8 ? 24 : scoreDigits >= 6 ? 27 : 30
    : scoreDigits >= 9 ? 28 : scoreDigits >= 7 ? 31 : 35

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: mobile ? { top: 72, right: 12 } : { top: 76, right: 24 },
        width: mobile ? 190 : 225,
        height: mobile ? 104 : 116,
        flexDirection: 'column',
        alignItems: 'flex-end',
        padding: { top: mobile ? 8 : 9, right: mobile ? 12 : 14, bottom: 8, left: 10 },
        borderRadius: 14,
        borderWidth: 1,
        borderColor: Color4.create(0.30, 0.78, 1.0, 0.70),
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
    >
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: -pointsHeight * 0.30, right: mobile ? 9 : 12 },
          width: pointsWidth,
          height: pointsHeight,
          zIndex: 3,
          pointerFilter: 'none',
        }}
      >
        <CroppedMenuTitleImage src={POINTS_TITLE} width={pointsWidth} height={pointsHeight} bounds={POINTS_TITLE_BOUNDS} />
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: mobile ? 25 : 29, flexShrink: 0, pointerFilter: 'none' }} />
      <Label
        key={`score-${gameState.score}`}
        value={String(gameState.score)}
        font="sans-serif"
        fontSize={scoreFontSize}
        color={Color4.create(1.0, 0.88, 0.18, 1)}
        uiTransform={{ width: '100%', height: mobile ? 34 : 40, flexShrink: 0 }}
        textAlign="middle-right"
        textWrap="nowrap"
      />
      <Label
        value={`MAX PERFECT COMBO  ${gameState.maxCombo}`}
        fontSize={mobile ? 12 : 14}
        color={Color4.create(0.82, 0.82, 0.90, 1)}
        uiTransform={{ width: '100%', height: mobile ? 18 : 20 }}
        textAlign="middle-right"
      />
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Combo display (top left)
// ──────────────────────────────────────────────────────────
function ComboDisplay(): ReactEcs.JSX.Element | null {
  if (gameState.combo < 2) return null
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 16, left: 24 },
        width: 130,
        height: 88,
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: { top: 10, left: 14 },
        borderRadius: 14,
        borderWidth: 1,
        borderColor: Color4.create(0.18, 0.82, 1.0, 0.68),
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
    >
      <Label
        value="COMBO"
        fontSize={12}
        color={Color4.create(0.55, 0.55, 0.55, 1)}
        uiTransform={{ width: '100%', height: 18 }}
        textAlign="middle-left"
      />
      <Label
        value={String(gameState.combo)}
        fontSize={44}
        color={Color4.create(0.18, 0.82, 1.0, 1)}
        uiTransform={{ width: '100%', height: 50 }}
        textAlign="middle-left"
      />
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Current difficulty / mode badge
// ──────────────────────────────────────────────────────────
function ModeBadge(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const safe = getSafeCanvas()
  const title = getLevelTitleKey(gameState.roundMode, gameState.measureCount >= TOTAL_MEASURES - 1)
  const color = title === 'final' ? Color4.create(0.2, 0.9, 1, 1) :
    title === 'easy' ? Color4.create(0.4, 1, 0.55, 1) :
    title === 'intermediate' ? Color4.create(0.35, 0.7, 1, 1) :
    title === 'reverse' ? Color4.create(1, 0.2, 0.2, 1) : Color4.create(1, 0.55, 0.15, 1)
  const width = Math.min(620, safe.width * (mobile ? 0.66 : 0.48))
  const height = mobile ? 58 : 62
  const comboWidth = gameState.combo > 1 ? Math.min(64, width * 0.18) : 0
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { top: safe.top, left: 0 }, width: '100%', height, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width, height, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 8, borderRadius: 14, borderWidth: 1, borderColor: Color4.create(color.r, color.g, color.b, 0.62), pointerFilter: 'none' }} uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}>
      <LevelTitleImage title={title} width={width - 18 - comboWidth} height={height - 18} />
      {comboWidth > 0 ? <Label value={`${gameState.combo}x`} fontSize={Math.min(24, comboWidth / 2.2)} color={Color4.create(0.18, 0.82, 1, 1)} uiTransform={{ width: comboWidth, height: '100%', flexShrink: 0, pointerFilter: 'none' }} textAlign="middle-right" /> : null}
    </UiEntity>
  </UiEntity>
}

// ──────────────────────────────────────────────────────────
// Measure progress bar (thin strip at top)
// ──────────────────────────────────────────────────────────
function MeasureBar(): ReactEcs.JSX.Element {
  const pct = `${((gameState.measureCount / TOTAL_MEASURES) * 100).toFixed(1)}%` as PercentUnit
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: 6,
      }}
      uiBackground={{ color: Color4.create(0.06, 0.06, 0.12, 1) }}
    >
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: pct, height: '100%' }}
        uiBackground={{ color: Color4.create(0.35, 0.6, 1.0, 0.85) }}
      />
    </UiEntity>
  )
}

function placementLabel(index: number): string {
  return `${index + 1}º`
}

function PlacementGradientLabel({ value, highlight, mobile }: { value: string; highlight: boolean; mobile: boolean }): ReactEcs.JSX.Element {
  const size = mobile ? 46 : 56
  const glowColor = highlight
    ? Color4.create(1.0, 0.62, 0.12, 0.35)
    : Color4.create(0.0, 0.82, 1.0, 0.36)
  const baseColor = highlight
    ? Color4.create(1.0, 0.34, 0.74, 0.95)
    : Color4.create(0.48, 0.38, 1.0, 0.95)
  const topColor = highlight
    ? Color4.create(1.0, 0.86, 0.18, 1)
    : Color4.create(0.42, 0.92, 1.0, 1)

  return (
    <UiEntity uiTransform={{ width: mobile ? 78 : 94, height: mobile ? 60 : 70, positionType: 'relative', pointerFilter: 'none' }}>
      <Label
        value={value}
        fontSize={size + 5}
        color={glowColor}
        uiTransform={{ positionType: 'absolute', position: { top: 2, left: -1 }, width: '100%', height: '100%' }}
        textAlign="middle-left"
      />
      <Label
        value={value}
        fontSize={size}
        color={baseColor}
        uiTransform={{ positionType: 'absolute', position: { top: 2, left: 1 }, width: '100%', height: '100%' }}
        textAlign="middle-left"
      />
      <Label
        value={value}
        fontSize={size}
        color={topColor}
        uiTransform={{ positionType: 'absolute', position: { top: -2, left: 0 }, width: '100%', height: '100%' }}
        textAlign="middle-left"
      />
    </UiEntity>
  )
}

function getActiveMatchEntries() {
  const matchEntries = gameState.matchPlayers.filter(player =>
    player.ready && (player.phase === 'playing' || player.phase === 'gameover')
  )

  if (matchEntries.length > 0) return matchEntries.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.maxCombo !== a.maxCombo) return b.maxCombo - a.maxCombo
    return a.name.localeCompare(b.name)
  })

  return [{
      playerId: 'local-player',
      name: 'YOU',
      score: gameState.score,
      maxCombo: gameState.maxCombo,
      rankPoints: gameState.rankPoints,
      wins: 0,
      matchesPlayed: 0,
      slotIndex: 0,
      finished: false,
      ready: true,
      phase: gameState.phase,
      matchStartTime: 0,
      judgmentText: '' as const,
      judgmentCombo: 0,
      judgmentSentAt: 0,
      judgmentTimer: 0,
      isLocal: true,
      lastSeen: Date.now(),
    }]
}

function MatchPositionPanel(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const entries = getActiveMatchEntries()
  const localIndex = Math.max(0, entries.findIndex(entry => entry.isLocal))
  const localEntry = entries[localIndex] || entries[0]
  const score = localEntry?.score ?? gameState.score
  const place = placementLabel(localIndex)

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: mobile ? { top: 18, right: 14 } : { top: 20, right: 28 },
        width: mobile ? 178 : 220,
        height: mobile ? 78 : 88,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        pointerFilter: 'none',
      }}
    >
      <PlacementGradientLabel value={place} highlight={localIndex === 0} mobile={mobile} />
      <UiEntity uiTransform={{ width: mobile ? 92 : 114, height: mobile ? 64 : 74, flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }}>
        <CroppedMenuTitleImage
          src={POINTS_TITLE}
          width={mobile ? 90 : 112}
          height={mobile ? 25 : 30}
          bounds={POINTS_TITLE_BOUNDS}
        />
        <UiEntity
          key={`match-score-${score}`}
          uiTransform={{ width: '100%', height: mobile ? 36 : 42, positionType: 'relative', pointerFilter: 'none' }}
        >
          <Label
            value={String(score)}
            font="sans-serif"
            fontSize={mobile ? 30 : 36}
            color={Color4.create(1.0, 0.08, 0.62, 1)}
            uiTransform={{ positionType: 'absolute', position: { top: 0, left: 1 }, width: '100%', height: '100%', pointerFilter: 'none' }}
            textAlign="middle-left"
          />
          <Label
            value={String(score)}
            font="sans-serif"
            fontSize={mobile ? 30 : 36}
            color={Color4.create(1.0, 0.08, 0.62, 1)}
            uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}
            textAlign="middle-left"
          />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

function ReadyPlayersPanel({ width = Math.min(650, getSafeCanvas().width - 32), height = isMobile() ? 204 : 304 }: { width?: number; height?: number } = {}): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const readyPlayers = gameState.matchPlayers
    .filter(player => player.ready && player.phase === 'ready')
    .sort((a, b) => {
      if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
      return a.name.localeCompare(b.name)
    })
    .slice(0, 20)

  const columns = Math.max(1, Math.min(4, Math.floor(width / 126)))
  const visibleRows = mobile || height < 270 ? 1 : 2
  const rowHeight = Math.max(24, (height - (mobile ? 56 : 62)) / visibleRows - (mobile ? 5 : 6))
  const scale = Math.min(1.2, rowHeight / (mobile ? 110 : 96))
  const playerWidth = 100 * scale
  const capacity = columns * visibleRows
  const pageCount = Math.max(1, Math.ceil(readyPlayers.length / capacity))
  const page = readyPlayers.length > capacity ? Math.floor(Date.now() / 3500) % pageCount : 0
  const pagePlayers = readyPlayers.slice(page * capacity, page * capacity + capacity)
  const rows = Array.from({ length: visibleRows }, (_, row) => pagePlayers.slice(row * columns, row * columns + columns))
  const panelTitle = !mobile && pageCount > 1
    ? `PLAYERS JOINED  ${readyPlayers.length}/20  ${page + 1}/${pageCount}`
    : `PLAYERS JOINED  ${readyPlayers.length}/20`
  const scrollThumbWidth = 100 / pageCount
  const scrollThumbLeft = pageCount > 1
    ? page * ((100 - scrollThumbWidth) / (pageCount - 1))
    : 0

  return (
    <UiEntity
      uiTransform={{
        width,
        height,
        flexShrink: 0,
        flexDirection: 'column',
        padding: mobile
          ? { top: 8, right: 8, bottom: 8, left: 8 }
          : { top: 12, right: 12, bottom: 12, left: 12 },
      }}
    >
      <Label
        value={panelTitle}
        fontSize={mobile ? 19 : 20}
        color={Color4.create(0.40, 1.0, 0.85, 1)}
        uiTransform={{ width: '100%', height: mobile ? 24 : 30, margin: { bottom: mobile ? 6 : 8 } }}
        textAlign="middle-center"
      />

      {readyPlayers.length === 0 ? (
        <Label
          value="Waiting for dancers"
          fontSize={16}
          color={Color4.create(0.72, 0.72, 0.82, 1)}
          uiTransform={{ width: '100%', height: 52 }}
          textAlign="middle-center"
        />
      ) : null}

      {rows.map((row, rowIndex) => (
        <UiEntity
          key={`ready-row-${rowIndex}`}
          uiTransform={{ width: '100%', height: rowHeight, flexShrink: 0, flexDirection: 'row', justifyContent: 'center', margin: { bottom: mobile ? 5 : 6 } }}
        >
          {row.map((player, i) => (
            <UiEntity
              key={`ready-${player.playerId}-${i}`}
              uiTransform={{
                width: playerWidth,
                height: rowHeight,
                flexShrink: 0,
                flexDirection: 'column',
                alignItems: 'center',
                margin: { left: mobile ? 2 : 3, right: mobile ? 2 : 3 },
              }}
            >
              <UiEntity
                uiTransform={{ width: (mobile ? 40 : 32) * scale, height: (mobile ? 40 : 32) * scale, flexShrink: 0, margin: { top: 2, bottom: 2 } }}
                uiBackground={{ avatarTexture: { userId: player.playerId }, textureMode: 'stretch' }}
              />
              <Label
                value={player.isLocal ? 'YOU' : String(player.name).slice(0, 8)}
                fontSize={(mobile ? 13 : 10) * scale}
                color={Color4.create(0.92, 0.92, 1, 1)}
                uiTransform={{ width: '100%', height: 16 * scale, flexShrink: 0 }}
                textAlign="middle-center"
              />
              <RankLabelImage points={player.rankPoints} width={94 * scale} height={26 * scale} />
              <Label
                value={`${player.rankPoints} RP`}
                fontSize={(mobile ? 13 : 10) * scale}
                color={Color4.create(1.0, 0.82, 0.22, 1)}
                uiTransform={{ width: '100%', height: 14 * scale, flexShrink: 0 }}
                textAlign="middle-center"
              />
            </UiEntity>
          ))}
        </UiEntity>
      ))}

      {mobile && pageCount > 1 ? (
        <UiEntity
          uiTransform={{
            width: '76%',
            height: 10,
            positionType: 'relative',
            alignSelf: 'center',
            borderRadius: 5,
            overflow: 'hidden',
            pointerFilter: 'none',
          }}
          uiBackground={{ color: Color4.create(0.18, 0.22, 0.32, 0.92) }}
        >
          <UiEntity
            uiTransform={{
              positionType: 'absolute',
              position: { top: 0, left: `${scrollThumbLeft}%` as PercentUnit },
              width: `${scrollThumbWidth}%` as PercentUnit,
              height: '100%',
              borderRadius: 5,
              pointerFilter: 'none',
            }}
            uiBackground={{ color: Color4.create(0.40, 1.0, 0.85, 0.96) }}
          />
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}

function RankAvatarBadge(): ReactEcs.JSX.Element {
  const panelLeft = isMobile() ? 18 : 64
  const badgeSize = Math.min(198, Math.max(87.5, getSafeCanvas().height * 0.3375))

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 132, left: panelLeft },
        width: 248,
        height: badgeSize + 42,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: { top: 6, right: 10, bottom: 6, left: 10 },
      }}
    >
      <RankBadgeImage points={gameState.rankPoints} size={badgeSize} />
      <Label
        value={`RP ${gameState.rankPoints}`}
        fontSize={22}
        color={Color4.White()}
        uiTransform={{ width: '100%', height: 30, flexShrink: 0 }}
        textAlign="middle-center"
      />
    </UiEntity>
  )
}

function DailyGoalsPanel(): ReactEcs.JSX.Element {
  const rankPct = `${(gameState.rankProgress * 100).toFixed(1)}%` as PercentUnit
  const panelLeft = isMobile() ? 18 : 64
  const badgeSize = Math.min(198, Math.max(87.5, getSafeCanvas().height * 0.3375))

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 132 + badgeSize + 52, left: panelLeft },
        width: 210,
        height: 134,
        flexDirection: 'column',
        padding: { top: 8, right: 10, bottom: 8, left: 10 },
        borderRadius: 12,
        borderWidth: 1,
        borderColor: Color4.create(0.34, 0.70, 1.0, 0.50),
      }}
      uiBackground={{ color: Color4.create(0.02, 0.02, 0.07, 0.62) }}
    >
      <UiEntity uiTransform={{ width: '100%', height: 18, margin: { bottom: 4 }, alignItems: 'flex-start', justifyContent: 'center', pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ width: 18 * DAILY_GOALS_TITLE_ASPECT, height: 18, pointerFilter: 'none' }}
          uiBackground={{ texture: { src: DAILY_GOALS_TITLE }, textureMode: 'stretch' }} />
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: 10, margin: { bottom: 7 } }} uiBackground={{ color: Color4.create(0.08, 0.08, 0.16, 0.95) }}>
        <UiEntity uiTransform={{ width: rankPct, height: '100%' }} uiBackground={{ color: Color4.create(0.9, 0.25, 1, 0.9) }} />
      </UiEntity>

      {gameState.dailyGoals.map(goal => {
        const progress = `${goal.progress}/${goal.target}`
        return (
          <UiEntity
            key={goal.id}
            uiTransform={{ width: '100%', height: 25, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Label
              value={goal.completed ? `${goal.label} DONE` : goal.label}
              fontSize={14}
              color={goal.completed ? Color4.create(0.42, 1, 0.58, 1) : Color4.create(0.82, 0.82, 0.9, 1)}
              uiTransform={{ width: 135, height: 24 }}
              textAlign="middle-left"
            />
            <Label
              value={goal.completed ? `+${goal.rewardRp} RP` : progress}
              fontSize={14}
              color={Color4.create(1, 0.82, 0.22, 1)}
              uiTransform={{ width: 55, height: 24 }}
              textAlign="middle-right"
            />
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}

function DailyGoalsMenuCard({ compact = false, width, height, transparent = false }: { compact?: boolean; width?: number; height?: number; transparent?: boolean }): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const rankPct = `${(gameState.rankProgress * 100).toFixed(1)}%` as PercentUnit
  const cardHeight = height ?? (compact ? (mobile ? 154 : 144) : mobile ? 190 : 158)
  const titleHeight = Math.min(mobile ? 34 : compact ? 22 : 30, cardHeight * (mobile ? 0.22 : 0.20))
  const verticalPadding = mobile ? 12 : compact ? 12 : 16
  const progressHeight = mobile ? 8 : compact ? 6 : 8
  const progressMargin = mobile ? 6 : compact ? 4 : 6
  const rowHeight = Math.min(mobile ? 38 : compact ? 28 : 30, (cardHeight - titleHeight - verticalPadding - progressHeight - progressMargin) / 3)
  const contentWidth = (width ?? (compact ? 226 : Math.min(410, getSafeCanvas().width - 48))) - (mobile ? 24 : 20)

  return (
    <UiEntity
      uiTransform={{
        width: width ?? (compact ? '100%' : mobile ? '90%' : 410),
        height: cardHeight,
        flexShrink: 0,
        flexDirection: 'column',
        padding: compact
          ? { top: mobile ? 6 : 6, right: mobile ? 10 : 6, bottom: mobile ? 6 : 6, left: mobile ? 10 : 6 }
          : { top: mobile ? 7 : 8, right: mobile ? 12 : 10, bottom: mobile ? 7 : 8, left: mobile ? 12 : 10 },
        margin: { bottom: height ? 0 : compact ? (mobile ? 7 : 10) : mobile ? 6 : 14 },
        borderRadius: mobile ? 14 : 10,
        borderWidth: transparent ? 0 : mobile ? 1 : 0,
        borderColor: Color4.create(0.30, 0.78, 1.0, transparent ? 0 : mobile ? 0.58 : 0),
      }}
      uiBackground={{ color: Color4.create(0.015, 0.02, 0.075, transparent ? 0 : mobile ? 0.92 : 0) }}
    >
      <UiEntity uiTransform={{ width: '100%', height: titleHeight, alignItems: 'flex-start', justifyContent: 'center', pointerFilter: 'none' }}>
        <UiEntity
          uiTransform={{ width: Math.min(contentWidth, titleHeight * DAILY_GOALS_TITLE_ASPECT), height: Math.min(titleHeight, contentWidth / DAILY_GOALS_TITLE_ASPECT), pointerFilter: 'none' }}
          uiBackground={{ texture: { src: DAILY_GOALS_TITLE }, textureMode: 'stretch' }}
        />
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: compact ? 6 : mobile ? 6 : 8, margin: { bottom: compact ? 4 : mobile ? 3 : 6 } }} uiBackground={{ color: Color4.create(0.08, 0.08, 0.16, 0.95) }}>
        <UiEntity uiTransform={{ width: rankPct, height: '100%' }} uiBackground={{ color: Color4.create(0.9, 0.25, 1, 0.9) }} />
      </UiEntity>

      {gameState.dailyGoals.map(goal => {
        const shortMobileLabel = mobile ? goal.label.replace(/^\d+(?:x)?\s+/, '') : goal.label
        const displayLabel = goal.completed
          ? mobile ? `✓ ${shortMobileLabel}` : `${shortMobileLabel} DONE`
          : shortMobileLabel
        const progressText = goal.completed ? `+${goal.rewardRp} RP` : `${goal.progress}/${goal.target}`
        const labelWidth = mobile ? 0.58 : compact ? 0.64 : 0.70
        const progressWidth = mobile ? 0.40 : compact ? 0.34 : 0.28
        const labelFont = Math.min(
          mobile ? 21 : compact ? 15 : 17,
          rowHeight * (mobile ? 0.72 : 0.78),
          contentWidth * labelWidth / Math.max(6, displayLabel.length * 0.56),
        )
        const progressFont = Math.min(
          mobile ? 20 : compact ? 15 : 17,
          rowHeight * (mobile ? 0.68 : 0.78),
          contentWidth * progressWidth / Math.max(4, progressText.length * 0.58),
        )
        return (
          <UiEntity
            key={`menu-${goal.id}`}
            uiTransform={{ width: '100%', height: rowHeight, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Label
              value={displayLabel}
              fontSize={mobile ? Math.max(14, labelFont) : labelFont}
              color={goal.completed ? Color4.create(0.42, 1, 0.58, 1) : Color4.create(0.88, 0.90, 1, 1)}
              uiTransform={{ width: mobile ? '58%' : compact ? '64%' : '70%', height: '100%' }}
              textAlign="middle-left"
              textWrap="nowrap"
            />
            <Label
              value={progressText}
              fontSize={progressFont}
              color={Color4.create(1, 0.82, 0.22, 1)}
              uiTransform={{ width: mobile ? '40%' : compact ? '34%' : '28%', height: '100%' }}
              textAlign="middle-right"
              textWrap="nowrap"
            />
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}

function MobileTapEffect({
  flash,
  size,
  tone,
  gradientTone,
  x = 0,
  y = 0,
  correct = true,
}: {
  flash: number
  size: number
  tone: Color4
  gradientTone: ButtonTone
  x?: number
  y?: number
  correct?: boolean
}): ReactEcs.JSX.Element | null {
  if (flash <= 0.01) return null

  const progress = 1 - flash
  const feedbackTone = correct
    ? Color4.create(
      tone.r + (HIT_COLOR.r - tone.r) * progress,
      tone.g + (HIT_COLOR.g - tone.g) * progress,
      tone.b + (HIT_COLOR.b - tone.b) * progress,
      1,
    )
    : REVERSE_COLOR
  const feedbackGradient = correct ? gradientTone : 'red'
  const glowSize = size + 30 + progress * 42
  const glowOffset = (size - glowSize) / 2
  const innerGlowSize = size + 12 + progress * 18
  const innerGlowOffset = (size - innerGlowSize) / 2
  const sparkleDistance = size * 0.50 + progress * 44
  const sparkleSize = 22 - progress * 7
  const sparkleAlpha = Math.min(1, flash * 1.45)
  const center = size / 2
  const sparkles = [
    { x: 0, y: -1 },
    { x: 0.87, y: -0.5 },
    { x: 0.87, y: 0.5 },
    { x: 0, y: 1 },
    { x: -0.87, y: 0.5 },
    { x: -0.87, y: -0.5 },
  ]

  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: y, left: x }, width: size, height: size, pointerFilter: 'none' }}>
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: glowOffset, left: glowOffset },
          width: glowSize,
          height: glowSize,
          borderRadius: Math.floor(glowSize / 2),
          borderWidth: 9,
          borderColor: Color4.create(feedbackTone.r, feedbackTone.g, feedbackTone.b, flash),
          pointerFilter: 'none',
        }}
        uiBackground={{ color: Color4.create(feedbackTone.r, feedbackTone.g, feedbackTone.b, flash * 0.24) }}
      />
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: innerGlowOffset, left: innerGlowOffset },
          width: innerGlowSize,
          height: innerGlowSize,
          borderRadius: Math.floor(innerGlowSize / 2),
          borderWidth: 5,
          borderColor: Color4.create(1, 1, 1, flash * 0.92),
          overflow: 'hidden',
          pointerFilter: 'none',
        }}
        uiBackground={{ texture: { src: BUTTON_TEXTURES[feedbackGradient] }, textureMode: 'stretch', color: Color4.create(feedbackTone.r, feedbackTone.g, feedbackTone.b, flash * 0.82) }}
      />
      {correct ? sparkles.map((sparkle, index) => (
        <UiEntity
          key={`tap-spark-${index}`}
          uiTransform={{
            positionType: 'absolute',
            position: {
              left: center + sparkle.x * sparkleDistance - sparkleSize / 2,
              top: center + sparkle.y * sparkleDistance - sparkleSize / 2,
            },
            width: sparkleSize,
            height: sparkleSize,
            pointerFilter: 'none',
          }}
        >
          <Label
            value={index % 2 === 0 ? '✦' : '◆'}
            fontSize={sparkleSize}
            color={index % 2 === 0 ? Color4.create(1, 1, 1, sparkleAlpha) : Color4.create(feedbackTone.r, feedbackTone.g, feedbackTone.b, sparkleAlpha)}
            uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}
            textAlign="middle-center"
          />
        </UiEntity>
      )) : null}
    </UiEntity>
  )
}

function MobileScreenIrradiation(): ReactEcs.JSX.Element | null {
  const wrongDirection = arrowInputFeedback.timer > 0 && !arrowInputFeedback.correct
    ? arrowInputFeedback.direction
    : null
  const pulses = [
    { flash: mobileTapFeedback.left, tone: wrongDirection === 'left' ? REVERSE_COLOR : DIR_COLOR.left, gradientTone: (wrongDirection === 'left' ? 'red' : 'magenta') as ButtonTone },
    { flash: mobileTapFeedback.down, tone: wrongDirection === 'down' ? REVERSE_COLOR : DIR_COLOR.down, gradientTone: (wrongDirection === 'down' ? 'red' : 'magenta') as ButtonTone },
    { flash: mobileTapFeedback.up, tone: wrongDirection === 'up' ? REVERSE_COLOR : DIR_COLOR.up, gradientTone: (wrongDirection === 'up' ? 'red' : 'cyan') as ButtonTone },
    { flash: mobileTapFeedback.right, tone: wrongDirection === 'right' ? REVERSE_COLOR : DIR_COLOR.right, gradientTone: (wrongDirection === 'right' ? 'red' : 'green') as ButtonTone },
    { flash: mobileTapFeedback.hit, tone: HIT_COLOR, gradientTone: 'gold' as ButtonTone },
  ]
  const active = pulses.reduce((strongest, pulse) => pulse.flash > strongest.flash ? pulse : strongest)
  if (active.flash <= 0.01) return null

  const alpha = active.flash * active.flash
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%',
        pointerFilter: 'none',
      }}
      uiBackground={{
        texture: { src: BUTTON_TEXTURES[active.gradientTone] },
        textureMode: 'stretch',
        color: Color4.create(active.tone.r, active.tone.g, active.tone.b, alpha * 0.13),
      }}
    />
  )
}

function OfficialTouchButton({
  action,
  label,
  x,
  y,
  size,
  tone,
}: {
  action: InputAction
  label: string
  x: number
  y: number
  size: number
  tone: Color4
}): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { left: x, top: y },
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Math.floor(size / 2),
        borderWidth: 3,
        borderColor: Color4.create(tone.r, tone.g, tone.b, 0.34),
        pointerFilter: 'block',
      }}
      uiBackground={{ color: Color4.create(0.02, 0.01, 0.04, 0.90) }}
      uiInputBinding={{ actions: [action] }}
    >
      <UiEntity
        uiTransform={{
          width: size - 8,
          height: size - 8,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: Math.floor((size - 8) / 2),
          borderWidth: 2,
          borderColor: Color4.create(tone.r, tone.g, tone.b, 0.96),
          pointerFilter: 'none',
        }}
        uiBackground={{ color: Color4.create(0.01, 0.01, 0.025, 0.96) }}
      >
        <Label
          value={label}
          fontSize={size > 70 ? 44 : 34}
          color={tone}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
          textAlign="middle-center"
        />
      </UiEntity>
    </UiEntity>
  )
}

function OfficialMobileControls(): ReactEcs.JSX.Element | null {
  if (!isMobile()) return null
  const safe = getSafeCanvas()
  const baseControlsWidth = 250 + 154 + 24
  const controlScale = Math.max(0.62, Math.min(1, (safe.width - 16) / baseControlsWidth, (safe.height - 90) / 250))
  const directionPadSize = 250 * controlScale
  const directionButtonSize = 82 * controlScale
  const directionStep = 84 * controlScale
  const directionCenterSize = 48 * controlScale
  const hitButtonSize = 154 * controlScale
  const hitInnerSize = 142 * controlScale
  const wrongDirection = arrowInputFeedback.timer > 0 && !arrowInputFeedback.correct
    ? arrowInputFeedback.direction
    : null

  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}>
      <MobileScreenIrradiation />
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: safe.bottom + 54 * controlScale, left: safe.left },
          width: directionPadSize,
          height: directionPadSize,
          pointerFilter: 'none',
        }}
      >
        <OfficialTouchButton action={InputAction.IA_ACTION_5} label="⌃" x={directionStep} y={0} size={directionButtonSize} tone={DIR_COLOR.up} />
        <OfficialTouchButton action={InputAction.IA_ACTION_3} label="‹" x={0} y={directionStep} size={directionButtonSize} tone={DIR_COLOR.left} />
        <OfficialTouchButton action={InputAction.IA_ACTION_4} label="›" x={directionStep * 2} y={directionStep} size={directionButtonSize} tone={DIR_COLOR.right} />
        <OfficialTouchButton action={InputAction.IA_ACTION_6} label="⌄" x={directionStep} y={directionStep * 2} size={directionButtonSize} tone={DIR_COLOR.down} />
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { left: 101 * controlScale, top: 101 * controlScale },
            width: directionCenterSize,
            height: directionCenterSize,
            borderRadius: directionCenterSize / 2,
            pointerFilter: 'none',
          }}
          uiBackground={{ color: Color4.create(0.01, 0.01, 0.025, 0.78) }}
        />
        <MobileTapEffect flash={mobileTapFeedback.up} size={directionButtonSize} tone={DIR_COLOR.up} gradientTone="cyan" x={directionStep} y={0} correct={wrongDirection !== 'up'} />
        <MobileTapEffect flash={mobileTapFeedback.left} size={directionButtonSize} tone={DIR_COLOR.left} gradientTone="magenta" x={0} y={directionStep} correct={wrongDirection !== 'left'} />
        <MobileTapEffect flash={mobileTapFeedback.right} size={directionButtonSize} tone={DIR_COLOR.right} gradientTone="green" x={directionStep * 2} y={directionStep} correct={wrongDirection !== 'right'} />
        <MobileTapEffect flash={mobileTapFeedback.down} size={directionButtonSize} tone={DIR_COLOR.down} gradientTone="magenta" x={directionStep} y={directionStep * 2} correct={wrongDirection !== 'down'} />
      </UiEntity>

      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: safe.bottom, right: safe.right },
          width: hitButtonSize,
          height: hitButtonSize,
          pointerFilter: 'none',
        }}
      >
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { right: 0, bottom: 0 },
            width: hitButtonSize,
            height: hitButtonSize,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: hitButtonSize / 2,
            borderWidth: 3,
            borderColor: Color4.create(HIT_COLOR.r, HIT_COLOR.g, HIT_COLOR.b, 0.42),
            pointerFilter: 'block',
          }}
          uiBackground={{ color: Color4.create(0.02, 0.01, 0.015, 0.92) }}
          onMouseDown={requestMobileHit}
        >
          <UiEntity
            uiTransform={{ width: hitInnerSize, height: hitInnerSize, alignItems: 'center', justifyContent: 'center', borderRadius: hitInnerSize / 2, borderWidth: 3, borderColor: HIT_COLOR, pointerFilter: 'none' }}
            uiBackground={{ color: Color4.create(0.07, 0.035, 0.01, 0.96) }}
          >
            <Label
              value="★"
              fontSize={76 * controlScale}
              color={HIT_COLOR}
              uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
              textAlign="middle-center"
            />
          </UiEntity>
        </UiEntity>
        <MobileTapEffect flash={mobileTapFeedback.hit} size={hitButtonSize} tone={HIT_COLOR} gradientTone="gold" />
      </UiEntity>
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Key-hint row (shown near the top when idle, or as reminder)
// ──────────────────────────────────────────────────────────
function KeyHints(): ReactEcs.JSX.Element {
  const dirs: Direction[] = ['left', 'down', 'up', 'right']
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: '28%', left: 0 },
        width: '100%',
        height: 32,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {dirs.map(d => (
        <UiEntity
          key={d}
          uiTransform={{
            width: 70,
            height: 28,
            margin: { left: 4, right: 4 },
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            borderWidth: 1,
            borderColor: Color4.create(DIR_COLOR[d].r, DIR_COLOR[d].g, DIR_COLOR[d].b, 0.46),
          }}
          uiBackground={{ color: Color4.create(0.08, 0.08, 0.18, 0.7) }}
        >
          <Label
            value={`${DIR_KEY[d]}=${DIR_SYMBOL[d]}`}
            fontSize={13}
            color={DIR_COLOR[d]}
            uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
            textAlign="middle-center"
          />
        </UiEntity>
      ))}
      {gameState.roundMode === 'freestyle' ? (
        <UiEntity
          uiTransform={{
            width: 130,
            height: 28,
            margin: { left: 12, right: 4 },
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
          }}
          uiBackground={{ color: Color4.create(0.26, 0.02, 0.02, 0.82) }}
        >
          <Label
            value="RED=REVERSE"
            fontSize={12}
            color={Color4.create(1.0, 0.18, 0.18, 1)}
            uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
            textAlign="middle-center"
          />
        </UiEntity>
      ) : null}
      <UiEntity
        uiTransform={{
          width: 100,
          height: 28,
          margin: { left: 12, right: 4 },
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
        }}
        uiBackground={{ color: Color4.create(0.15, 0.12, 0.03, 0.7) }}
      >
        <Label
          value="SPACE=HIT"
          fontSize={13}
          color={Color4.create(1.0, 0.88, 0.2, 0.9)}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          textAlign="middle-center"
        />
      </UiEntity>
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Idle / title screen
// ──────────────────────────────────────────────────────────
function LobbyChoiceScreen(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const safe = getSafeCanvas()
  const width = Math.min(560, safe.width)
  // Mobile Explorer often reports a tall logical canvas even in landscape.
  // Use the aspect ratio too, otherwise the portrait stack crushes the goals
  // card into a few pixels on wide phones.
  // Preserve the original spacious desktop tutorial. The new horizontal
  // composition applies only after the tutorial reaches the main menu.
  const mobileLandscape = mobile && safe.width > safe.height * 1.35
  const horizontalMenuLayout = tutorialPage >= 5 && (!mobile || mobileLandscape)
  const wideShell = horizontalMenuLayout || mobileLandscape
  const short = safe.height < 520 || wideShell
  const logoHeight = wideShell
    ? Math.min(245, width * 0.44)
    : short ? Math.min(110, width * 0.24) : Math.min(290, width * 0.52)
  const logoOutsetFactor = wideShell ? 0.72 : short ? 0.44 : 0.62
  const logoOutset = logoHeight * logoOutsetFactor
  const maxPanelHeight = tutorialPage < 5 ? 590 : 620
  const height = Math.min(short ? 400 : maxPanelHeight, Math.max(260, safe.height - logoOutset - 8))
  const padding = short ? 8 : 12
  const contentWidth = width - padding * 2 - 4
  const logoInsetHeight = wideShell ? 90 : short ? logoHeight * 0.58 : logoHeight * 0.40
  const rankHeight = tutorialPage < 5 ? 0 : short ? 28 : 40
  const bodyHeight = height - padding * 2 - 4 - logoInsetHeight - rankHeight
  const replayTutorial = (): void => { tutorialPage = 0; tutorialSequenceStartedAt = Date.now() }
  const tutorialHoverKey = 'replay-tutorial-button'
  const menuButtonHeight = horizontalMenuLayout ? 58 : 44
  const menuButtonGap = horizontalMenuLayout ? 7 : short ? 3 : 6
  const buttons = <UiEntity uiTransform={{ width: short ? '46%' : '100%', height: short ? bodyHeight : 148, flexShrink: 0, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
    {horizontalMenuLayout ? <UiEntity uiTransform={{ width: '100%', height: 48, flexShrink: 0, pointerFilter: 'none' }} /> : null}
    <MenuButton label="DANCE" tone="cyan" onClick={openPlayMenu} width="100%" height={menuButtonHeight} fontSize={horizontalMenuLayout ? 26 : 24} marginBottom={menuButtonGap} />
    <MenuButton label="LEADERBOARD" tone="gold" onClick={openLeaderboardMenu} width="100%" height={menuButtonHeight} fontSize={Math.min(horizontalMenuLayout ? 25 : 24, (short ? contentWidth * 0.46 : contentWidth) / 9)} marginBottom={menuButtonGap} />
    <MenuButton label="JUST WATCH" tone="magenta" onClick={watchLiveMode} width="100%" height={menuButtonHeight} fontSize={horizontalMenuLayout ? 25 : 22} />
  </UiEntity>
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', padding: { top: safe.top, left: safe.left, right: safe.right, bottom: safe.bottom }, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <UiEntity uiTransform={{ positionType: 'relative', position: { top: logoOutset * 0.5 }, width, height, flexShrink: 0, flexDirection: 'column', alignItems: 'center', padding, borderRadius: 24, borderWidth: 2, borderColor: Color4.create(0.46, 0.58, 1, 0.78) }} uiBackground={{ color: Color4.create(0.012, 0.012, 0.045, 0.94) }}>
        <FloatingBeatScoreLogo panelWidth={width} height={logoHeight} outset={logoOutsetFactor} />
        <CloseButton onClick={watchLiveMode} />
        <UiEntity uiTransform={{ width: '100%', height: logoInsetHeight, flexShrink: 0, pointerFilter: 'none' }} />
        {tutorialPage >= 5 ? <MenuRankText width={contentWidth} height={rankHeight} /> : null}
        {tutorialPage < 5 ? <TutorialSlide width={contentWidth} height={bodyHeight} /> : <UiEntity uiTransform={{ width: '100%', height: bodyHeight, flexShrink: 0, flexDirection: short ? 'row' : 'column', alignItems: 'center', justifyContent: 'space-between' }}>
          <UiEntity uiTransform={{ width: short ? '52%' : '100%', height: short ? bodyHeight : bodyHeight - 156, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <UiEntity
              uiTransform={{ width: '100%', height: mobile ? 48 : 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 12, pointerFilter: 'block' }}
              onMouseDown={() => beginButtonPress(tutorialHoverKey)}
              onMouseUp={() => finishButtonPress(tutorialHoverKey, replayTutorial)}
              onMouseEnter={() => beginButtonHover(tutorialHoverKey)}
              onMouseLeave={() => { if (hoveredButtonKey === tutorialHoverKey) hoveredButtonKey = ''; if (pressedButtonKey === tutorialHoverKey) pressedButtonKey = '' }}
            >
              <Label value="↻ TUTORIAL" fontSize={18} color={Color4.create(0.66, 0.78, 1, 1)} uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} textAlign="middle-center" />
              <HoverAnimation buttonKey={tutorialHoverKey} borderRadius={12} />
            </UiEntity>
            <DailyGoalsMenuCard
              transparent
              compact={short && !horizontalMenuLayout}
              width={short ? contentWidth * 0.52 : contentWidth}
              height={horizontalMenuLayout || isMobile()
                ? Math.min(190, Math.max(0, short ? bodyHeight - 44 : bodyHeight - 200))
                : Math.min(158, short ? bodyHeight - 44 : bodyHeight - 200)}
            />
          </UiEntity>
          {buttons}
        </UiEntity>}
      </UiEntity>
    </UiEntity>
  )
}

function getGlobalLeaderboardRows(): MatchPlayer[] {
  const localEntry = gameState.matchPlayers.find(player => player.isLocal)
  const localFallback: MatchPlayer = localEntry ? { ...localEntry } : {
    playerId: 'local-player',
    name: 'YOU',
    score: gameState.score,
    maxCombo: gameState.maxCombo,
    rankPoints: gameState.rankPoints,
    wins: 0,
    matchesPlayed: 0,
    slotIndex: 0,
    finished: false,
    ready: true,
    phase: gameState.phase,
    matchStartTime: 0,
    judgmentText: '' as const,
    judgmentCombo: 0,
    judgmentSentAt: 0,
    judgmentTimer: 0,
    isLocal: true,
    lastSeen: Date.now(),
  }

  const rows = gameState.globalLeaderboard.length > 0 ? gameState.globalLeaderboard : [localFallback]
  return rows.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
    if (b.wins !== a.wins) return b.wins - a.wins
    return b.maxCombo - a.maxCombo
  })
}

function getLastDanceRows(): MatchPlayer[] {
  const activeRows = gameState.phase === 'playing' ? getActiveMatchEntries() : []
  const rows = activeRows.length > 0 ? activeRows : gameState.lastDanceLeaderboard
  return rows.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.maxCombo !== a.maxCombo) return b.maxCombo - a.maxCombo
    if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
    return a.name.localeCompare(b.name)
  })
}

function LeaderboardTabButton({ id, label }: { id: 'global' | 'last'; label: string }): ReactEcs.JSX.Element {
  const active = leaderboardTab === id
  const mobile = isMobile()
  const activeTone: ButtonTone = id === 'last' ? 'magenta' : 'gold'
  const activeBorder = id === 'last'
    ? Color4.create(0.94, 0.30, 1.0, 1)
    : Color4.create(1.0, 0.86, 0.28, 1)
  const hoverKey = `leaderboard-tab:${id}`
  return (
    <UiEntity
      uiTransform={{
        width: '48%',
        height: mobile ? 48 : 44,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        borderWidth: active ? 2 : 1,
        borderColor: active ? activeBorder : Color4.create(0.46, 0.58, 1.0, 0.45),
        overflow: 'hidden',
        pointerFilter: 'block',
      }}
      uiBackground={{ color: active ? (id === 'last' ? Color4.create(0.24, 0.03, 0.30, 0.96) : Color4.create(0.35, 0.16, 0.04, 0.96)) : Color4.create(0.04, 0.05, 0.12, 0.88) }}
      onMouseDown={() => beginButtonPress(hoverKey)}
      onMouseUp={() => finishButtonPress(hoverKey, () => { leaderboardTab = id; leaderboardPage = 0 })}
      onMouseEnter={() => beginButtonHover(hoverKey)}
      onMouseLeave={() => { if (hoveredButtonKey === hoverKey) hoveredButtonKey = ''; if (pressedButtonKey === hoverKey) pressedButtonKey = '' }}
    >
      {active ? <GradientFill tone={activeTone} borderRadius={14} /> : null}
      <Label
        value={label}
        fontSize={mobile ? 19 : 21}
        color={active ? Color4.White() : Color4.create(0.72, 0.82, 1.0, 1)}
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}
        textAlign="middle-center"
      />
      <HoverAnimation buttonKey={hoverKey} borderRadius={14} />
    </UiEntity>
  )
}

function getLeaderboardLayout() {
  const safe = getSafeCanvas()
  const width = Math.min(isMobile() ? 744 : 912, safe.width)
  const height = Math.min(isMobile() ? 552 : 684, safe.height)
  const narrow = width < 560
  const compact = height < 380
  const padding = compact ? 8 : 16
  const contentWidth = width - padding * 2 - 4
  const logoHeight = narrow || compact ? 0 : 80
  const headerHeight = narrow || compact ? 0 : 28
  const footerHeight = narrow || compact ? 44 : 96
  const rowGap = narrow ? 6 : 8
  const listHeight = height - padding * 2 - 4 - 56 - logoHeight - 44 - 8 - headerHeight - footerHeight
  const rowHeight = narrow ? Math.min(72, Math.max(44, listHeight - rowGap)) : 60
  const pageSize = Math.max(1, Math.min(5, Math.floor(listHeight / (rowHeight + rowGap))))
  return { safe, width, height, narrow, compact, padding, contentWidth, logoHeight, headerHeight, footerHeight, rowHeight, rowGap, listHeight, pageSize }
}

function LeaderboardMenuRow({ entry, index, mode }: { key?: string; entry: MatchPlayer; index: number; mode: 'global' | 'last' }): ReactEcs.JSX.Element {
  const layout = getLeaderboardLayout()
  const { narrow, contentWidth, rowHeight, rowGap } = layout
  const placeColor = index === 0 ? HIT_COLOR : index === 1 ? Color4.create(0.78, 0.86, 1, 1) : index === 2 ? Color4.create(1, 0.58, 0.3, 1) : Color4.create(0.78, 0.82, 0.94, 1)
  const innerWidth = contentWidth - 24
  const topHeight = Math.min(28, (rowHeight - 10) * 0.46)
  const bottomHeight = rowHeight - 10 - topHeight
  const name = entry.isLocal ? 'YOU' : String(entry.name || '---').slice(0, narrow ? 18 : 24)
  const rpOrScore = mode === 'global' ? `${entry.rankPoints} RP` : `${entry.score}`
  const textColor = Color4.create(0.92, 0.96, 1, 1)
  const scoreColor = Color4.create(0.48, 0.92, 1, 1)
  return (
    <UiEntity uiTransform={{ width: '100%', height: rowHeight, flexShrink: 0, flexDirection: narrow ? 'column' : 'row', alignItems: 'center', justifyContent: 'space-between', padding: { left: 12, right: 12, top: narrow ? 4 : 0, bottom: narrow ? 4 : 0 }, margin: { bottom: rowGap }, borderRadius: 12, borderWidth: index === 0 ? 1 : 0, borderColor: Color4.create(1, 0.8, 0.2, 0.46) }}
      uiBackground={{ color: index === 0 ? Color4.create(0.09, 0.26, 0.33, 0.82) : Color4.create(0.05, 0.05, 0.12, 0.76) }}>
      {narrow ? (
        <UiEntity uiTransform={{ width: '100%', height: topHeight, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label value={`${placementLabel(index)}  ${name}`} fontSize={Math.min(16, topHeight * 0.8, innerWidth * 0.62 / (name.length * 0.6 + 4))} color={textColor}
            uiTransform={{ width: '64%', height: '100%' }} textAlign="middle-left" textWrap="nowrap" />
          <Label value={rpOrScore} fontSize={Math.min(17, topHeight * 0.8, innerWidth * 0.36 / Math.max(4, rpOrScore.length * 0.6))} color={HIT_COLOR}
            uiTransform={{ width: '36%', height: '100%' }} textAlign="middle-right" textWrap="nowrap" />
        </UiEntity>
      ) : <UiEntity uiTransform={{ width: '31%', height: '100%', flexDirection: 'row', alignItems: 'center' }}>
        <Label value={placementLabel(index)} fontSize={20.4} color={placeColor} uiTransform={{ width: 50, height: '100%', flexShrink: 0 }} textAlign="middle-left" />
        <Label value={name} fontSize={Math.min(18, (innerWidth * 0.31 - 50) / Math.max(4, name.length * 0.6))} color={textColor} uiTransform={{ width: innerWidth * 0.31 - 50, height: '100%' }} textAlign="middle-left" textWrap="nowrap" />
      </UiEntity>}
      {narrow ? <UiEntity uiTransform={{ width: '100%', height: bottomHeight, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <RankLabelImage points={entry.rankPoints} width={Math.min(154, innerWidth * 0.46)} height={bottomHeight} />
        <Label value={`MAX ${entry.score}  •  ${entry.maxCombo}x`} fontSize={Math.min(15.6, bottomHeight * 0.8, innerWidth * 0.52 / Math.max(10, String(entry.score).length + 7))} color={scoreColor}
          uiTransform={{ width: '52%', height: '100%' }} textAlign="middle-right" textWrap="nowrap" />
      </UiEntity> : <UiEntity uiTransform={{ width: '23%', height: '100%', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
        <RankLabelImage points={entry.rankPoints} width={Math.min(153.6, innerWidth * 0.23)} height={40.8} />
      </UiEntity>}
      {!narrow ? <Label value={rpOrScore} fontSize={19.2} color={HIT_COLOR} uiTransform={{ width: '16%', height: '100%' }} textAlign="middle-center" textWrap="nowrap" /> : null}
      {!narrow ? <Label value={String(entry.score)} fontSize={19.2} color={scoreColor} uiTransform={{ width: '15%', height: '100%' }} textAlign="middle-center" textWrap="nowrap" /> : null}
      {!narrow ? <Label value={`${entry.maxCombo}x`} fontSize={19.2} color={scoreColor} uiTransform={{ width: '15%', height: '100%' }} textAlign="middle-right" /> : null}
    </UiEntity>
  )
}

function LeaderboardMenuScreen(): ReactEcs.JSX.Element {
  const layout = getLeaderboardLayout()
  const { safe, width, height, padding, contentWidth, logoHeight, headerHeight, footerHeight, listHeight, pageSize } = layout
  const rows = leaderboardTab === 'global' ? getGlobalLeaderboardRows() : getLastDanceRows()
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  leaderboardPage = Math.min(leaderboardPage, pageCount - 1)
  const start = leaderboardPage * pageSize
  const visibleRows = rows.slice(start, start + pageSize)
  const panelBorder = leaderboardTab === 'last'
    ? Color4.create(0.92, 0.28, 1.0, 0.88)
    : Color4.create(1, 0.8, 0.22, 0.82)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', padding: { top: safe.top, left: safe.left, right: safe.right, bottom: safe.bottom }, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <UiEntity uiTransform={{ positionType: 'relative', width, height, flexShrink: 0, flexDirection: 'column', alignItems: 'center', padding, borderRadius: 24, borderWidth: 2, borderColor: panelBorder }} uiBackground={{ color: Color4.create(0.012, 0.012, 0.045, 0.94) }}>
        {logoHeight > 0 ? <FloatingLeaderboardTitle title={leaderboardTab} panelWidth={width} contentWidth={contentWidth} /> : null}
        <BackButton onClick={returnToLobby} />
        <CloseButton onClick={watchLiveMode} />
        <UiEntity uiTransform={{ width: '100%', height: 56, flexShrink: 0 }} />
        {logoHeight > 0 ? <UiEntity uiTransform={{ width: '100%', height: logoHeight - 2, flexShrink: 0, pointerFilter: 'none' }} /> : null}
        <UiEntity uiTransform={{ width: '100%', height: 44, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', margin: { bottom: 8 } }}>
          <LeaderboardTabButton id="global" label="GLOBAL" />
          <LeaderboardTabButton id="last" label="LAST GAME" />
        </UiEntity>
        {headerHeight > 0 ? <UiEntity uiTransform={{ width: '100%', height: headerHeight, flexShrink: 0, flexDirection: 'row', padding: { left: 12, right: 12 } }}>
          {['PLAYER', 'RANK', leaderboardTab === 'global' ? 'RP' : 'SCORE', 'MAX SCORE', 'MAX PERFECT'].map((label, index) => <Label key={label} value={label} fontSize={index < 3 ? 16.8 : 15.6} color={Color4.create(0.74, 0.84, 1, 1)} uiTransform={{ width: (['31%', '23%', '16%', '15%', '15%'][index] as PercentUnit), height: '100%' }} textAlign={index === 0 ? 'middle-left' : 'middle-center'} />)}
        </UiEntity> : null}
        <UiEntity uiTransform={{ width: '100%', height: listHeight, flexShrink: 0, flexDirection: 'column' }}>
          {visibleRows.map((entry, index) => <LeaderboardMenuRow key={entry.playerId} entry={entry} index={start + index} mode={leaderboardTab} />)}
          {visibleRows.length === 0 ? <Label value="NO DANCES YET" fontSize={20} color={HIT_COLOR} uiTransform={{ width: '100%', height: 44 }} textAlign="middle-center" /> : null}
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: 44, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <MenuButton label="‹" tone="gold" onClick={() => { leaderboardPage = Math.max(0, leaderboardPage - 1) }} disabled={leaderboardPage === 0} width={48} height={44} fontSize={28} />
          <Label value={`${leaderboardPage + 1} / ${pageCount}`} fontSize={18} color={HIT_COLOR} uiTransform={{ width: contentWidth - 104, height: '100%' }} textAlign="middle-center" />
          <MenuButton label="›" tone="gold" onClick={() => { leaderboardPage = Math.min(pageCount - 1, leaderboardPage + 1) }} disabled={leaderboardPage === pageCount - 1} width={48} height={44} fontSize={28} />
        </UiEntity>
        {footerHeight > 44 ? <UiEntity uiTransform={{ width: '100%', height: 52, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
          <MenuButton
            label="MENU"
            tone={leaderboardTab === 'last' ? 'purple' : 'gold'}
            useRankMenuColors={false}
            menuArt={leaderboardTab === 'last'
              ? { src: 'assets/images/ui/levels/menu-last-purple.png', aspect: 2172 / 724 }
              : { src: 'assets/images/ui/levels/menu-global-gold.png', aspect: 2172 / 724 }}
            onClick={returnToLobby}
            width={isMobile() ? 156 : 180}
            height={isMobile() ? 52 : 48}
            fontSize={24}
            borderRadius={14}
          />
        </UiEntity> : null}
      </UiEntity>
    </UiEntity>
  )
}

function IdleScreen(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const safe = getSafeCanvas()
  const width = Math.min(520, safe.width)
  const short = safe.height < 420
  const logoHeight = short ? Math.min(100, width * 0.24) : Math.min(180, width * 0.36)
  const logoOutset = logoHeight * 0.60
  const logoInsetHeight = logoHeight * 0.42
  const height = Math.min(short ? 292 : 310, Math.max(270, safe.height - logoOutset - 8))
  const buttonWidth = Math.min(mobile ? 300 : 320, width - 40)
  const modeButtonHeight = mobile ? 58 : 54

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%',
        padding: { top: safe.top, left: safe.left, right: safe.right, bottom: safe.bottom },
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <UiEntity
        uiTransform={{
          positionType: 'relative',
          position: { top: logoOutset * 0.5 },
          width,
          maxWidth: width,
          height,
          maxHeight: height,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          padding: { top: 8, bottom: 8, left: 12, right: 12 },
          borderRadius: mobile ? 20 : 24,
          borderWidth: 2,
          borderColor: Color4.create(0.56, 0.38, 0.92, 0.82),
        }}
        uiBackground={{ color: Color4.create(0.012, 0.012, 0.045, 0.94) }}
      >
        <FloatingBeatScoreLogo panelWidth={width} height={logoHeight} outset={0.60} />
        <BackButton onClick={returnToLobby} />
        <CloseButton onClick={watchLiveMode} />
        <UiEntity uiTransform={{ width: '100%', height: logoInsetHeight, flexShrink: 0, pointerFilter: 'none' }} />
        <MenuRankText width={width - 28} height={short ? 28 : 40} />
        <Label value="CHOOSE YOUR MODE" fontSize={Math.min(24, (width - 28) / 12)}
          color={Color4.create(1.0, 0.84, 0.24, 1)}
          uiTransform={{ width: '100%', height: 34, margin: { bottom: 7 } }} textAlign="middle-center" />
        <MenuButton label="PUBLIC MATCH" tone="green" onClick={readyForMultiplayer} width={buttonWidth}
          height={modeButtonHeight} fontSize={mobile ? 25 : 26} marginBottom={7} borderRadius={15} />
        <MenuButton label="SOLO STAGE" tone="purple" onClick={startSoloMode} width={buttonWidth}
          height={modeButtonHeight} fontSize={mobile ? 25 : 26} borderRadius={15} />
      </UiEntity>
    </UiEntity>
  )
}

function ReadyScreen(): ReactEcs.JSX.Element {
  const safe = getSafeCanvas()
  const width = Math.min(900, safe.width)
  // Keep the floating title 40% larger at every breakpoint while still
  // deriving its size from the available device dimensions.
  const titleHeight = Math.min(
    (safe.height < 420 ? 68 : 104) * 1.4,
    width * 0.23,
    safe.height * 0.30,
  )
  const height = Math.min(680, Math.max(280, safe.height - titleHeight * 0.5))
  const short = height < 420
  const padding = short ? 8 : 12
  const innerWidth = width - padding * 2 - 4
  const localIsJoined = gameState.matchPlayers.some(player => player.isLocal && player.ready && player.phase === 'ready')
  const joinedCount = gameState.matchPlayers.filter(player => player.ready && player.phase === 'ready').length
  const matchLocked = gameState.multiplayerLiveRemaining > 0
  const actionDisabled = matchLocked || localIsJoined || joinedCount >= 20
  const countdown = Math.max(0, Math.ceil(gameState.multiplayerCountdown))
  const countdownText = `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}`
  const actionLabel = matchLocked ? 'MATCH LOCKED' : localIsJoined ? '✓ JOINED NEXT MATCH' : joinedCount >= 20 ? 'MATCH FULL' : 'JOIN MATCH'
  const bodyHeight = height - padding * 2 - 4 - 44 - 52
  const infoHeight = short ? bodyHeight : Math.min(180, bodyHeight * 0.43)
  const panelHeight = short ? bodyHeight : bodyHeight - infoHeight
  const info = <UiEntity uiTransform={{ width: short ? '40%' : '100%', height: infoHeight, flexShrink: 0, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
    <Label value={matchLocked ? 'BATTLE ENDS IN' : 'NEXT MATCH STARTS IN'} fontSize={short ? 12 : 16} color={Color4.create(0.68, 0.74, 0.86, 1)} uiTransform={{ width: '100%', height: 24, flexShrink: 0 }} textAlign="middle-center" />
    <Label value={countdownText} fontSize={short ? 32 : 64} color={HIT_COLOR} uiTransform={{ width: '100%', height: short ? 40 : 80, flexShrink: 0 }} textAlign="middle-center" />
    {!short ? <Label value={matchLocked ? 'Join window opens after this battle' : localIsJoined ? 'You’re in • stay nearby' : 'Tap JOIN MATCH to claim your spot'} fontSize={14} color={Color4.create(0.8, 0.8, 0.9, 1)} uiTransform={{ width: '100%', height: 28, flexShrink: 0 }} textAlign="middle-center" /> : null}
  </UiEntity>
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', padding: { top: safe.top, left: safe.left, right: safe.right, bottom: safe.bottom }, alignItems: 'center', justifyContent: 'center' }}>
    <UiEntity uiTransform={{ positionType: 'relative', position: { top: titleHeight * 0.25 }, width, height, flexShrink: 0, flexDirection: 'column', alignItems: 'center', padding, borderRadius: 24, borderWidth: 2, borderColor: Color4.create(0.38, 0.9, 0.74, 0.82) }} uiBackground={{ color: Color4.create(0.01, 0.02, 0.045, 0.94) }}>
      <FloatingMenuTitle src={PUBLIC_MATCH_TITLE} panelWidth={width} height={titleHeight} />
      <BackButton onClick={cancelMultiplayerReady} />
      <CloseButton onClick={watchLiveMode} />
      <UiEntity uiTransform={{ width: '100%', height: 44, flexShrink: 0, pointerFilter: 'none' }} />
      <UiEntity uiTransform={{ width: '100%', height: bodyHeight, flexShrink: 0, flexDirection: short ? 'row' : 'column', alignItems: 'center' }}>
        {info}
        {!matchLocked ? <ReadyPlayersPanel width={short ? innerWidth * 0.58 : innerWidth} height={panelHeight} /> : null}
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: 52, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
        <MenuButton label={actionLabel} tone={localIsJoined ? 'green' : 'cyan'} disabled={actionDisabled} onClick={joinMultiplayerMatch} width={Math.min(360, innerWidth)} height={44} fontSize={Math.min(22, innerWidth / 11)} />
      </UiEntity>
    </UiEntity>
  </UiEntity>
}

function SidePlayMenu(): ReactEcs.JSX.Element {
  const safe = getSafeCanvas()
  const mobile = isMobile()
  const availableWidth = Math.min(mobile ? 540 : 500, safe.width - 8)
  const contentHeight = Math.min(mobile ? 192 : 184, Math.max(mobile ? 178 : 170, safe.height * (mobile ? 0.34 : 0.3)))
  const height = contentHeight + 18
  const rankStyle = getDanceRank(gameState.rankPoints)
  const hitApprenticeMenu = getDanceRankIndex(gameState.rankPoints) === 0
  const brighten = (color: { r: number; g: number; b: number }, amount: number, alpha = 1) => Color4.create(
    color.r + (1 - color.r) * amount,
    color.g + (1 - color.g) * amount,
    color.b + (1 - color.b) * amount,
    alpha,
  )
  const rankBorder = hitApprenticeMenu ? Color4.create(1.0, 0.18, 0.22, 0.98) : brighten(rankStyle.secondary, 0.25, 0.98)
  const rankButtonBottom = hitApprenticeMenu ? Color4.create(0.62, 0.015, 0.045, 0.99) : brighten(rankStyle.primary, 0.22, 0.98)
  const rankButtonTop = hitApprenticeMenu ? Color4.create(1.0, 0.07, 0.11, 0.99) : brighten(rankStyle.secondary, 0.42, 0.98)
  const badgeSize = Math.min(mobile ? 142 : 132, contentHeight * 0.78)
  const badgeLeft = 16
  const badgeTop = Math.max(6, contentHeight - badgeSize - 24)
  const goalsLeft = badgeLeft + badgeSize + 10
  const goalsWidth = Math.min(mobile ? 270 : 250, availableWidth - goalsLeft - 18)
  // Keep the frame tight to the score column on both mobile and desktop.
  const width = Math.min(availableWidth, goalsLeft + goalsWidth + 16)
  const logoHeight = Math.min(mobile ? 118 : 108, width * 0.22)
  const logoWidth = logoHeight * BEAT_SCORE_LOGO_ASPECT
  const logoOutset = logoHeight * 0.62
  const goalsHeight = Math.min(mobile ? 120 : 114, contentHeight - 46)
  const goalsTop = contentHeight - goalsHeight - 16
  const menuWidth = mobile ? 120 : 114
  const top = safe.top + logoOutset + Math.min(42, Math.max(0, safe.height - height - logoOutset) * 0.22)
  const panelPosition = mobile ? { top, left: 0 } : { top, right: safe.right }
  const hoverKey = 'side-menu-button'

  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: panelPosition, width, height, flexShrink: 0, borderRadius: 18, borderWidth: 2, borderColor: rankBorder }}
      uiBackground={{ color: Color4.create(0.015, 0.01, 0.05, 0.22) }}>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { top: -logoHeight * 0.62, right: 0 }, width: logoWidth, height: logoHeight, zIndex: 4, pointerFilter: 'none' }}
        uiBackground={{ texture: { src: BEAT_SCORE_LOGO }, textureMode: 'stretch' }} />
      <UiEntity uiTransform={{ positionType: 'absolute', position: { top: badgeTop, left: badgeLeft }, width: badgeSize, height: badgeSize + 24, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
        <RankBadgeImage points={gameState.rankPoints} size={badgeSize} />
        <Label value={`${gameState.rankPoints} RP`} fontSize={mobile ? 18 : 17} color={Color4.White()}
          uiTransform={{ width: '100%', height: 24, flexShrink: 0, pointerFilter: 'none' }} textAlign="middle-center" />
      </UiEntity>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { top: goalsTop, left: goalsLeft }, width: goalsWidth, height: goalsHeight }}>
        <DailyGoalsMenuCard compact width={goalsWidth} height={goalsHeight} transparent />
      </UiEntity>
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { right: -6, bottom: -18 }, width: menuWidth, height: 48, zIndex: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: mobile ? 0 : 2, borderColor: rankBorder, overflow: 'hidden', pointerFilter: 'block' }}
        uiBackground={{ color: rankButtonBottom }}
        onMouseDown={() => beginButtonPress(hoverKey)}
        onMouseUp={() => finishButtonPress(hoverKey, returnToLobby)}
        onMouseEnter={() => beginButtonHover(hoverKey)}
        onMouseLeave={() => { if (hoveredButtonKey === hoverKey) hoveredButtonKey = ''; if (pressedButtonKey === hoverKey) pressedButtonKey = '' }}
      >
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 2, left: 2 }, width: '96%', height: '48%', borderRadius: 11, pointerFilter: 'none' }}
          uiBackground={{ color: rankButtonTop }} />
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 2, left: 3 }, width: '94%', height: '16%', borderRadius: 10, pointerFilter: 'none' }}
          uiBackground={{ color: Color4.create(1, 1, 1, 0.18) }} />
        <ButtonLabelGraphic label="MENU" height={48} maxWidth={menuWidth * 0.86} />
        <HoverAnimation buttonKey={hoverKey} borderRadius={13} />
      </UiEntity>
    </UiEntity>
  )
}

function JumpOffButton(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const titleWidth = mobile ? 131 : 145
  const titleHeight = mobile ? 30 : 33
  const hoverKey = 'jump-off-button'
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: mobile ? 180 : 194, right: mobile ? 12 : 24 },
        width: mobile ? 152 : 170,
        height: mobile ? 52 : 46,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 2,
        borderColor: Color4.create(REVERSE_COLOR.r, REVERSE_COLOR.g, REVERSE_COLOR.b, 0.92),
        pointerFilter: 'block',
      }}
      uiBackground={{ color: Color4.create(0.18, 0.02, 0.06, 0.90) }}
      onMouseDown={() => beginButtonPress(hoverKey)}
      onMouseUp={() => finishButtonPress(hoverKey, requestJumpOff)}
      onMouseEnter={() => beginButtonHover(hoverKey)}
      onMouseLeave={() => { if (hoveredButtonKey === hoverKey) hoveredButtonKey = ''; if (pressedButtonKey === hoverKey) pressedButtonKey = '' }}
    >
      <CroppedMenuTitleImage
        src={JUMP_OFF_TITLE}
        width={titleWidth}
        height={titleHeight}
        bounds={JUMP_OFF_TITLE_BOUNDS}
      />
      <HoverAnimation buttonKey={hoverKey} borderRadius={12} />
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Game-over / results screen
// ──────────────────────────────────────────────────────────
function ResultsCelebration({ points }: { points: number }): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const cycle = (Date.now() % 4200) / 4200
  const sparkleCycle = (Date.now() % 1600) / 1600
  const colors = getDanceRank(points).confetti.map(color => Color4.create(color.r, color.g, color.b, 0.86))
  const pieces = Array.from({ length: mobile ? 38 : 54 }, (_, index) => {
    const lane = (index * 37 + 9) % 100
    const speed = 0.72 + (index % 5) * 0.11
    const phase = (cycle * speed + ((index * 29) % 100) / 100) % 1
    return {
      left: `${lane}%` as PercentUnit,
      top: `${-8 + phase * 116}%` as PercentUnit,
      symbol: index % 7 === 0 ? '★' : index % 3 === 0 ? '✦' : index % 2 === 0 ? '◆' : '●',
      size: (mobile ? 15 : 17) + (index % 4) * 3,
      color: colors[index % colors.length],
    }
  })

  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'none', zIndex: 4, alignItems: 'center', overflow: 'hidden' }}>
      <UiEntity uiTransform={{ width: mobile ? 720 : 980, height: mobile ? 190 : 240, positionType: 'relative', pointerFilter: 'none' }}>
        <SparkleBurst progress={sparkleCycle} color={colors[0]} width={mobile ? 650 : 850} height={mobile ? 150 : 190} distance={mobile ? 160 : 220} count={18} />
        <SparkleBurst progress={(sparkleCycle + 0.5) % 1} color={colors[1]} width={mobile ? 720 : 980} height={mobile ? 190 : 240} distance={mobile ? 210 : 290} count={22} />
      </UiEntity>
      {pieces.map((piece, index) => (
        <Label
          key={`results-confetti-${index}`}
          value={piece.symbol}
          fontSize={piece.size}
          color={piece.color}
          uiTransform={{ positionType: 'absolute', position: { top: piece.top, left: piece.left }, width: piece.size + 4, height: piece.size + 4, pointerFilter: 'none' }}
          textAlign="middle-center"
        />
      ))}
    </UiEntity>
  )
}

function GameOverScreen(): ReactEcs.JSX.Element {
  const s = gameState.score
  const localPlayer = getPlayer()
  const soloResults = gameState.playMode === 'solo'
  const allFinalEntries = getActiveMatchEntries()
  const winnerEntry = allFinalEntries.find(entry => entry.playerId === gameState.winnerPlayerId) || allFinalEntries[0]
  // Solo match entries are intentionally pruned to preserve isolation, so the
  // results portrait must come directly from the local profile instead of the
  // multiplayer winner list.
  const winnerName = String(
    soloResults
      ? (localPlayer?.name || 'YOU')
      : (gameState.matchWinnerName || winnerEntry?.name || 'YOU'),
  ).slice(0, 18)
  const rawWinnerId = soloResults
    ? (localPlayer?.userId || gameState.winnerPlayerId)
    : (winnerEntry?.playerId || gameState.winnerPlayerId)
  const winnerId = rawWinnerId && rawWinnerId !== 'local-player' ? rawWinnerId : ''
  const winnerScore = winnerEntry?.score ?? s
  const winnerRankPoints = soloResults ? gameState.rankPoints : winnerEntry?.rankPoints ?? gameState.rankPoints
  const stars =
    s >= 200000 ? 5 :
    s >= 100000 ? 4 :
    s >=  50000 ? 3 :
    s >=  20000 ? 2 :
    s >       0 ? 1 : 0
  const starText = `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`
  const starColor = stars >= 4 ? Color4.create(1.0, 0.82, 0.14, 1) :
    stars >= 2 ? Color4.create(0.90, 0.55, 1.0, 1) :
                 Color4.create(0.58, 0.58, 0.66, 1)

  const safe = getSafeCanvas()
  const cardWidth = Math.min(760, safe.width)
  const cardHeight = Math.min(660, safe.height)
  const compact = cardHeight < 420
  const narrow = cardWidth < 560 && !compact
  const padding = compact ? 8 : 12
  const contentWidth = cardWidth - padding * 2 - 4
  const titleHeight = compact ? 30 : 52
  const starsHeight = compact ? 22 : 40
  const scoreHeight = narrow ? 40 : compact ? 24 : 32
  const buttonHeight = compact ? 44 : 50
  const resultRowHeight = compact ? 28 : narrow ? 38 : 44
  const narrowDetailHeight = cardHeight < 540 ? 70 : 94
  const rowBudget = cardHeight - padding * 2 - 4 - titleHeight - starsHeight - scoreHeight - buttonHeight -
    (narrow ? narrowDetailHeight : 0) - (gameState.playMode === 'multiplayer' ? resultRowHeight + 8 : 0)
  const baselineRowHeight = Math.floor(Math.min(narrow ? 160 : 220, cardHeight * (narrow ? 0.25 : 0.32)))
  const rowHeight = Math.floor(Math.min(baselineRowHeight * 1.2, rowBudget))
  const badgeSize = Math.floor(Math.min(rowHeight - 6, Math.min(208, baselineRowHeight - 6, contentWidth * (narrow ? 0.45 : 0.30)) * 1.2))
  const portraitSize = Math.floor(Math.min(narrow ? 120 : 152, rowHeight - 10, contentWidth * 0.26))
  const detailHeight = narrow ? narrowDetailHeight : rowHeight
  const detailCompact = compact || (narrow && detailHeight < 94) || (!narrow && detailHeight < 110)
  const detailScale = detailCompact ? Math.min(1, detailHeight / 70) : 1
  const detailWidth = narrow ? contentWidth : contentWidth - portraitSize - badgeSize - 20
  const nameSize = Math.min(detailCompact ? 26 * detailScale : narrow ? 38 : 52, detailWidth / Math.max(4, winnerName.length * 0.65))
  const resultRoom = cardHeight - padding * 2 - 4 - titleHeight - rowHeight - (narrow ? detailHeight : 0) - starsHeight - scoreHeight - buttonHeight - 8
  const visibleResultCount = Math.max(1, Math.min(5, Math.floor(resultRoom / resultRowHeight)))
  const resultPages = Math.ceil(allFinalEntries.length / visibleResultCount)
  const resultPage = resultPages > 1 ? Math.floor(Date.now() / 4000) % resultPages : 0
  const resultStart = resultPage * visibleResultCount
  const finalEntries = gameState.playMode === 'multiplayer' ? allFinalEntries.slice(resultStart, resultStart + visibleResultCount) : []
  const winnerDetails = (
    <UiEntity uiTransform={{ width: detailWidth, height: detailHeight, flexShrink: 0, flexDirection: 'column', justifyContent: 'center', alignItems: narrow ? 'center' : 'flex-start', pointerFilter: 'none' }}>
      <ImpactLabel value="WINNER" fontSize={detailCompact ? 15 * detailScale : 20} color={Color4.create(0.4, 1, 0.9, 1)} height={detailCompact ? 20 * detailScale : 24} align={narrow ? 'middle-center' : 'middle-left'} />
      <ImpactLabel value={winnerName.toUpperCase()} fontSize={nameSize} color={Color4.create(1, 0.24, 0.76, 1)} height={detailCompact ? 28 * detailScale : narrow ? 42 : 58} align={narrow ? 'middle-center' : 'middle-left'} />
      <ImpactLabel value={`WINNING SCORE  ${winnerScore}`} fontSize={Math.min(detailCompact ? 16 * detailScale : 22, detailWidth / 18)} color={Color4.create(1, 0.86, 0.18, 1)} height={detailCompact ? 22 * detailScale : 28} align={narrow ? 'middle-center' : 'middle-left'} />
    </UiEntity>
  )

  const renderedCardHeight = soloResults ? Math.min(cardHeight, padding * 2 + 4 + titleHeight + rowHeight + (narrow ? detailHeight : 0) + starsHeight + scoreHeight + buttonHeight + 12) : cardHeight
  const entrance = smoothStep(resultsPresentation.elapsed / 1.1)
  const exit = smoothStep(resultsPresentation.remaining / 1.5)
  const alpha = Math.max(0.001, entrance * exit)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', padding: { top: safe.top, left: safe.left, right: safe.right, bottom: safe.bottom }, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: alpha, pointerFilter: 'none' }}>
      <ResultsCelebration points={winnerRankPoints} />
      <UiEntity uiTransform={{ positionType: 'relative', width: cardWidth, height: renderedCardHeight, flexShrink: 0, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding, margin: { top: ((1 - entrance) * 32 - (1 - exit) * 24) * Math.min(1, Math.max(0, safe.height - renderedCardHeight) / 32) }, borderRadius: 22, borderWidth: 2, borderColor: Color4.create(1, 0.48, 0.9, 0.88), zIndex: 2 }}
        uiBackground={{ color: Color4.create(0.015, 0.01, 0.05, 0.22) }}>
        <LevelTitleImage title={soloResults ? 'solo' : 'victory'} width={contentWidth} height={titleHeight} />
        <UiEntity uiTransform={{ width: '100%', height: rowHeight, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', pointerFilter: 'none' }}>
          <UiEntity uiTransform={{ width: portraitSize, height: portraitSize, flexShrink: 0, positionType: 'relative', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
            <UiEntity uiTransform={{ positionType: 'absolute', width: portraitSize - 8, height: portraitSize - 8, borderRadius: portraitSize / 2, borderWidth: 3, borderColor: Color4.create(1, 0.72, 0.08, 0.92), pointerFilter: 'none' }}
              uiBackground={{ color: Color4.create(1, 0.2, 0.68, 0.08) }} />
            {winnerId ? <UiEntity uiTransform={{ width: portraitSize, height: portraitSize, pointerFilter: 'none' }}
              uiBackground={{ avatarTexture: { userId: winnerId }, textureMode: 'stretch' }} /> : null}
          </UiEntity>
          {!narrow ? winnerDetails : null}
          <RankBadgeImage points={winnerRankPoints} size={badgeSize} />
        </UiEntity>
        {narrow ? winnerDetails : null}
        <Label value={starText} fontSize={compact ? 23 : 34} color={starColor}
          uiTransform={{ width: '100%', height: starsHeight, flexShrink: 0 }} textAlign="middle-center" />
        <ImpactLabel value={`YOUR SCORE  ${s}   •   MAX PERFECT  ${gameState.maxCombo}x`} fontSize={Math.min(compact ? 15 : 22, contentWidth / 24)} color={Color4.create(0.88, 0.94, 1, 1)} height={scoreHeight} />
        {finalEntries.length > 0 ? (
          <UiEntity uiTransform={{ width: '100%', height: finalEntries.length * resultRowHeight, flexShrink: 0, flexDirection: 'column', margin: { top: 4, bottom: 4 } }}>
            {finalEntries.map((entry, index) => (
              <UiEntity key={`match-result-${entry.playerId}`} uiTransform={{ width: '100%', height: resultRowHeight, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: { left: 4, right: 4 } }}>
                <UiEntity uiTransform={{ width: '32%', height: '100%' }}>
                  <ImpactLabel value={`${placementLabel(resultStart + index)}  ${entry.isLocal ? 'YOU' : String(entry.name).slice(0, narrow ? 8 : 12)}`} fontSize={Math.min(compact ? 13 : 18, contentWidth / 22)} color={Color4.create(0.94, 0.94, 1, 1)} height={resultRowHeight} align="middle-left" />
                </UiEntity>
                <RankLabelImage points={entry.rankPoints} width={Math.min(132, contentWidth * 0.30)} height={resultRowHeight - 2} />
                <UiEntity uiTransform={{ width: '32%', height: '100%' }}>
                  <ImpactLabel value={`${entry.score}  ${entry.maxCombo}x`} fontSize={Math.min(compact ? 13 : 18, contentWidth / 22)} color={Color4.create(1, 0.82, 0.22, 1)} height={resultRowHeight} align="middle-right" />
                </UiEntity>
              </UiEntity>
            ))}
          </UiEntity>
        ) : null}
        <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: padding, left: padding + 2 }, width: contentWidth, height: buttonHeight, alignItems: 'center', justifyContent: 'center' }}>
          <MenuButton label="CONTINUE" tone="cyan" onClick={closeResults} width={Math.min(360, contentWidth * 0.88)} height={buttonHeight} fontSize={compact ? 20 : 23} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Root UI component
// ──────────────────────────────────────────────────────────
function SoloTransitionScreen(): ReactEcs.JSX.Element {
  const mobile = isMobile()

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        pointerFilter: 'block',
      }}
    >
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: mobile
            ? { top: '-30%' as PercentUnit, left: '-30%' as PercentUnit }
            : { top: 0, left: 0 },
          width: mobile ? '160%' : '100%',
          height: mobile ? '160%' : '100%',
          pointerFilter: 'none',
        }}
        uiBackground={{ color: Color4.create(0.015, 0.01, 0.07, 0.98) }}
      />
      <UiEntity
        uiTransform={{
          width: mobile ? 500 : 560,
          height: mobile ? 220 : 240,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 22,
          borderWidth: 2,
          borderColor: Color4.create(0.12, 0.92, 0.86, 0.82),
          pointerFilter: 'none',
        }}
        uiBackground={{ color: Color4.create(0.02, 0.025, 0.12, 0.92) }}
      >
        <MenuTitleImage src={SOLO_STAGE_TITLE} width={mobile ? 420 : 480} height={mobile ? 94 : 106} />
        <Label
          value="PREPARING YOUR PRIVATE DANCE FLOOR"
          fontSize={mobile ? 17 : 19}
          color={Color4.create(0.44, 1.0, 0.92, 1)}
          uiTransform={{ width: '100%', height: 36 }}
          textAlign="middle-center"
        />
        <UiEntity
          uiTransform={{ width: mobile ? 320 : 360, height: 8, margin: { top: 14 }, borderRadius: 8, pointerFilter: 'none' }}
          uiBackground={{ color: Color4.create(0.10, 0.12, 0.28, 1) }}
        >
          <UiEntity
            uiTransform={{ width: '100%', height: '100%', borderRadius: 8, pointerFilter: 'none' }}
            uiBackground={{ color: Color4.create(0.16, 0.88, 1.0, 1) }}
          />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

function AuditionUI(): ReactEcs.JSX.Element {
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%' }}>

      <RankBadgePreload />
      <LevelTitlePreload />

      {!isRankPopupBlockingResults() && gameState.phase === 'idle' && gameState.lobbyPrompt === 'choice' ? <LobbyChoiceScreen /> : null}
      {!isRankPopupBlockingResults() && gameState.phase === 'idle' && gameState.lobbyPrompt === 'play' ? <IdleScreen /> : null}
      {!isRankPopupBlockingResults() && gameState.phase === 'idle' && gameState.lobbyPrompt === 'leaderboards' ? <LeaderboardMenuScreen /> : null}
      {!isRankPopupBlockingResults() && gameState.phase === 'idle' && gameState.lobbyPrompt === 'hidden' ? <SidePlayMenu /> : null}
      {!isRankPopupBlockingResults() && gameState.phase === 'ready'    ? <ReadyScreen />    : null}
      {!isRankPopupBlockingResults() && !isSoloTransitionPending() && gameState.phase === 'gameover' ? <GameOverScreen /> : null}

      {isSoloTransitionPending() ? <SoloTransitionScreen /> : null}

      {gameState.phase === 'playing' ? (
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { top: 0, left: 0 },
            width: '100%',
            height: '100%',
            pointerFilter: 'block',
          }}
        >
          <MeasureBar />
          {gameState.playMode === 'multiplayer' ? <MatchPositionPanel /> : null}
          {gameState.playMode === 'solo' ? <ScorePanel /> : null}
          <ModeBadge />
          {!isMobile() ? <RankAvatarBadge /> : null}
          {!isMobile() ? <DailyGoalsPanel /> : null}
          <KeynoteBar />
          {gameState.roundState === 'active' ? <RhythmTimeline /> : null}
          <JumpOffButton />
          <OfficialMobileControls />
          <JudgmentDisplay />
        </UiEntity>
      ) : null}

      <RankUpCelebration />

    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Public initialiser
// ──────────────────────────────────────────────────────────
export function setupUI(): void {
  buttonSoundEntity = engine.addEntity()
  AudioSource.create(buttonSoundEntity, {
    audioClipUrl: BUTTON_SOUND,
    playing: false,
    volume: 0.95,
    loop: false,
    global: true,
  })
  buttonHoverSoundEntity = engine.addEntity()
  AudioSource.create(buttonHoverSoundEntity, {
    audioClipUrl: BUTTON_SOUND,
    playing: false,
    volume: 0.42,
    loop: false,
    global: true,
  })
  ReactEcsRenderer.setUiRenderer(AuditionUI)
}
