import {
  AudioSource,
  AvatarEmoteCommand,
  AvatarModifierArea,
  AvatarModifierType,
  engine,
  inputSystem,
  InputAction,
  InputModifier,
  MainCamera,
  PointerEventType,
  TouchScreenControls,
  Transform,
  type Entity,
  VirtualCamera,
} from '@dcl/sdk/ecs'
import { Schemas } from '@dcl/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { isServer, registerMessages } from '@dcl/sdk/network'
import { isMobile } from '@dcl/sdk/platform'
import { getPlayer, onEnterScene, onLeaveScene } from '@dcl/sdk/players'
import { movePlayerTo, stopEmote, triggerEmote } from '~system/RestrictedActions'
import {
  Direction,
  BEAT_DURATION,
  MEASURE_DURATION,
  TOTAL_MEASURES,
} from './beatmap'
import { DANCE_RANKS, getDanceRankIndex, RANK_UP_DURATION } from './ranks'

// ──────────────────────────────────────────────────────────
// Judgment zone
// ──────────────────────────────────────────────────────────
// The rhythm ball travels from measureProgress=0 to 1 each measure.
// The "optimal" Space press is at JUDGMENT_CENTER.
// Space is only accepted once the ball enters the active timing window.
export const JUDGMENT_CENTER     = 0.875

// Timing windows (seconds from JUDGMENT_CENTER moment)
export const PERFECT_WINDOW = 0.035   // ±35 ms
export const GREAT_WINDOW   = 0.075   // ±75 ms
export const COOL_WINDOW    = 0.120   // ±120 ms
export const BAD_WINDOW     = 0.180   // ±180 ms
export const JUDGMENT_DISPLAY_DURATION = 1.8
export const MISS_DISPLAY_DURATION = 1.35
const MIN_HIT_WINDOW_PROGRESS = 0.07
const MOBILE_HIT_LATENCY_COMPENSATION_SECONDS = 0.038
const MOBILE_TOUCH_GRACE_SECONDS = 0.018

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────
export type JudgmentText = 'PERFECT!' | 'GREAT!' | 'COOL!' | 'GOOD!' | 'MISS!'
export type RoundMode = 'easy' | 'middle' | 'freestyle' | 'hard'
export type RoundState = 'active' | 'waiting'
export type PlayMode = 'none' | 'solo' | 'multiplayer'
export type LobbyPrompt = 'choice' | 'play' | 'leaderboards' | 'hidden'

export interface SequenceStep {
  displayDirection: Direction
  inputDirection: Direction
  inverted: boolean
}

export interface Judgment {
  text: JudgmentText
  timer: number
  totalDuration: number
}

export interface DailyGoal {
  id: 'perfect_hits' | 'perfect_combo' | 'finish_song' | 'score_total' | 'great_hits' | 'cool_hits' | 'multiplayer_match'
    | 'reverse_sequence' | 'final_move' | 'freestyle_sequence' | 'hard_sequence' | 'long_sequence' | 'completed_sequences' | 'solo_match'
  label: string
  progress: number
  target: number
  rewardRp: number
  completed: boolean
}

export interface MatchPlayer {
  playerId: string
  name: string
  score: number
  maxCombo: number
  rankPoints: number
  wins: number
  matchesPlayed: number
  slotIndex: number
  finished: boolean
  ready: boolean
  phase: GameState['phase']
  matchStartTime: number
  judgmentText: JudgmentText | ''
  judgmentCombo: number
  judgmentSentAt: number
  judgmentTimer: number
  isLocal: boolean
  lastSeen: number
}

export interface GameState {
  phase: 'idle' | 'ready' | 'playing' | 'gameover'
  playMode: PlayMode
  lobbyPrompt: LobbyPrompt
  roundState: RoundState
  roundMode: RoundMode
  waitTimer: number
  waitDuration: number
  roundDuration: number
  score: number
  combo: number
  maxCombo: number
  perfectHits: number
  greatHits: number
  coolHits: number
  badHits: number
  misses: number
  measureCount: number        // measures elapsed (game ends at TOTAL_MEASURES)
  runFinishedAwarded: boolean

  // Rhythm
  measureTime: number         // seconds elapsed in this measure
  measureProgress: number     // 0 → 1 within the measure
  currentBeat: number         // global beat index (read by dancefloor)
  beatPulse: number           // 1.0 on beat, decays to 0

  // Sequence for this measure
  currentSequence: SequenceStep[]
  inputIndex: number          // how many arrows correctly entered so far
  sequenceFailed: boolean     // wrong arrow pressed — sequence broken

  // Space hit
  spacePressed: boolean       // has Space been pressed this measure?
  hitMarkerProgress: number   // marker position captured when HIT is pressed

  // Visuals
  judgment: Judgment | null
  keyFlash: Record<Direction, number>   // 1.0 on press, decays to 0
  spaceFlash: number                    // 1.0 on Space press, decays

  // Retention / multiplayer prototype
  rankPoints: number
  danceRank: string
  nextRankPoints: number
  rankProgress: number
  dailyGoals: DailyGoal[]
  matchPlayers: MatchPlayer[]
  matchWinnerName: string
  winnerPlayerId: string
  winnerCelebrationTimer: number
  globalLeaderboard: MatchPlayer[]
  lastDanceLeaderboard: MatchPlayer[]
  multiplayerReadyWindow: number
  multiplayerCountdown: number
  multiplayerLiveRemaining: number
}

declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | undefined

const SAVE_KEY_PREFIX = 'dropbeat-progress-v3'
const GLOBAL_LEADERBOARD_SAVE_KEY = 'beat-score-global-leaderboard'
const GLOBAL_LEADERBOARD_LIMIT = 20
const DAILY_GOALS_VERSION = 2
let dailyGoalsSeed = getDailySeed()

function getDailySeed(): string {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

function getGoalScale(rankPoints: number): number {
  if (rankPoints >= 900) return 3
  if (rankPoints >= 500) return 2.4
  if (rankPoints >= 250) return 1.8
  if (rankPoints >= 100) return 1.35
  return 1
}

function createDailyGoals(rankPoints = 0, daySeed = getDailySeed(), playerId = 'local-player'): DailyGoal[] {
  const scale = getGoalScale(rankPoints)
  const rng = seededRandom(hashString(`${DAILY_GOALS_VERSION}:${daySeed}:${playerId.toLowerCase()}:${getDanceRankIndex(rankPoints)}`))
  const pick = <T,>(options: readonly T[]): T => options[Math.floor(rng() * options.length)]
  const goal = (id: DailyGoal['id'], target: number, label: string, rewardRp: number): DailyGoal => ({
    id, target, label, rewardRp: Math.round(rewardRp * scale), progress: 0, completed: false,
  })
  const perfect = pick([2, 3, 5, 8])
  const combo = pick([3, 4, 5])
  const great = pick([2, 3, 5])
  const cool = pick([2, 3, 4])
  const reverse = pick([1, 2, 3])
  const freestyle = pick([1, 2, 3])
  const hard = pick([1, 2, 3])
  const long = pick([1, 2])
  const sequences = pick([3, 5, 8])
  const songs = pick([1, 2])
  const score = pick([5000, 8000, 12000, 18000])
  // One technique, one timing challenge and one session goal prevent three
  // nearly identical hit counters from occupying the whole daily set.
  const groups: DailyGoal[][] = [
    [
      goal('reverse_sequence', reverse, `${reverse} REVERSE SEQ`, 25 + reverse * 10),
      goal('final_move', 1, '1 FINAL MOVE', 55),
      goal('freestyle_sequence', freestyle, `${freestyle} FREESTYLE SEQ`, 25 + freestyle * 8),
      goal('hard_sequence', hard, `${hard} HARD SEQ`, 28 + hard * 8),
      goal('long_sequence', long, `${long} LONG SEQ (8+)`, 30 + long * 10),
    ],
    [
      goal('perfect_hits', perfect, `${perfect} PERFECT`, 12 + perfect * 6),
      goal('perfect_combo', combo, `${combo}x PERFECT`, 24 + combo * 5),
      goal('great_hits', great, `${great} GREAT`, 14 + great * 5),
      goal('cool_hits', cool, `${cool} COOL`, 14 + cool * 5),
    ],
    [
      goal('completed_sequences', sequences, `${sequences} SEQUENCES`, 18 + sequences * 4),
      goal('score_total', score, `${score} SCORE`, 20 + score / 1000),
      goal('finish_song', songs, `FINISH ${songs} SONG${songs > 1 ? 'S' : ''}`, 40 + songs * 15),
      goal('multiplayer_match', 1, 'FINISH 1 MULTI', 45),
      goal('solo_match', 1, 'FINISH 1 SOLO', 40),
    ],
  ]
  const selected = groups.map(group => pick(group))
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const previous = selected[i]
    selected[i] = selected[j]
    selected[j] = previous
  }
  return selected
}

// ──────────────────────────────────────────────────────────
// Shared mutable state — read by ui.tsx and dancefloor.ts
// ──────────────────────────────────────────────────────────
export const gameState: GameState = {
  phase: 'idle',
  playMode: 'none',
  lobbyPrompt: 'choice',
  roundState: 'active',
  roundMode: 'easy',
  waitTimer: 0,
  waitDuration: 0,
  roundDuration: MEASURE_DURATION,
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfectHits: 0,
  greatHits: 0,
  coolHits: 0,
  badHits: 0,
  misses: 0,
  measureCount: 0,
  runFinishedAwarded: false,
  measureTime: 0,
  measureProgress: 0,
  currentBeat: 0,
  beatPulse: 0,
  currentSequence: [],
  inputIndex: 0,
  sequenceFailed: false,
  spacePressed: false,
  hitMarkerProgress: 0,
  judgment: null,
  keyFlash: { left: 0, down: 0, up: 0, right: 0, upLeft: 0, upRight: 0 },
  spaceFlash: 0,
  rankPoints: 0,
  danceRank: DANCE_RANKS[0].name,
  nextRankPoints: DANCE_RANKS[1].points,
  rankProgress: 0,
  dailyGoals: createDailyGoals(),
  matchPlayers: [],
  matchWinnerName: '',
  winnerPlayerId: '',
  winnerCelebrationTimer: 0,
  globalLeaderboard: [],
  lastDanceLeaderboard: [],
  multiplayerReadyWindow: 0,
  multiplayerCountdown: 0,
  multiplayerLiveRemaining: 0,
}

// Mobile control feedback is independent from scoring, so every tap feels responsive.
export const mobileTapFeedback = {
  left: 0,
  down: 0,
  up: 0,
  right: 0,
  hit: 0,
}

export const arrowInputFeedback: {
  direction: Direction | null
  sequenceIndex: number
  correct: boolean
  timer: number
  duration: number
} = {
  direction: null,
  sequenceIndex: -1,
  correct: true,
  timer: 0,
  duration: 0.55,
}

// ──────────────────────────────────────────────────────────
// Internal
// ──────────────────────────────────────────────────────────
let totalBeats = 0
let playerMovementLocked = false
let playerEmotesDisabled = false
let sceneEmoteAllowanceUntil = 0
let lastLocalEmoteTimestamp = -1
let touchControlsHidden = false
let jumpOffRequested = false
let matchRestrictionRefreshTimer = 0
let cinematicReady = false
let cinematicCameraActive = false
let cinematicTime = 0
let hitCinematicTimer = 0
let hitSoundEntity = engine.RootEntity
let arrowClapSoundEntity = engine.RootEntity
let arrowFailSoundEntity = engine.RootEntity
let matchMusicEntity = engine.RootEntity
let cinematicTargetEntity = engine.RootEntity
let cinematicCameraEntity = engine.RootEntity
const SCENE_X_OFFSET = 16
const SCENE_Z_OFFSET = 16
const DANCE_FLOOR_HEIGHT = 0.30
const sceneX = (x: number): number => x + SCENE_X_OFFSET
const sceneZ = (z: number): number => z + SCENE_Z_OFFSET

let cinematicCameraPosition = Vector3.create(sceneX(16), 2.6, sceneZ(7.4))
let cinematicCameraFov = 58
let multiplayerSyncTimer = 0
let winnerCelebrationStarted = false
let matchSlotsLocked = false
let lockedLocalDanceSlotIndex = -1
const lockedMatchSlotByPlayerId = new Map<string, number>()
let postGameReturnTimer = 0
let multiplayerMatchStartTimeMs = 0
let syncedMultiplayerMeasure = -1
let syncedMultiplayerState: RoundState | null = null
let localAudienceSlotIndex = -1
let localAudienceSlotPlayerId = ''
let audienceEnforceTimer = 0
let remoteLiveMatchTimer = 0
let remoteLiveMatchStartTimeMs = 0
let cachedMultiplayerMatchDuration = 0
let localMatchElapsed = 0
let cachedLocalPlayerId = ''
let cachedLocalPlayerName = 'YOU'
let localJoinConfirmed = false
let latestLocalJoinAckSentAt = 0
let serverReadyMatchStartTimeMs = 0
let serverClockOffsetMs = 0
let serverClockSynchronized = false

const ALL_DIRS: Direction[] = ['left', 'down', 'up', 'right', 'upLeft', 'upRight']
const BASIC_DIRS: Direction[] = ['left', 'down', 'up', 'right']
const HARD_DIRS: Direction[] = ['left', 'down', 'up', 'right']
const COMBO_COUNTDOWN_DURATION = 3.0
const SESSION_AUDIENCE_ID = `guest-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`
const DANCE_FLOOR_MIN_X = sceneX(7.4)
const DANCE_FLOOR_MAX_X = sceneX(24.6)
const DANCE_FLOOR_MIN_Z = sceneZ(7.4)
const DANCE_FLOOR_MAX_Z = sceneZ(24.6)
// Every client derives the same public match from UTC time. This prevents a late
// player (or another island) from creating a second lobby with a different timer.
const MULTIPLAYER_READY_WINDOW = 90.0
const MULTIPLAYER_READY_WINDOW_MS = MULTIPLAYER_READY_WINDOW * 1000
const MAX_MULTIPLAYER_PLAYERS = 20
const MULTIPLAYER_SYNC_INTERVAL = 1.5
const STALE_MATCH_PLAYER_MS = 20000
const MATCH_START_TOLERANCE_MS = 2500
const SOLO_PRESENCE_SYNC_INTERVAL = 5.0
const STALE_SOLO_PLAYER_MS = 20000
const SOLO_ROSTER_REQUEST_INTERVAL = 2.0
const SOLO_VISIBILITY_REFRESH_INTERVAL = 0.2
const SOLO_START_WARMUP_REBUILDS = 12
// Allow the authoritative roster and streamed avatars to settle before every
// solo client is moved onto the shared physical dance slot.
const SOLO_START_VISIBILITY_GRACE = 2.8
// Keep the compact dance-floor modifier alive while the player is still in the
// audience for several physics ticks. The following teleport then produces a
// real outside -> inside event instead of creating the area around the player.
const SOLO_DANCE_ISOLATION_ARM_DELAY = 0.35

const NetworkMatchPlayerSchema = Schemas.Map({
  playerId: Schemas.String,
  name: Schemas.String,
  score: Schemas.Int,
  maxCombo: Schemas.Int,
  rankPoints: Schemas.Int,
  wins: Schemas.Int,
  matchesPlayed: Schemas.Int,
  slotIndex: Schemas.Int,
  ready: Schemas.Boolean,
  finished: Schemas.Boolean,
  measureCount: Schemas.Int,
  phase: Schemas.String,
  sentAt: Schemas.Int64,
  matchStartTime: Schemas.Int64,
  judgmentText: Schemas.String,
  judgmentCombo: Schemas.Int,
  judgmentSentAt: Schemas.Int64,
})

const multiplayerRoom = registerMessages({
  rankPresence: Schemas.Map({
    playerId: Schemas.String,
    rankPoints: Schemas.Int,
    rankUpId: Schemas.Int64,
    rankUpPoints: Schemas.Int,
    rankUpAgeMs: Schemas.Int,
  }),
  rankRosterRequest: Schemas.Map({ requesterId: Schemas.String }),
  playerUpdate: NetworkMatchPlayerSchema,
  playerLeave: Schemas.Map({
    playerId: Schemas.String,
  }),
  matchClock: Schemas.Map({
    matchStartTime: Schemas.Int64,
    sentAt: Schemas.Int64,
  }),
  soloIsolation: Schemas.Map({
    playerId: Schemas.String,
    active: Schemas.Boolean,
  }),
  // Small server-only broadcast used for the immediate visibility transition.
  // The full roster below remains the authoritative reconciliation snapshot.
  soloPresence: Schemas.Map({
    playerId: Schemas.String,
    active: Schemas.Boolean,
  }),
  soloRosterRequest: Schemas.Map({
    requesterId: Schemas.String,
  }),
  soloRoster: Schemas.Map({
    playerIds: Schemas.Array(Schemas.String),
    sentAt: Schemas.Int64,
    revision: Schemas.Int64,
  }),
})

const serverPlayers = new Map<string, ScorePayload>()
const serverSoloPlayers = new Map<string, number>()
const serverSoloPlayerIdByPeer = new Map<string, string>()
let networkHandlersInitialized = false
let soloIsolationEntity = engine.RootEntity
let soloIsolationPlayerId = ''
let soloIsolationLayout: 'scene' | 'dance' | '' = ''
let soloRosterVisibilityEntity = engine.RootEntity
let matchPassportLockEntity = engine.RootEntity
let matchPassportLockActive = false
const authoritativeSoloPlayerIds = new Set<string>()
const scenePlayerIds = new Set<string>()
let soloPresenceSyncTimer = 0
let soloRosterRequestTimer = 0
let soloVisibilityRefreshTimer = 0
let soloWarmupRebuilds = 0
let announcedSoloPlayerId = ''
let authoritativeSoloVisibilitySignature = ''
let serverSoloRosterRevision = 0
let latestSoloRosterRevision = -1
let pendingSoloStart = false
let pendingSoloStartDelay = -1
let soloDanceIsolationArmed = false

export interface PlayerRankPresence {
  playerId: string
  rankPoints: number
  rankUpId: number
  rankUpPoints: number
  rankUpTimer: number
  lastSeen: number
}

export const playerRankPresences = new Map<string, PlayerRankPresence>()
export const localRankUp = { id: 0, points: 0, timer: 0 }
// The world celebration runs immediately; modal celebrations have their own
// queue so a rank earned on the final HIT finishes before results enter.
export const rankUpPopup = { id: 0, points: 0, timer: 0, gap: 0 }
export const resultsPresentation = { elapsed: 0, remaining: 0 }
const rankUpPopupQueue: { id: number; points: number }[] = []
const RANK_UP_SOUND_URL = 'public/sounds/rankup.mp3'
let rankUpSoundEntity = engine.RootEntity

function initRankUpSound(): void {
  if (isServer() || rankUpSoundEntity !== engine.RootEntity) return
  rankUpSoundEntity = engine.addEntity()
  AudioSource.create(rankUpSoundEntity, {
    audioClipUrl: RANK_UP_SOUND_URL, playing: false, volume: 0.9, loop: false, global: true,
  })
}

export function isRankPopupBlockingResults(): boolean {
  return rankUpPopup.timer > 0 || rankUpPopup.gap > 0 ||
    (rankUpPopupQueue.length > 0 && resultsPresentation.elapsed === 0)
}

function tickRankPopup(dt: number): void {
  // Never interrupt an open results card or the solo loading screen.
  if (isSoloTransitionPending() || (gameState.phase === 'gameover' && resultsPresentation.elapsed > 0)) return
  if (rankUpPopup.timer > 0) {
    rankUpPopup.timer = Math.max(0, rankUpPopup.timer - dt)
    if (rankUpPopup.timer === 0) rankUpPopup.gap = 0.45
    return
  }
  if (rankUpPopup.gap > 0) {
    rankUpPopup.gap = Math.max(0, rankUpPopup.gap - dt)
    return
  }
  const next = rankUpPopupQueue.shift()
  if (next) {
    Object.assign(rankUpPopup, next, { timer: RANK_UP_DURATION })
    initRankUpSound()
    if (!isServer() && rankUpSoundEntity !== engine.RootEntity) AudioSource.playSound(rankUpSoundEntity, RANK_UP_SOUND_URL, true)
  }
}

export function closeResults(): void {
  if (gameState.phase === 'gameover' && resultsPresentation.elapsed >= 1.1) {
    postGameReturnTimer = Math.min(postGameReturnTimer, 1.5)
    resultsPresentation.remaining = postGameReturnTimer
  }
}
const serverRankPresences = new Map<string, {
  playerId: string; rankPoints: number; rankUpId: number; rankUpPoints: number; rankUpAgeMs: number; lastSeen: number
}>()
let rankPresenceSyncTimer = 0

export function isPlayerRankVisible(playerId: string): boolean {
  const id = normalizePlayerId(playerId)
  const localId = normalizePlayerId(getLocalPlayerIdentity().playerId)
  if (id === localId) return true
  // Keep labels and celebrations inside the same visibility rules as avatars.
  if (gameState.playMode === 'solo' || pendingSoloStart) return false
  return !authoritativeSoloPlayerIds.has(id)
}

function applyRankPresence(value: Partial<{
  playerId: string; rankPoints: number; rankUpId: number; rankUpPoints: number; rankUpAgeMs: number
}>): void {
  const id = normalizePlayerId(String(value.playerId || ''))
  if (!id || id === 'local-player') return
  const localId = normalizePlayerId(getLocalPlayerIdentity().playerId)
  if (id === localId) return // Server echoes must never replay the local celebration.
  const previous = playerRankPresences.get(id)
  const rankPoints = Math.max(previous?.rankPoints || 0, Math.max(0, Math.floor(Number(value.rankPoints) || 0)))
  const rankUpId = Math.max(0, Number(value.rankUpId) || 0)
  const newPromotion = rankUpId > (previous?.rankUpId || 0)
  const rankUpPoints = Math.max(0, Math.min(rankPoints, Math.floor(Number(value.rankUpPoints) || 0)))
  playerRankPresences.set(id, {
    playerId: id,
    rankPoints,
    rankUpId: newPromotion ? rankUpId : previous?.rankUpId || 0,
    rankUpPoints: newPromotion ? rankUpPoints : previous?.rankUpPoints || 0,
    rankUpTimer: newPromotion && getDanceRankIndex(rankUpPoints) > 0
      ? Math.max(0, RANK_UP_DURATION - Math.max(0, Number(value.rankUpAgeMs) || 0) / 1000)
      : previous?.rankUpTimer || 0,
    lastSeen: Date.now(),
  })
  for (const rows of [gameState.matchPlayers, gameState.globalLeaderboard, gameState.lastDanceLeaderboard]) {
    for (const entry of rows) {
      if (normalizePlayerId(entry.playerId) === id) entry.rankPoints = rankPoints
    }
  }
}

function publishRankPresence(): void {
  if (isServer()) return
  const id = normalizePlayerId(getLocalPlayerIdentity().playerId)
  if (!id || id === 'local-player') return
  for (const [playerId] of playerRankPresences) {
    if (playerId === 'local-player') playerRankPresences.delete(playerId)
  }
  playerRankPresences.set(id, {
    playerId: id, rankPoints: gameState.rankPoints, rankUpId: localRankUp.id,
    rankUpPoints: localRankUp.points, rankUpTimer: localRankUp.timer, lastSeen: Date.now(),
  })
  void multiplayerRoom.send('rankPresence', {
    playerId: id, rankPoints: Math.floor(gameState.rankPoints), rankUpId: localRankUp.id,
    rankUpPoints: Math.floor(localRankUp.points),
    rankUpAgeMs: Math.round((RANK_UP_DURATION - localRankUp.timer) * 1000),
  })
}

function tickRankPresence(dt: number): void {
  tickRankPopup(dt)
  localRankUp.timer = Math.max(0, localRankUp.timer - dt)
  const now = Date.now()
  const localId = normalizePlayerId(getLocalPlayerIdentity().playerId)
  for (const [id, profile] of playerRankPresences) {
    profile.rankUpTimer = id === localId ? localRankUp.timer : Math.max(0, profile.rankUpTimer - dt)
    if (id !== localId && now - profile.lastSeen > STALE_MATCH_PLAYER_MS) playerRankPresences.delete(id)
  }
  for (const [id, profile] of serverRankPresences) {
    if (now - profile.lastSeen > STALE_MATCH_PLAYER_MS) serverRankPresences.delete(id)
  }
  rankPresenceSyncTimer += dt
  if (rankPresenceSyncTimer >= SOLO_PRESENCE_SYNC_INTERVAL || !playerRankPresences.has(localId)) {
    rankPresenceSyncTimer = 0
    publishRankPresence()
  }
}

// Four staggered rows keep all 20 dancers readable while removing the two
// front-corner positions that pulled the camera through the stage geometry.
const DANCE_SLOTS = [
  Vector3.create(sceneX(12.4), DANCE_FLOOR_HEIGHT, sceneZ(13.0)),
  Vector3.create(sceneX(14.8), DANCE_FLOOR_HEIGHT, sceneZ(13.0)),
  Vector3.create(sceneX(17.2), DANCE_FLOOR_HEIGHT, sceneZ(13.0)),
  Vector3.create(sceneX(19.6), DANCE_FLOOR_HEIGHT, sceneZ(13.0)),
  Vector3.create(sceneX(10.8), DANCE_FLOOR_HEIGHT, sceneZ(15.8)),
  Vector3.create(sceneX(13.4), DANCE_FLOOR_HEIGHT, sceneZ(15.8)),
  Vector3.create(sceneX(16.0), DANCE_FLOOR_HEIGHT, sceneZ(15.8)),
  Vector3.create(sceneX(18.6), DANCE_FLOOR_HEIGHT, sceneZ(15.8)),
  Vector3.create(sceneX(21.2), DANCE_FLOOR_HEIGHT, sceneZ(15.8)),
  Vector3.create(sceneX(9.8), DANCE_FLOOR_HEIGHT, sceneZ(18.4)),
  Vector3.create(sceneX(12.3), DANCE_FLOOR_HEIGHT, sceneZ(18.4)),
  Vector3.create(sceneX(14.8), DANCE_FLOOR_HEIGHT, sceneZ(18.4)),
  Vector3.create(sceneX(17.2), DANCE_FLOOR_HEIGHT, sceneZ(18.4)),
  Vector3.create(sceneX(19.7), DANCE_FLOOR_HEIGHT, sceneZ(18.4)),
  Vector3.create(sceneX(22.2), DANCE_FLOOR_HEIGHT, sceneZ(18.4)),
  Vector3.create(sceneX(10.8), DANCE_FLOOR_HEIGHT, sceneZ(21.0)),
  Vector3.create(sceneX(13.4), DANCE_FLOOR_HEIGHT, sceneZ(21.0)),
  Vector3.create(sceneX(16.0), DANCE_FLOOR_HEIGHT, sceneZ(21.0)),
  Vector3.create(sceneX(18.6), DANCE_FLOOR_HEIGHT, sceneZ(21.0)),
  Vector3.create(sceneX(21.2), DANCE_FLOOR_HEIGHT, sceneZ(21.0)),
]

const SOLO_DANCE_SLOT = Vector3.create(sceneX(16.0), DANCE_FLOOR_HEIGHT, sceneZ(21.4))

function createAudienceSlots(): Vector3[] {
  const slots: Vector3[] = []

  // Positions follow the nine "Bleacher Step" meshes in dropscoremodel.glb.
  // Each row stays inset from its mesh edges so avatars land fully on a step.
  const addSideRow = (x: number, y: number, zValues: number[]): void => {
    for (const z of zValues) slots.push(Vector3.create(sceneX(x), y, sceneZ(z)))
  }
  const addBackRow = (z: number, y: number, xValues: number[]): void => {
    for (const x of xValues) slots.push(Vector3.create(sceneX(x), y, sceneZ(z)))
  }

  addSideRow(5.5, 1.07, [10, 13, 16, 19, 22, 25])
  addSideRow(4.5, 1.77, [10, 13.5, 17, 20.5, 24])
  addSideRow(2.75, 2.57, [11.5, 15, 18.5, 22])

  addSideRow(27.5, 1.07, [10, 13, 16, 19, 22, 25])
  addSideRow(28.5, 1.77, [10, 13.5, 17, 20.5, 24])
  addSideRow(30.34, 2.57, [11.5, 15, 18.5, 22])

  addBackRow(27.5, 1.07, [9, 12, 15, 18, 21, 24])
  addBackRow(29.0, 1.77, [10, 13.5, 17, 20.5, 23.5])

  return slots
}

const AUDIENCE_SLOTS = createAudienceSlots()

interface ScorePayload {
  playerId: string
  name: string
  score: number
  maxCombo: number
  rankPoints: number
  wins: number
  matchesPlayed: number
  slotIndex: number
  ready: boolean
  finished: boolean
  measureCount: number
  phase: GameState['phase']
  sentAt: number
  matchStartTime: number
  judgmentText?: JudgmentText | ''
  judgmentCombo?: number
  judgmentSentAt?: number
}

function sanitizePhase(phase: string): GameState['phase'] {
  if (phase === 'ready' || phase === 'playing' || phase === 'gameover' || phase === 'idle') return phase
  return 'idle'
}

function sanitizeNetworkPlayer(value: ScorePayload): ScorePayload | null {
  if (!value || typeof value.playerId !== 'string' || value.playerId.length === 0) return null

  return {
    playerId: value.playerId,
    name: typeof value.name === 'string' && value.name.length > 0 ? value.name.slice(0, 40) : 'Dancer',
    score: Math.max(0, Math.floor(Number(value.score) || 0)),
    maxCombo: Math.max(0, Math.floor(Number(value.maxCombo) || 0)),
    rankPoints: Math.max(0, Math.floor(Number(value.rankPoints) || 0)),
    wins: Math.max(0, Math.floor(Number(value.wins) || 0)),
    matchesPlayed: Math.max(0, Math.floor(Number(value.matchesPlayed) || 0)),
    slotIndex: Math.max(0, Math.floor(Number(value.slotIndex) || 0)) % DANCE_SLOTS.length,
    ready: Boolean(value.ready),
    finished: Boolean(value.finished),
    measureCount: Math.max(0, Math.floor(Number(value.measureCount) || 0)),
    phase: sanitizePhase(String(value.phase)),
    sentAt: Math.max(0, Math.floor(Number(value.sentAt) || Date.now())),
    matchStartTime: Math.max(0, Math.floor(Number(value.matchStartTime) || 0)),
    judgmentText: value.judgmentText || '',
    judgmentCombo: Math.max(0, Math.floor(Number(value.judgmentCombo) || 0)),
    judgmentSentAt: Math.max(0, Math.floor(Number(value.judgmentSentAt) || 0)),
  }
}

function enforceServerReadyCapacity(payload: ScorePayload): ScorePayload {
  if (!payload.ready || payload.matchStartTime <= 0) return payload

  const existing = serverPlayers.get(payload.playerId)
  const roster = [...serverPlayers.values()]
    .filter(player =>
      player.ready &&
      (player.phase === 'ready' || player.phase === 'playing' || player.phase === 'gameover') &&
      Math.abs(player.matchStartTime - payload.matchStartTime) <= MATCH_START_TOLERANCE_MS
    )
    .filter(player => player.playerId !== payload.playerId)

  const usedSlots = new Set(roster.map(player => player.slotIndex % DANCE_SLOTS.length))
  const existingSlotIsValid = Boolean(
    existing?.ready &&
    Math.abs(existing.matchStartTime - payload.matchStartTime) <= MATCH_START_TOLERANCE_MS &&
    !usedSlots.has(existing.slotIndex % DANCE_SLOTS.length),
  )
  if (existingSlotIsValid) return { ...payload, slotIndex: existing!.slotIndex }

  if (roster.length >= MAX_MULTIPLAYER_PLAYERS) {
    return { ...payload, ready: false }
  }

  const freeSlot = DANCE_SLOTS.findIndex((_, index) => !usedSlots.has(index))
  // Never fall back to slot 0: that was the overlap path when a roster filled
  // or two stale reservations claimed the same position.
  return freeSlot >= 0
    ? { ...payload, slotIndex: freeSlot }
    : { ...payload, ready: false }
}

function applyNetworkPlayer(value: ScorePayload): void {
  if (gameState.playMode === 'solo') return
  const payload = sanitizeNetworkPlayer(value)
  if (!payload) return

  const local = getLocalPlayerIdentity()
  if (payload.playerId === local.playerId) {
    const localEntry = ensureLocalMatchPlayer()
    if (payload.phase === 'ready' && payload.sentAt >= latestLocalJoinAckSentAt) {
      latestLocalJoinAckSentAt = payload.sentAt
      localEntry.slotIndex = payload.slotIndex
      localEntry.ready = payload.ready
      localJoinConfirmed = payload.ready && Math.abs(payload.matchStartTime - multiplayerMatchStartTimeMs) <= MATCH_START_TOLERANCE_MS
    }
    if (payload.phase === 'playing' || payload.phase === 'gameover') {
      localEntry.slotIndex = payload.slotIndex
      lockedMatchSlotByPlayerId.set(payload.playerId, payload.slotIndex)
      lockedLocalDanceSlotIndex = payload.slotIndex
    }
    return
  }
  if (payload.phase === 'idle') {
    gameState.matchPlayers = gameState.matchPlayers.filter(player => player.playerId !== payload.playerId)
    sortMatchPlayers()
    return
  }
  if (payload.phase === 'playing') {
    remoteLiveMatchTimer = Math.max(remoteLiveMatchTimer, MULTIPLAYER_SYNC_INTERVAL * 3)
    if (payload.matchStartTime > 0) remoteLiveMatchStartTimeMs = payload.matchStartTime
  }
  if (payload.matchStartTime > 0) {
    const targetIsFuture = payload.matchStartTime > getMultiplayerNowMs()
    if (payload.phase === 'ready' && gameState.phase === 'ready' && targetIsFuture) {
      if (multiplayerMatchStartTimeMs <= 0 || payload.matchStartTime < multiplayerMatchStartTimeMs) {
        multiplayerMatchStartTimeMs = payload.matchStartTime
        syncLocalReadyPlayerForScheduledMatch()
      }
    } else if (gameState.phase !== 'ready' && multiplayerMatchStartTimeMs <= 0) {
      multiplayerMatchStartTimeMs = payload.matchStartTime
    }
  }

  const updatedPlayer = upsertMatchPlayer(
    payload.playerId,
    payload.name,
    payload.score,
    payload.maxCombo,
    Math.max(payload.rankPoints, playerRankPresences.get(normalizePlayerId(payload.playerId))?.rankPoints || 0),
    payload.wins,
    payload.matchesPlayed,
    payload.ready,
    payload.finished,
    false,
    payload.phase,
    payload.matchStartTime,
    payload.slotIndex,
    payload.judgmentText || '',
    payload.judgmentCombo || 0,
    payload.judgmentSentAt || 0,
  )
  if (authoritativeSoloPlayerIds.size > 0) syncAuthoritativeSoloVisibility()
  if (updatedPlayer.finished || updatedPlayer.phase === 'gameover') {
    recordLeaderboardEntry(updatedPlayer)
  }

  const localEntry = gameState.matchPlayers.find(player => player.playerId === local.playerId)
  if (
    gameState.phase === 'ready' &&
    gameState.playMode === 'multiplayer' &&
    localEntry?.ready &&
    payload.phase === 'playing' &&
    isSameScheduledMatch(payload.matchStartTime) &&
    getMultiplayerNowMs() >= multiplayerMatchStartTimeMs - MATCH_START_TOLERANCE_MS
  ) {
    startGame('multiplayer')
    return
  }

  tryStartWinnerSpotlight()
}

function applyNetworkClock(matchStartTime: number, serverSentAt: number): void {
  if (gameState.playMode === 'solo') return
  if (matchStartTime <= 0) return
  syncServerClock(serverSentAt)
  if (gameState.phase === 'ready' && matchStartTime > getMultiplayerNowMs()) {
    multiplayerMatchStartTimeMs = matchStartTime
    syncLocalReadyPlayerForScheduledMatch()
    syncGlobalMultiplayerWindow()
  } else if (gameState.phase !== 'ready' && multiplayerMatchStartTimeMs <= 0) {
    multiplayerMatchStartTimeMs = matchStartTime
  }
}

function syncServerClock(serverSentAt: number): void {
  if (!Number.isFinite(serverSentAt) || serverSentAt <= 0) return
  const sample = serverSentAt - Date.now()
  if (!serverClockSynchronized) {
    serverClockOffsetMs = sample
    serverClockSynchronized = true
    return
  }

  // Smooth network jitter while still converging quickly if a tester's system
  // clock is several seconds away from the authoritative scene clock.
  serverClockOffsetMs += (sample - serverClockOffsetMs) * 0.25
}

function getMultiplayerNowMs(): number {
  return Date.now() + (serverClockSynchronized ? serverClockOffsetMs : 0)
}

function getNextMultiplayerMatchStartMs(): number {
  const now = getMultiplayerNowMs()
  if (serverReadyMatchStartTimeMs > now) return serverReadyMatchStartTimeMs
  return now + MULTIPLAYER_READY_WINDOW_MS
}

function getGlobalMultiplayerReadyWindow(): number {
  const now = getMultiplayerNowMs()
  const startTime = multiplayerMatchStartTimeMs > now
    ? multiplayerMatchStartTimeMs
    : getNextMultiplayerMatchStartMs()
  return Math.max(0, (startTime - now) / 1000)
}

function syncGlobalMultiplayerWindow(): number {
  const remaining = getGlobalMultiplayerReadyWindow()
  gameState.multiplayerReadyWindow = remaining
  return remaining
}

function getMultiplayerMatchDuration(): number {
  if (cachedMultiplayerMatchDuration > 0) return cachedMultiplayerMatchDuration

  let duration = 0
  for (let measure = 0; measure < TOTAL_MEASURES; measure++) {
    const mode = getRoundMode(measure)
    duration += getComboWaitDuration(measure) + getRoundDuration(mode, measure)
  }
  cachedMultiplayerMatchDuration = duration
  return cachedMultiplayerMatchDuration
}

function getBaseComboWaitDuration(_measureCount: number): number {
  return COMBO_COUNTDOWN_DURATION
}

function syncMultiplayerLiveRemaining(): number {
  if (remoteLiveMatchTimer <= 0 || remoteLiveMatchStartTimeMs <= 0) {
    gameState.multiplayerLiveRemaining = 0
    return 0
  }

  const elapsed = Math.max(0, (getMultiplayerNowMs() - remoteLiveMatchStartTimeMs) / 1000)
  const remaining = Math.max(0, getMultiplayerMatchDuration() - elapsed)
  gameState.multiplayerLiveRemaining = remaining
  if (remaining <= 0) remoteLiveMatchTimer = 0
  return remaining
}

function normalizePlayerId(playerId: string): string {
  return playerId.trim().toLowerCase()
}

function setSoloIsolationActive(active: boolean, _force = false): void {
  if (active) {
    const localPlayerId = normalizePlayerId(getPlayer()?.userId || '')
    if (!localPlayerId) return
    // One scene-wide area for the whole solo session, updated in place. The
    // Explorer shows every avatar inside an area when that area is removed,
    // and avatars already inside get no new enter event from a replacement,
    // so rebuilding the area (or swapping it for a smaller one) unhides them.
    const layout = 'scene'
    if (
      soloIsolationEntity !== engine.RootEntity &&
      soloIsolationPlayerId === localPlayerId &&
      AvatarModifierArea.has(soloIsolationEntity)
    ) return
    if (soloIsolationEntity === engine.RootEntity) {
      soloIsolationEntity = engine.addEntity()
    }
    Transform.createOrReplace(soloIsolationEntity, {
      position: Vector3.create(sceneX(16), 16, sceneZ(16)),
    })
    AvatarModifierArea.createOrReplace(soloIsolationEntity, {
      area: Vector3.create(63.8, 32, 63.8),
      excludeIds: [localPlayerId],
      modifiers: [
        AvatarModifierType.AMT_HIDE_AVATARS,
        AvatarModifierType.AMT_HIDE_NAMETAGS,
        AvatarModifierType.AMT_DISABLE_PASSPORTS,
      ],
    })
    soloIsolationPlayerId = localPlayerId
    soloIsolationLayout = layout
    return
  }

  const previousSoloPlayerId = soloIsolationPlayerId
  if (soloIsolationEntity !== engine.RootEntity) {
    engine.removeEntity(soloIsolationEntity)
  }
  soloIsolationEntity = engine.RootEntity
  soloIsolationPlayerId = ''
  soloIsolationLayout = ''
  soloWarmupRebuilds = 0
  if (previousSoloPlayerId) {
    authoritativeSoloPlayerIds.delete(previousSoloPlayerId)
    authoritativeSoloVisibilitySignature = ''
    syncAuthoritativeSoloVisibility(true)
  }
}

function setMatchPassportLock(active: boolean, force = false): void {
  const stateChanged = active !== matchPassportLockActive
  if (active === matchPassportLockActive && !force) return

  if (active) {
    if (matchPassportLockEntity === engine.RootEntity) {
      matchPassportLockEntity = engine.addEntity()
    }
    Transform.createOrReplace(matchPassportLockEntity, {
      parent: engine.PlayerEntity,
      position: Vector3.create(0, 8, 0),
    })
    AvatarModifierArea.createOrReplace(matchPassportLockEntity, {
      // Follow the local dancer. Any avatar close enough to be tapped is always
      // inside this volume, independent of scene/world coordinate offsets.
      area: Vector3.create(64, 24, 64),
      excludeIds: [],
      modifiers: [AvatarModifierType.AMT_DISABLE_PASSPORTS],
    })
  } else if (
    matchPassportLockEntity !== engine.RootEntity &&
    AvatarModifierArea.has(matchPassportLockEntity)
  ) {
    AvatarModifierArea.deleteFrom(matchPassportLockEntity)
  }

  matchPassportLockActive = active
  if (stateChanged && active && authoritativeSoloPlayerIds.size > 0) {
    // Older clients choose the most recently entered overlapping modifier
    // area. Recreate authoritative solo visibility last so hiding solo avatars
    // always wins over the passport-only match area.
    syncAuthoritativeSoloVisibility(true)
  }
}

function syncAuthoritativeSoloVisibility(forceRecreate = false): void {
  const localSoloIsolationActive = pendingSoloStart || (
    gameState.playMode === 'solo' &&
    (gameState.phase === 'playing' || gameState.phase === 'gameover')
  )
  // Older clients only honor one overlapping AvatarModifierArea. A
  // solo client therefore uses only its stricter local area (hide everybody
  // except self). The authoritative roster area is for all non-solo clients.
  if (localSoloIsolationActive) {
    if (soloRosterVisibilityEntity !== engine.RootEntity) {
      engine.removeEntity(soloRosterVisibilityEntity)
    }
    soloRosterVisibilityEntity = engine.RootEntity
    authoritativeSoloVisibilitySignature = ''
    return
  }

  if (authoritativeSoloPlayerIds.size === 0) {
    if (soloRosterVisibilityEntity !== engine.RootEntity) {
      engine.removeEntity(soloRosterVisibilityEntity)
    }
    soloRosterVisibilityEntity = engine.RootEntity
    authoritativeSoloVisibilitySignature = ''
    return
  }

  const localPlayerId = normalizePlayerId(getLocalPlayerIdentity().playerId)
  const visiblePlayerIds = new Set<string>([
    ...[...scenePlayerIds].map(normalizePlayerId),
    ...gameState.matchPlayers.map(player => normalizePlayerId(player.playerId)),
    localPlayerId,
  ])
  // One scene-wide mask hides every server-confirmed remote solo avatar. The
  // local avatar is always exempt so a solo player can still see themselves.
  for (const soloPlayerId of authoritativeSoloPlayerIds) {
    if (soloPlayerId !== localPlayerId) visiblePlayerIds.delete(soloPlayerId)
  }

  const excludeIds = [...visiblePlayerIds].filter(id => id && id !== 'local-player').sort()
  const visibilitySignature = `${[...authoritativeSoloPlayerIds].sort().join(',')}|${excludeIds.join(',')}`
  // Update the existing area in place instead of rebuilding it: the Explorer
  // re-applies excludeIds to avatars already inside, while removing the area
  // would show every avatar it held without hiding them again.
  void forceRecreate
  if (
    visibilitySignature === authoritativeSoloVisibilitySignature &&
    soloRosterVisibilityEntity !== engine.RootEntity &&
    AvatarModifierArea.has(soloRosterVisibilityEntity)
  ) return
  if (soloRosterVisibilityEntity === engine.RootEntity) {
    soloRosterVisibilityEntity = engine.addEntity()
  }
  Transform.createOrReplace(soloRosterVisibilityEntity, {
    position: Vector3.create(sceneX(16), 16, sceneZ(16)),
  })
  AvatarModifierArea.createOrReplace(soloRosterVisibilityEntity, {
    area: Vector3.create(63.8, 32, 63.8),
    excludeIds,
    modifiers: [
      AvatarModifierType.AMT_HIDE_AVATARS,
      AvatarModifierType.AMT_HIDE_NAMETAGS,
      AvatarModifierType.AMT_DISABLE_PASSPORTS,
    ],
  })
  authoritativeSoloVisibilitySignature = visibilitySignature
}

function applyAuthoritativeSoloRoster(playerIds: readonly string[]): void {
  authoritativeSoloPlayerIds.clear()
  for (const playerId of playerIds) {
    if (typeof playerId !== 'string') continue
    const normalizedPlayerId = normalizePlayerId(playerId)
    if (normalizedPlayerId) authoritativeSoloPlayerIds.add(normalizedPlayerId)
  }
  syncAuthoritativeSoloVisibility()
}

function applyAuthoritativeSoloPresence(playerId: string, active: boolean): void {
  const normalizedPlayerId = normalizePlayerId(playerId)
  if (!normalizedPlayerId || normalizedPlayerId === 'local-player') return

  const membershipChanged = active
    ? !authoritativeSoloPlayerIds.has(normalizedPlayerId)
    : authoritativeSoloPlayerIds.has(normalizedPlayerId)

  if (active) {
    authoritativeSoloPlayerIds.add(normalizedPlayerId)
    gameState.matchPlayers = gameState.matchPlayers.filter(
      player => normalizePlayerId(player.playerId) !== normalizedPlayerId,
    )
    sortMatchPlayers()
  } else {
    authoritativeSoloPlayerIds.delete(normalizedPlayerId)
  }

  if (membershipChanged) authoritativeSoloVisibilitySignature = ''
  syncAuthoritativeSoloVisibility(membershipChanged)
}

function pruneServerSoloRoster(now = Date.now()): boolean {
  let changed = false
  for (const [playerId, lastSeen] of serverSoloPlayers) {
    if (now - lastSeen > STALE_SOLO_PLAYER_MS) {
      serverSoloPlayers.delete(playerId)
      changed = true
    }
  }
  return changed
}

function broadcastServerSoloRoster(membershipChanged = false, recipients?: string[]): void {
  if (!isServer()) return
  const now = Date.now()
  const pruned = pruneServerSoloRoster(now)
  if (membershipChanged || pruned) serverSoloRosterRevision++
  const options = recipients && !pruned ? { to: recipients } : undefined
  void multiplayerRoom.send('soloRoster', {
    playerIds: [...serverSoloPlayers.keys()].sort(),
    sentAt: now,
    revision: serverSoloRosterRevision,
  }, options)
}

function broadcastServerSoloPresence(playerId: string, active: boolean): void {
  if (!isServer() || !playerId || playerId === 'local-player') return
  void multiplayerRoom.send('soloPresence', { playerId, active })
}

function resetMultiplayerReadyWindow(): void {
  const liveRemaining = syncMultiplayerLiveRemaining()
  const remaining = liveRemaining > 0 ? liveRemaining : syncGlobalMultiplayerWindow()
  gameState.multiplayerReadyWindow = liveRemaining > 0 ? 0 : remaining
  gameState.waitTimer = remaining
  gameState.waitDuration = liveRemaining > 0 ? getMultiplayerMatchDuration() : MULTIPLAYER_READY_WINDOW
  gameState.multiplayerCountdown = remaining
}

function tickLobbyMatchWindow(): void {
  if (gameState.phase !== 'idle' || gameState.playMode !== 'none') return
  syncGlobalMultiplayerWindow()
  syncMultiplayerLiveRemaining()
}

function isQueuedReadyPlayer(player: MatchPlayer): boolean {
  return player.ready && player.phase === 'ready'
}

function isActiveMatchPlayer(player: MatchPlayer): boolean {
  return player.ready && (player.phase === 'playing' || player.phase === 'gameover')
}

function isSameScheduledMatch(matchStartTime: number): boolean {
  return (
    multiplayerMatchStartTimeMs > 0 &&
    matchStartTime > 0 &&
    Math.abs(matchStartTime - multiplayerMatchStartTimeMs) <= MATCH_START_TOLERANCE_MS
  )
}

function sortScheduledPlayers<T extends { playerId: string; rankPoints: number }>(players: T[]): T[] {
  return players.sort((a, b) => {
    if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
    return a.playerId.localeCompare(b.playerId)
  })
}

function getQueuedReadyPlayers(): MatchPlayer[] {
  return getScheduledMatchParticipants().filter(isQueuedReadyPlayer)
}

function syncLocalReadyPlayerForScheduledMatch(): void {
  if (gameState.phase !== 'ready' || gameState.playMode !== 'multiplayer') return

  const local = ensureLocalMatchPlayer()
  local.phase = 'ready'
  local.matchStartTime = multiplayerMatchStartTimeMs
  if (local.ready) local.finished = false
}

function getScheduledMatchParticipants(): MatchPlayer[] {
  return sortScheduledPlayers(gameState.matchPlayers
    .filter(player =>
      player.ready &&
      (player.phase === 'ready' || player.phase === 'playing') &&
      isSameScheduledMatch(player.matchStartTime)
    ))
    .slice(0, MAX_MULTIPLAYER_PLAYERS)
}

function tickMultiplayerReadyWindow(): void {
  if (gameState.phase !== 'ready' || gameState.playMode !== 'multiplayer') return

  const local = ensureLocalMatchPlayer()
  const liveRemaining = syncMultiplayerLiveRemaining()

  if (liveRemaining > 0) {
    multiplayerMatchStartTimeMs = remoteLiveMatchStartTimeMs
    if (local.ready && localJoinConfirmed && isSameScheduledMatch(local.matchStartTime)) {
      startGame('multiplayer')
      return
    }

    // Spectators cannot reserve a slot while a battle is in progress.
    if (local.ready) {
      local.ready = false
      localJoinConfirmed = false
      local.finished = false
      publishScore(false)
    }
    local.phase = 'ready'
    local.matchStartTime = 0
    gameState.waitTimer = liveRemaining
    gameState.waitDuration = getMultiplayerMatchDuration()
    gameState.multiplayerCountdown = liveRemaining
    return
  }

  gameState.multiplayerLiveRemaining = 0
  if (multiplayerMatchStartTimeMs <= getMultiplayerNowMs()) {
    if (local.ready && localJoinConfirmed) {
      startGame('multiplayer')
      return
    }
    multiplayerMatchStartTimeMs = getMultiplayerNowMs() + MULTIPLAYER_READY_WINDOW_MS
    local.ready = false
    localJoinConfirmed = false
    local.matchStartTime = multiplayerMatchStartTimeMs
    publishScore(false)
  }

  const remaining = syncGlobalMultiplayerWindow()
  gameState.multiplayerReadyWindow = remaining
  gameState.waitTimer = remaining
  gameState.waitDuration = MULTIPLAYER_READY_WINDOW
  gameState.multiplayerCountdown = remaining
  syncLocalReadyPlayerForScheduledMatch()
}

// Hit-bar travel time, independent from lobby and between-combo countdowns.
// The first long-combo tier receives a small reading allowance so its transition
// is smooth; after that the marker continues accelerating without random speed changes.
// These values include the 0.1014545-second per-round alignment needed for
// 22 rounds plus fixed 3-second countdowns to end with the 158.832-second song.
const HIT_BAR_START_DURATION = 4.7414545
const HIT_BAR_END_DURATION = 3.6414545
const HIT_BAR_MODE_ALLOWANCE: Record<RoundMode, number> = {
  easy: 0,
  middle: -0.08,
  freestyle: 0.18,
  hard: -0.06,
}
const FINAL_MOVE_TIME_ALLOWANCE = 0.24

const MODE_SCORE_MULTIPLIER: Record<RoundMode, number> = {
  easy: 1.0,
  middle: 1.15,
  freestyle: 2.0,
  hard: 1.75,
}

const INVERTED_INPUT: Record<Direction, Direction> = {
  left: 'right',
  right: 'left',
  up: 'down',
  down: 'up',
  upLeft: 'upRight',
  upRight: 'upLeft',
}

const MODE_LABELS: Record<RoundMode, string> = {
  easy: 'EASY',
  middle: 'INTERMEDIATE',
  freestyle: 'REVERSE STYLE',
  hard: 'HARD',
}

const COMBO_EMOTE_TRACK = [
  'disco',
  'robot',
  'tik',
  'disco',
  'robot',
  'tik',
]
const FAIL_EMOTE = 'shrug'
const FACE_GLOBAL_LEADERBOARD_ROTATION = Quaternion.fromEulerDegrees(0, 180, 0)
const HIT_CINEMATIC_APPROACH = 1.45
const HIT_CINEMATIC_HOLD = 4.0
const HIT_CINEMATIC_RELEASE = 2.45
const HIT_CINEMATIC_DURATION = HIT_CINEMATIC_APPROACH + HIT_CINEMATIC_HOLD + HIT_CINEMATIC_RELEASE
const WINNER_CELEBRATION_DURATION = 8.0
const WINNER_EMOTE = 'disco'
const LOSER_EMOTE = 'dontsee'
const HIT_SOUND_URL = 'public/sounds/clap.mp3'
const ARROW_CLAP_SOUND_URL = 'public/sounds/clap-arrow.mp3'
const ARROW_FAIL_SOUND_URL = 'public/sounds/fail-arrow.mp3'
const MATCH_MUSIC_URL = 'public/sounds/beatdropmusic.mp3'
const POST_GAME_RESULT_DURATION = WINNER_CELEBRATION_DURATION

function playPredefinedEmote(predefinedEmote: string): void {
  // InputModifier blocks voluntary emotes but still allows scene-authored dance
  // feedback. Mark this short window so the mobile fallback below preserves it.
  sceneEmoteAllowanceUntil = Date.now() + 1500
  void triggerEmote({ predefinedEmote }).catch(() => {})
}

function stopLocalDanceEmote(): void {
  // Scene-authored score/winner emotes can outlive the gameplay state on some
  // mobile clients. Revoke the allowance first, then explicitly stop playback.
  sceneEmoteAllowanceUntil = 0
  void stopEmote({}).catch(() => {})
}

function stopUnauthorizedPlayerEmotes(): void {
  if (gameState.phase !== 'playing') return

  let newestTimestamp = lastLocalEmoteTimestamp
  let newestState = -1
  for (const command of AvatarEmoteCommand.get(engine.PlayerEntity)) {
    if (command.timestamp <= newestTimestamp) continue
    newestTimestamp = command.timestamp
    newestState = command.state ?? 0
  }
  if (newestTimestamp <= lastLocalEmoteTimestamp) return

  lastLocalEmoteTimestamp = newestTimestamp
  const emoteStarted = newestState === 0
  if (emoteStarted && Date.now() > sceneEmoteAllowanceUntil) {
    void stopEmote({}).catch(() => {})
  }
}

function playComboSuccessEmote(combo: number): void {
  const trackIndex = Math.max(combo - 1, 0) % COMBO_EMOTE_TRACK.length
  playPredefinedEmote(COMBO_EMOTE_TRACK[trackIndex])
}

function playGoodDanceEmote(seed: number): void {
  const trackIndex = Math.max(seed, 0) % COMBO_EMOTE_TRACK.length
  playPredefinedEmote(COMBO_EMOTE_TRACK[trackIndex])
}

function playComboFailEmote(): void {
  playPredefinedEmote(FAIL_EMOTE)
}

function getLocalDanceSlotPosition(): Vector3 {
  if (gameState.playMode === 'solo') return SOLO_DANCE_SLOT

  if (gameState.playMode === 'multiplayer' && lockedLocalDanceSlotIndex >= 0) {
    return DANCE_SLOTS[lockedLocalDanceSlotIndex % DANCE_SLOTS.length]
  }

  const local = getLocalPlayerIdentity()
  const entry = gameState.matchPlayers.find(player => player.playerId === local.playerId)
  return DANCE_SLOTS[(entry?.slotIndex ?? 0) % DANCE_SLOTS.length]
}

function hashPlayerId(playerId: string): number {
  let hash = 0
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0
  }
  return hash
}

export function getDanceSlotForPlayer(playerId: string): Vector3 {
  const lockedSlotIndex = lockedMatchSlotByPlayerId.get(playerId)
  if (lockedSlotIndex !== undefined) {
    return DANCE_SLOTS[lockedSlotIndex % DANCE_SLOTS.length]
  }

  if (
    gameState.playMode === 'multiplayer' &&
    lockedLocalDanceSlotIndex >= 0 &&
    playerId === getLocalPlayerIdentity().playerId
  ) {
    return DANCE_SLOTS[lockedLocalDanceSlotIndex % DANCE_SLOTS.length]
  }

  const entry = gameState.matchPlayers.find(player => player.playerId === playerId)
  return DANCE_SLOTS[(entry?.slotIndex ?? 0) % DANCE_SLOTS.length]
}

function getAudienceSlotForPlayer(playerId: string): Vector3 {
  return AUDIENCE_SLOTS[hashPlayerId(playerId) % AUDIENCE_SLOTS.length]
}

function getLocalAudienceSlotPosition(): Vector3 {
  const player = getPlayer()
  const playerId = player?.userId || 'guest'
  const sessionSlotId = `${playerId}-${SESSION_AUDIENCE_ID}`
  if (localAudienceSlotIndex < 0 || localAudienceSlotPlayerId !== sessionSlotId) {
    localAudienceSlotPlayerId = sessionSlotId
    localAudienceSlotIndex = hashPlayerId(sessionSlotId) % AUDIENCE_SLOTS.length
  }

  const slot = AUDIENCE_SLOTS[localAudienceSlotIndex]
  const hash = hashPlayerId(`${sessionSlotId}-offset`)
  const offsetX = ((hash % 7) - 3) * 0.12
  const offsetZ = (((hash >>> 3) % 7) - 3) * 0.12
  return Vector3.create(slot.x + offsetX, slot.y, slot.z + offsetZ)
}

function isInsideDanceFloor(position: Vector3): boolean {
  return (
    position.x >= DANCE_FLOOR_MIN_X &&
    position.x <= DANCE_FLOOR_MAX_X &&
    position.z >= DANCE_FLOOR_MIN_Z &&
    position.z <= DANCE_FLOOR_MAX_Z
  )
}

function canLocalPlayerBeOnDanceFloor(): boolean {
  if (gameState.phase === 'gameover' && postGameReturnTimer > 0) return !isMobile()
  return gameState.phase === 'playing' && (gameState.playMode === 'solo' || gameState.playMode === 'multiplayer')
}

function isDanceFloorRestricted(): boolean {
  return (
    gameState.phase === 'playing' ||
    (gameState.phase === 'gameover' && postGameReturnTimer > 0) ||
    gameState.multiplayerLiveRemaining > 0
  )
}

function getCameraFocusSlotPosition(): Vector3 {
  if (gameState.phase !== 'playing' && gameState.winnerCelebrationTimer > 0 && gameState.winnerPlayerId) {
    return getDanceSlotForPlayer(gameState.winnerPlayerId)
  }

  return getLocalDanceSlotPosition()
}

function clampCameraX(value: number): number {
  return Math.max(sceneX(10.0), Math.min(sceneX(22.0), value))
}

function getCameraSide(slot: Vector3): number {
  const offsetFromCenter = slot.x - sceneX(16)
  if (Math.abs(offsetFromCenter) > 0.5) return offsetFromCenter < 0 ? -1 : 1

  const slotIndex = DANCE_SLOTS.indexOf(slot)
  return slotIndex % 2 === 0 ? -1 : 1
}

function getLocalCameraTargetPosition(): Vector3 {
  const slot = getCameraFocusSlotPosition()
  return Vector3.create(slot.x, 1.45, slot.z)
}

function getLocalCameraStartPosition(): Vector3 {
  const target = getLocalCameraTargetPosition()
  const slot = getCameraFocusSlotPosition()
  const cameraX = clampCameraX(target.x + getCameraSide(slot) * 0.9)
  const cameraZ = Math.max(target.z - 7.2, sceneZ(8.8))
  return Vector3.create(cameraX, 2.7, cameraZ)
}

function playHitBeatSound(): void {
  if (hitSoundEntity === engine.RootEntity) return

  const slot = getLocalDanceSlotPosition()
  Transform.createOrReplace(hitSoundEntity, {
    position: Vector3.create(slot.x, 1.2, slot.z),
  })
  AudioSource.playSound(hitSoundEntity, HIT_SOUND_URL, true)
}

function playArrowClapSound(): void {
  if (arrowClapSoundEntity === engine.RootEntity) return

  const slot = getLocalDanceSlotPosition()
  Transform.createOrReplace(arrowClapSoundEntity, {
    position: Vector3.create(slot.x, 1.2, slot.z),
  })
  AudioSource.playSound(arrowClapSoundEntity, ARROW_CLAP_SOUND_URL, true)
}

function playArrowFailSound(): void {
  if (arrowFailSoundEntity === engine.RootEntity) return

  const slot = getLocalDanceSlotPosition()
  Transform.createOrReplace(arrowFailSoundEntity, {
    position: Vector3.create(slot.x, 1.2, slot.z),
  })
  AudioSource.playSound(arrowFailSoundEntity, ARROW_FAIL_SOUND_URL, true)
}

function playMatchMusic(): void {
  if (matchMusicEntity === engine.RootEntity) return

  Transform.createOrReplace(matchMusicEntity, {
    position: Vector3.create(sceneX(16), 2.2, sceneZ(16)),
  })
  AudioSource.createOrReplace(matchMusicEntity, {
    audioClipUrl: MATCH_MUSIC_URL,
    playing: true,
    volume: 0.72,
    loop: false,
    global: true,
  })
}

function stopMatchMusic(): void {
  if (matchMusicEntity === engine.RootEntity) return

  AudioSource.createOrReplace(matchMusicEntity, {
    audioClipUrl: MATCH_MUSIC_URL,
    playing: false,
    volume: 0.72,
    loop: false,
    global: true,
  })
}

function getLocalPlayerIdentity(): { playerId: string; name: string } {
  const player = getPlayer()
  if (player?.userId) cachedLocalPlayerId = player.userId
  if (player?.name) cachedLocalPlayerName = player.name
  return {
    playerId: cachedLocalPlayerId || 'local-player',
    name: cachedLocalPlayerName,
  }
}

function lockLocalDanceSlot(): void {
  const localPlayerId = getLocalPlayerIdentity().playerId
  const localEntry = gameState.matchPlayers.find(player => player.playerId === localPlayerId || player.isLocal)
  lockedLocalDanceSlotIndex = localEntry?.slotIndex ?? 0
}

function resetMatchSlotLocks(): void {
  matchSlotsLocked = false
  lockedLocalDanceSlotIndex = -1
  lockedMatchSlotByPlayerId.clear()
}

function lockMatchSlots(): void {
  lockedMatchSlotByPlayerId.clear()
  getScheduledMatchParticipants().forEach((player) => {
    lockedMatchSlotByPlayerId.set(player.playerId, player.slotIndex)
  })
  lockLocalDanceSlot()
  matchSlotsLocked = true
}

function sortMatchPlayers(): void {
  gameState.matchPlayers.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.maxCombo - a.maxCombo
  })
  gameState.matchWinnerName = gameState.matchPlayers[0]?.name || ''
  updateLastDanceLeaderboardSnapshot()
}

function updateLastDanceLeaderboardSnapshot(): void {
  const entries = gameState.matchPlayers.filter(isActiveMatchPlayer)
  if (entries.length === 0) return

  gameState.lastDanceLeaderboard = entries
    .map(entry => ({ ...entry }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.maxCombo !== a.maxCombo) return b.maxCombo - a.maxCombo
      if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
      return a.name.localeCompare(b.name)
    })
}

function normalizeLeaderboardEntry(value: unknown): MatchPlayer | null {
  const raw = value as Partial<MatchPlayer> | null
  if (!raw || typeof raw.playerId !== 'string' || raw.playerId.length === 0) return null

  return {
    playerId: raw.playerId,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name.slice(0, 40) : 'Dancer',
    score: Math.max(0, Math.floor(Number(raw.score) || 0)),
    maxCombo: Math.max(0, Math.floor(Number(raw.maxCombo) || 0)),
    rankPoints: Math.max(0, Math.floor(Number(raw.rankPoints) || 0)),
    wins: Math.max(0, Math.floor(Number(raw.wins) || 0)),
    matchesPlayed: Math.max(0, Math.floor(Number(raw.matchesPlayed) || 0)),
    slotIndex: Math.max(0, Math.floor(Number(raw.slotIndex) || 0)) % DANCE_SLOTS.length,
    finished: Boolean(raw.finished),
    ready: false,
    phase: 'idle',
    matchStartTime: 0,
    judgmentText: '',
    judgmentCombo: 0,
    judgmentSentAt: 0,
    judgmentTimer: 0,
    isLocal: false,
    lastSeen: Math.max(0, Math.floor(Number(raw.lastSeen) || Date.now())),
  }
}

function sortGlobalLeaderboard(): void {
  gameState.globalLeaderboard.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (b.score !== a.score) return b.score - a.score
    if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
    return b.maxCombo - a.maxCombo
  })
  gameState.globalLeaderboard = gameState.globalLeaderboard.slice(0, GLOBAL_LEADERBOARD_LIMIT)
}

function saveGlobalLeaderboard(): void {
  try {
    const storage = typeof localStorage === 'undefined' ? undefined : localStorage
    if (!storage) return

    storage.setItem(GLOBAL_LEADERBOARD_SAVE_KEY, JSON.stringify(gameState.globalLeaderboard.map(entry => ({
      playerId: entry.playerId,
      name: entry.name,
      score: entry.score,
      maxCombo: entry.maxCombo,
      rankPoints: entry.rankPoints,
      wins: entry.wins,
      matchesPlayed: entry.matchesPlayed,
      slotIndex: entry.slotIndex,
      finished: entry.finished,
      lastSeen: entry.lastSeen,
    }))))
  } catch {}
}

function loadGlobalLeaderboard(): void {
  try {
    const storage = typeof localStorage === 'undefined' ? undefined : localStorage
    const raw = storage?.getItem(GLOBAL_LEADERBOARD_SAVE_KEY)
    if (!raw) return

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return

    gameState.globalLeaderboard = parsed
      .map(normalizeLeaderboardEntry)
      .filter((entry): entry is MatchPlayer => entry !== null)
    sortGlobalLeaderboard()
  } catch {}
}

function recordLeaderboardEntry(entry: MatchPlayer): void {
  const existing = gameState.globalLeaderboard.find(item => item.playerId === entry.playerId)
  if (!existing) {
    gameState.globalLeaderboard.push({ ...entry })
  } else {
    existing.name = entry.name
    existing.score = Math.max(existing.score, entry.score)
    existing.maxCombo = Math.max(existing.maxCombo, entry.maxCombo)
    existing.rankPoints = entry.rankPoints
    existing.wins = Math.max(existing.wins, entry.wins)
    existing.matchesPlayed = Math.max(existing.matchesPlayed, entry.matchesPlayed)
    existing.finished = entry.finished || existing.finished
    existing.slotIndex = entry.slotIndex
    existing.lastSeen = entry.lastSeen
  }

  sortGlobalLeaderboard()
  saveGlobalLeaderboard()
}

function getMatchWinner(): MatchPlayer | null {
  const participants = gameState.matchPlayers.filter(isActiveMatchPlayer)
  if (participants.length === 0) return null

  return participants.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.maxCombo !== a.maxCombo) return b.maxCombo - a.maxCombo
    if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
    return a.playerId.localeCompare(b.playerId)
  })[0]
}

function startVictoryCameraMotion(winner: MatchPlayer): void {
  gameState.matchWinnerName = winner.name
  gameState.winnerPlayerId = winner.playerId
  gameState.winnerCelebrationTimer = WINNER_CELEBRATION_DURATION
  hitCinematicTimer = 0

  const playerTransform = Transform.getOrNull(engine.PlayerEntity)
  if (playerTransform) {
    cinematicCameraPosition = Vector3.create(
      playerTransform.position.x,
      playerTransform.position.y + 1.8,
      playerTransform.position.z,
    )
  }

  setCinematicCameraActive(!(isMobile() && gameState.phase === 'gameover'))
}

function startWinnerSpotlight(winner: MatchPlayer): void {
  if (winnerCelebrationStarted) return

  winnerCelebrationStarted = true
  startVictoryCameraMotion(winner)

  const local = getLocalPlayerIdentity()
  if (winner.playerId === local.playerId) {
    winner.wins += 1
    recordLeaderboardEntry(winner)
    saveProgress()
    if (!(isMobile() && gameState.phase === 'gameover')) playPredefinedEmote(WINNER_EMOTE)
    publishScore(true)
  } else {
    recordLeaderboardEntry(winner)
    if (!(isMobile() && gameState.phase === 'gameover')) playPredefinedEmote(LOSER_EMOTE)
  }
}

function tryStartWinnerSpotlight(): void {
  if (winnerCelebrationStarted) return
  const participants = gameState.matchPlayers.filter(isActiveMatchPlayer)
  if (participants.length === 0) return
  if (!participants.every(player => player.finished)) return

  const winner = getMatchWinner()
  if (winner) startWinnerSpotlight(winner)
}

function upsertMatchPlayer(
  playerId: string,
  name: string,
  score: number,
  maxCombo: number,
  rankPoints: number,
  wins: number,
  matchesPlayed: number,
  ready: boolean,
  finished: boolean,
  isLocal: boolean,
  phase: GameState['phase'] = 'idle',
  matchStartTime = 0,
  slotIndex = 0,
  judgmentText: JudgmentText | '' = '',
  judgmentCombo = 0,
  judgmentSentAt = 0,
): MatchPlayer {
  let entry = gameState.matchPlayers.find(player => player.playerId === playerId)
  if (!entry) {
    entry = {
      playerId,
      name,
      score,
      maxCombo,
      rankPoints,
      wins,
      matchesPlayed,
      slotIndex: Math.max(0, Math.floor(slotIndex)) % DANCE_SLOTS.length,
      finished,
      ready,
      phase,
      matchStartTime,
      judgmentText: '',
      judgmentCombo: 0,
      judgmentSentAt: 0,
      judgmentTimer: 0,
      isLocal,
      lastSeen: Date.now(),
    }
    gameState.matchPlayers.push(entry)
  }

  entry.name = name
  entry.score = score
  entry.maxCombo = maxCombo
  entry.rankPoints = rankPoints
  entry.wins = Math.max(entry.wins, wins)
  entry.matchesPlayed = Math.max(entry.matchesPlayed, matchesPlayed)
  entry.finished = phase === 'ready' || phase === 'idle' ? finished : finished || entry.finished
  entry.ready = ready
  entry.phase = phase
  entry.matchStartTime = matchStartTime
  if (gameState.playMode === 'multiplayer' && (phase === 'ready' || phase === 'playing' || phase === 'gameover')) {
    entry.slotIndex = Math.max(0, Math.floor(slotIndex)) % DANCE_SLOTS.length
    if (phase === 'playing' || phase === 'gameover') lockedMatchSlotByPlayerId.set(playerId, entry.slotIndex)
  }
  if (judgmentSentAt > 0 && judgmentSentAt >= entry.judgmentSentAt) {
    entry.judgmentText = judgmentText
    entry.judgmentCombo = judgmentCombo
    entry.judgmentSentAt = judgmentSentAt
    entry.judgmentTimer = judgmentText ? 1.25 : 0
  }
  entry.isLocal = isLocal
  entry.lastSeen = Date.now()
  sortMatchPlayers()

  if (entry.finished) {
    recordLeaderboardEntry(entry)
  }

  return entry
}

function ensureLocalMatchPlayer(): MatchPlayer {
  const local = getLocalPlayerIdentity()
  let entry = gameState.matchPlayers.find(player => player.playerId === local.playerId)
  if (!entry && local.playerId !== 'local-player') {
    const provisionalEntry = gameState.matchPlayers.find(player => player.isLocal && player.playerId === 'local-player')
    if (provisionalEntry) {
      provisionalEntry.playerId = local.playerId
      entry = provisionalEntry
    }
  }
  if (!entry) {
    entry = {
      playerId: local.playerId,
      name: local.name,
      score: 0,
      maxCombo: 0,
      rankPoints: gameState.rankPoints,
      wins: 0,
      matchesPlayed: 0,
      slotIndex: 0,
      finished: false,
      ready: false,
      phase: gameState.phase,
      matchStartTime: multiplayerMatchStartTimeMs,
      judgmentText: '',
      judgmentCombo: 0,
      judgmentSentAt: 0,
      judgmentTimer: 0,
      isLocal: true,
      lastSeen: Date.now(),
    }
    gameState.matchPlayers.push(entry)
  }
  entry.name = local.name
  entry.rankPoints = gameState.rankPoints
  entry.matchesPlayed = Math.max(0, entry.matchesPlayed)
  entry.phase = gameState.phase
  entry.matchStartTime = multiplayerMatchStartTimeMs
  entry.isLocal = true
  entry.lastSeen = Date.now()
  for (const player of gameState.matchPlayers) {
    if (player !== entry && player.isLocal) player.isLocal = false
  }
  return entry
}

function updateLocalMatchPlayer(finished = false): void {
  const entry = ensureLocalMatchPlayer()
  entry.score = gameState.score
  entry.maxCombo = gameState.maxCombo
  entry.rankPoints = gameState.rankPoints
  entry.ready = gameState.playMode === 'multiplayer'
  entry.phase = gameState.phase
  entry.matchStartTime = multiplayerMatchStartTimeMs
  entry.finished = finished || entry.finished
  entry.lastSeen = Date.now()
  sortMatchPlayers()
}

function setLocalJudgment(text: JudgmentText, combo = 0): void {
  const entry = ensureLocalMatchPlayer()
  entry.judgmentText = text
  entry.judgmentCombo = combo
  entry.judgmentSentAt = Date.now()
  entry.judgmentTimer = text === 'MISS!' ? MISS_DISPLAY_DURATION : JUDGMENT_DISPLAY_DURATION
}

function prepareMultiplayerParticipants(): void {
  const local = ensureLocalMatchPlayer()
  local.ready = true
  local.phase = 'ready'
  local.matchStartTime = multiplayerMatchStartTimeMs
  local.rankPoints = gameState.rankPoints

  gameState.matchPlayers = getScheduledMatchParticipants()
  for (const player of gameState.matchPlayers) {
    player.score = 0
    player.maxCombo = 0
    player.finished = false
    player.phase = 'playing'
    player.matchStartTime = multiplayerMatchStartTimeMs
    player.judgmentText = ''
    player.judgmentCombo = 0
    player.judgmentSentAt = 0
    player.judgmentTimer = 0
    player.lastSeen = Date.now()
  }
  sortMatchPlayers()
}

function publishScore(finished = false): void {
  if (gameState.playMode !== 'multiplayer') return

  const local = ensureLocalMatchPlayer()
  local.finished = finished || local.finished
  void multiplayerRoom.send('playerUpdate', {
    playerId: local.playerId,
    name: local.name,
    score: Math.floor(local.score),
    maxCombo: Math.floor(local.maxCombo),
    rankPoints: Math.floor(local.rankPoints),
    wins: Math.floor(local.wins),
    matchesPlayed: Math.floor(local.matchesPlayed),
    slotIndex: Math.floor(local.slotIndex),
    ready: local.ready,
    finished: local.finished,
    measureCount: Math.floor(gameState.measureCount),
    phase: gameState.phase,
    sentAt: Date.now(),
    matchStartTime: Math.floor(multiplayerMatchStartTimeMs),
    judgmentText: local.judgmentText,
    judgmentCombo: Math.floor(local.judgmentCombo),
    judgmentSentAt: Math.floor(local.judgmentSentAt),
  })
}

function initMultiplayerScoreBus(): void {
  if (networkHandlersInitialized) return
  networkHandlersInitialized = true
  ensureLocalMatchPlayer()

  multiplayerRoom.onMessage('rankPresence', (value) => {
    const id = normalizePlayerId(String(value.playerId || ''))
    if (!id || id === 'local-player') return
    if (isServer()) {
      const previous = serverRankPresences.get(id)
      const rankUpId = Math.max(0, Number(value.rankUpId) || 0)
      // Ignore an older promotion snapshot arriving after a newer one.
      if (previous && rankUpId < previous.rankUpId) return
      const payload = {
        playerId: id,
        rankPoints: Math.max(previous?.rankPoints || 0, Math.max(0, Math.floor(Number(value.rankPoints) || 0))),
        rankUpId,
        rankUpPoints: Math.max(0, Math.floor(Number(value.rankUpPoints) || 0)),
        rankUpAgeMs: Math.max(0, Math.floor(Number(value.rankUpAgeMs) || 0)),
      }
      serverRankPresences.set(id, { ...payload, lastSeen: Date.now() })
      void multiplayerRoom.send('rankPresence', payload)
      return
    }
    applyRankPresence(value)
  })

  multiplayerRoom.onMessage('rankRosterRequest', (_value, context) => {
    if (!isServer()) return
    const now = Date.now()
    for (const profile of serverRankPresences.values()) {
      if (now - profile.lastSeen > STALE_MATCH_PLAYER_MS) continue
      const { lastSeen, ...payload } = profile
      void multiplayerRoom.send('rankPresence', {
        ...payload, rankUpAgeMs: payload.rankUpAgeMs + Math.max(0, now - lastSeen),
      }, context?.from ? { to: [context.from] } : undefined)
    }
  })

  multiplayerRoom.onMessage('playerUpdate', (value, context) => {
    let payload = sanitizeNetworkPlayer(value as ScorePayload)
    if (!payload) return

    if (isServer()) {
      const now = Date.now()
      // Server receipt time is authoritative. Client clocks can differ enough
      // to otherwise prune a live player or desynchronize their input window.
      payload.sentAt = now
      const normalizedPlayerId = normalizePlayerId(payload.playerId)
      const wasSolo = serverSoloPlayers.delete(normalizedPlayerId)
      if (wasSolo) {
        broadcastServerSoloPresence(normalizedPlayerId, false)
        broadcastServerSoloRoster(true)
      }
      if (payload.phase === 'idle') {
        serverPlayers.delete(payload.playerId)
        void multiplayerRoom.send('playerUpdate', payload)
        return
      }

      if (payload.matchStartTime > 0) {
        for (const [playerId, player] of serverPlayers) {
          if (now - player.sentAt > STALE_MATCH_PLAYER_MS) serverPlayers.delete(playerId)
        }
        const activePlayers = [...serverPlayers.values()].filter(player =>
          player.ready && player.phase === 'playing' && now - player.sentAt <= STALE_MATCH_PLAYER_MS
        )
        const activeStartTime = activePlayers[0]?.matchStartTime || 0

        if (payload.phase === 'ready') {
          if (activeStartTime > 0) {
            payload.ready = false
            payload.matchStartTime = activeStartTime
          } else {
            if (serverReadyMatchStartTimeMs <= now) {
              serverReadyMatchStartTimeMs = now + MULTIPLAYER_READY_WINDOW_MS
            }
            payload.matchStartTime = serverReadyMatchStartTimeMs
          }
        } else if (payload.phase === 'playing') {
          const validStart = serverReadyMatchStartTimeMs > 0 &&
            Math.abs(payload.matchStartTime - serverReadyMatchStartTimeMs) <= MATCH_START_TOLERANCE_MS
          if (!validStart && activeStartTime > 0 && Math.abs(payload.matchStartTime - activeStartTime) > MATCH_START_TOLERANCE_MS) {
            payload.ready = false
          }
        }
        payload = enforceServerReadyCapacity(payload)
        void multiplayerRoom.send('matchClock', {
          matchStartTime: payload.matchStartTime,
          sentAt: now,
        })
      }
      serverPlayers.set(payload.playerId, payload)
      void multiplayerRoom.send('playerUpdate', payload)
      return
    }

    applyNetworkPlayer(payload)
  })

  multiplayerRoom.onMessage('playerLeave', (value, context) => {
    const claimedPlayerId = normalizePlayerId(String(value.playerId || ''))
    const boundPlayerId = isServer() && context?.from
      ? serverSoloPlayerIdByPeer.get(context.from)
      : undefined
    const playerId = boundPlayerId || claimedPlayerId
    if (!playerId) return
    if (isServer()) {
      if (context?.from) serverSoloPlayerIdByPeer.delete(context.from)
      serverPlayers.delete(playerId)
      const wasSolo = serverSoloPlayers.delete(playerId)
      if (wasSolo) {
        broadcastServerSoloPresence(playerId, false)
        broadcastServerSoloRoster(true)
      }
      void multiplayerRoom.send('playerLeave', { playerId })
    } else {
      gameState.matchPlayers = gameState.matchPlayers.filter(player => normalizePlayerId(player.playerId) !== playerId)
      if (!gameState.matchPlayers.some(player => player.ready && player.phase === 'playing')) {
        remoteLiveMatchTimer = 0
        remoteLiveMatchStartTimeMs = 0
        gameState.multiplayerLiveRemaining = 0
      }
      sortMatchPlayers()
    }
  })

  multiplayerRoom.onMessage('matchClock', (value) => {
    if (isServer()) return
    applyNetworkClock(Number(value.matchStartTime) || 0, Number(value.sentAt) || 0)
  })

  multiplayerRoom.onMessage('soloIsolation', (value, context) => {
    const claimedPlayerId = normalizePlayerId(String(value.playerId || ''))
    const active = Boolean(value.active)
    if (isServer()) {
      const peerId = context?.from || ''
      // AvatarModifierArea.excludeIds must receive the lowercase
      // PlayerIdentityData userId. Mobile transport peer IDs are not guaranteed
      // to use that same representation, so bind the authenticated peer to its
      // avatar ID and let the server own roster membership from that point on.
      const boundPlayerId = peerId ? serverSoloPlayerIdByPeer.get(peerId) : undefined
      const playerId = normalizePlayerId(active ? claimedPlayerId : (boundPlayerId || claimedPlayerId))
      if (!playerId || playerId === 'local-player') return
      if (active) {
        if (peerId && boundPlayerId && boundPlayerId !== playerId) {
          serverSoloPlayers.delete(boundPlayerId)
          broadcastServerSoloPresence(boundPlayerId, false)
        }
        if (peerId) serverSoloPlayerIdByPeer.set(peerId, playerId)
        const wasAlreadySolo = serverSoloPlayers.has(playerId)
        serverSoloPlayers.set(playerId, Date.now())
        serverPlayers.delete(playerId)
        void multiplayerRoom.send('playerLeave', { playerId })
        const identityChanged = Boolean(boundPlayerId && boundPlayerId !== playerId)
        if (wasAlreadySolo && !identityChanged) {
          broadcastServerSoloRoster(false, peerId ? [peerId] : undefined)
        } else {
          // Broadcast the changed avatar first so audience clients can hide it
          // without waiting for the larger roster reconciliation message.
          broadcastServerSoloPresence(playerId, true)
          broadcastServerSoloRoster(true)
        }
      } else {
        if (peerId) serverSoloPlayerIdByPeer.delete(peerId)
        const removed = serverSoloPlayers.delete(playerId)
        if (removed) {
          broadcastServerSoloPresence(playerId, false)
          broadcastServerSoloRoster(true)
        }
        else broadcastServerSoloRoster(false, peerId ? [peerId] : undefined)
      }
      return
    }
  })

  multiplayerRoom.onMessage('soloPresence', (value) => {
    if (isServer()) return
    applyAuthoritativeSoloPresence(String(value.playerId || ''), Boolean(value.active))
  })

  multiplayerRoom.onMessage('soloRosterRequest', (_value, context) => {
    if (isServer()) broadcastServerSoloRoster(false, context?.from ? [context.from] : undefined)
  })

  multiplayerRoom.onMessage('soloRoster', (value) => {
    if (isServer()) return
    const revision = Math.max(0, Math.floor(Number(value.revision) || 0))
    // Reapply equal revisions too. This repairs mobile avatar streaming without
    // requiring a membership change or a new server revision.
    if (revision < latestSoloRosterRevision) return
    latestSoloRosterRevision = revision
    syncServerClock(Number(value.sentAt) || 0)
    const playerIds = Array.isArray(value.playerIds) ? value.playerIds.map(String) : []
    applyAuthoritativeSoloRoster(playerIds)
    gameState.matchPlayers = gameState.matchPlayers.filter(player => !authoritativeSoloPlayerIds.has(normalizePlayerId(player.playerId)))
    sortMatchPlayers()
    const localPlayerId = normalizePlayerId(getLocalPlayerIdentity().playerId)
    if (pendingSoloStart && authoritativeSoloPlayerIds.has(localPlayerId)) {
      if (pendingSoloStartDelay < 0) {
        // Rebuild before gameplay while avatar profiles and renderer entities
        // settle. Equal-revision retries must not restart this sequence later.
        soloWarmupRebuilds = Math.max(soloWarmupRebuilds, SOLO_START_WARMUP_REBUILDS)
        soloVisibilityRefreshTimer = SOLO_VISIBILITY_REFRESH_INTERVAL
        pendingSoloStartDelay = SOLO_START_VISIBILITY_GRACE
      }
    }
  })

  multiplayerRoom.onReady((ready) => {
    if (isServer()) return
    if (!ready) {
      latestSoloRosterRevision = -1
      return
    }
    void multiplayerRoom.send('soloRosterRequest', { requesterId: getLocalPlayerIdentity().playerId })
    publishRankPresence()
    void multiplayerRoom.send('rankRosterRequest', { requesterId: getLocalPlayerIdentity().playerId })
    if (gameState.playMode === 'multiplayer') publishScore(false)
    if (gameState.playMode === 'solo') {
      void multiplayerRoom.send('soloIsolation', { playerId: getLocalPlayerIdentity().playerId, active: true })
    }
  })

  onEnterScene((player) => {
    scenePlayerIds.add(player.userId)
    publishRankPresence()
    syncAuthoritativeSoloVisibility(true)
    if (pendingSoloStart) {
      soloWarmupRebuilds = Math.max(soloWarmupRebuilds, SOLO_START_WARMUP_REBUILDS)
      soloVisibilityRefreshTimer = SOLO_VISIBILITY_REFRESH_INTERVAL
      setSoloIsolationActive(true, true)
    } else if (gameState.playMode === 'solo') {
      // Some Explorer builds do not apply an existing modifier to an avatar
      // whose profile/render entity finishes streaming late. Re-evaluate the
      // local mask immediately and once more on the next engine interval.
      setSoloIsolationActive(true, true)
      soloWarmupRebuilds = Math.max(soloWarmupRebuilds, 1)
      soloVisibilityRefreshTimer = SOLO_VISIBILITY_REFRESH_INTERVAL
    }
    if (gameState.playMode === 'solo') return

    const local = getLocalPlayerIdentity()
    if (player.userId === local.playerId) return
    upsertMatchPlayer(player.userId, player.name || 'Dancer', 0, 0, 0, 0, 0, false, false, false, 'idle', 0)
    publishScore(false)
  })

  onLeaveScene((userId) => {
    const normalizedUserId = normalizePlayerId(userId)
    playerRankPresences.delete(normalizedUserId)
    serverRankPresences.delete(normalizedUserId)
    scenePlayerIds.delete(userId)
    if (isServer()) {
      serverPlayers.delete(userId)
      for (const [peerId, playerId] of serverSoloPlayerIdByPeer) {
        if (playerId === normalizedUserId) serverSoloPlayerIdByPeer.delete(peerId)
      }
      if (serverSoloPlayers.delete(normalizedUserId)) {
        broadcastServerSoloPresence(normalizedUserId, false)
        broadcastServerSoloRoster(true)
      }
      void multiplayerRoom.send('playerLeave', { playerId: userId })
    }
    // Clients do not infer solo membership from avatar streaming events. A
    // transient leave/re-enter must not reveal that avatar; only the server's
    // presence/roster messages may remove it from the authoritative set.
    syncAuthoritativeSoloVisibility()
    gameState.matchPlayers = gameState.matchPlayers.filter(player => player.playerId !== userId)
    sortMatchPlayers()
  })
}

function pruneInactiveMatchPlayers(): void {
  if (gameState.playMode === 'solo') {
    gameState.matchPlayers = []
    gameState.matchWinnerName = ''
    return
  }

  const local = getLocalPlayerIdentity()
  const now = Date.now()
  gameState.matchPlayers = gameState.matchPlayers.filter(player =>
    player.isLocal ||
    player.playerId === local.playerId ||
    now - player.lastSeen <= STALE_MATCH_PLAYER_MS,
  )
  sortMatchPlayers()
}

function refreshRank(): void {
  const rankIndex = getDanceRankIndex(gameState.rankPoints)

  const current = DANCE_RANKS[rankIndex]
  const next = DANCE_RANKS[Math.min(rankIndex + 1, DANCE_RANKS.length - 1)]
  gameState.danceRank = current.name
  gameState.nextRankPoints = next.points
  gameState.rankProgress = next === current
    ? 1
    : Math.max(0, Math.min(1, (gameState.rankPoints - current.points) / (next.points - current.points)))
}

function getSaveKey(): string {
  return `${SAVE_KEY_PREFIX}:${getLocalPlayerIdentity().playerId}`
}

function readSavedProgress(): { rankPoints?: number; wins?: number; matchesPlayed?: number; dailySeed?: string; dailyGoalsVersion?: number; dailyGoals?: DailyGoal[] } | null {
  try {
    const storage = typeof localStorage === 'undefined' ? undefined : localStorage
    const raw = storage?.getItem(getSaveKey())
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveProgress(): void {
  try {
    const storage = typeof localStorage === 'undefined' ? undefined : localStorage
    if (!storage) return

    const local = gameState.matchPlayers.find(player => player.isLocal)
    storage.setItem(getSaveKey(), JSON.stringify({
      rankPoints: gameState.rankPoints,
      wins: local?.wins || 0,
      matchesPlayed: local?.matchesPlayed || 0,
      dailySeed: dailyGoalsSeed,
      dailyGoalsVersion: DAILY_GOALS_VERSION,
      dailyGoals: gameState.dailyGoals,
    }))
  } catch {}
}

function loadProgress(): void {
  const saved = readSavedProgress()
  const today = getDailySeed()
  dailyGoalsSeed = today
  const playerId = getLocalPlayerIdentity().playerId
  loadGlobalLeaderboard()
  if (saved) {
    gameState.rankPoints = Math.max(0, Number(saved.rankPoints) || 0)
    if (saved.dailySeed === today && saved.dailyGoalsVersion === DAILY_GOALS_VERSION && Array.isArray(saved.dailyGoals) && saved.dailyGoals.length === 3) {
      gameState.dailyGoals = saved.dailyGoals
    } else {
      gameState.dailyGoals = createDailyGoals(gameState.rankPoints, today, playerId)
    }
  } else {
    gameState.dailyGoals = createDailyGoals(gameState.rankPoints, today, playerId)
  }

  refreshRank()
  const local = ensureLocalMatchPlayer()
  local.rankPoints = gameState.rankPoints
  local.wins = Math.max(local.wins, Number(saved?.wins) || 0)
  local.matchesPlayed = Math.max(local.matchesPlayed, Number(saved?.matchesPlayed) || 0)
  saveProgress()
}

function awardRankPoints(points: number): void {
  const previousRank = getDanceRankIndex(gameState.rankPoints)
  gameState.rankPoints += points
  refreshRank()
  const local = ensureLocalMatchPlayer()
  local.rankPoints = gameState.rankPoints
  if (getDanceRankIndex(gameState.rankPoints) > previousRank) {
    localRankUp.id = Math.max(Date.now(), localRankUp.id + 1)
    localRankUp.points = gameState.rankPoints
    localRankUp.timer = RANK_UP_DURATION
    rankUpPopupQueue.push({ id: localRankUp.id, points: localRankUp.points })
  }
  for (const rows of [gameState.globalLeaderboard, gameState.lastDanceLeaderboard]) {
    for (const entry of rows) {
      if (entry.playerId === local.playerId) entry.rankPoints = gameState.rankPoints
    }
  }
  publishRankPresence()
  saveGlobalLeaderboard()
  saveProgress()
}

function refreshDailyGoals(): void {
  const today = getDailySeed()
  if (today === dailyGoalsSeed) return
  dailyGoalsSeed = today
  gameState.dailyGoals = createDailyGoals(gameState.rankPoints, today, getLocalPlayerIdentity().playerId)
  saveProgress()
}

function advanceDailyGoal(id: DailyGoal['id'], progress: number): void {
  refreshDailyGoals()
  const goal = gameState.dailyGoals.find(item => item.id === id)
  if (!goal || goal.completed) return

  goal.progress = Math.max(goal.progress, Math.min(goal.target, progress))
  if (goal.progress >= goal.target) {
    goal.completed = true
    awardRankPoints(goal.rewardRp)
  }
  saveProgress()
}

function incrementDailyGoal(id: DailyGoal['id'], amount = 1): void {
  refreshDailyGoals()
  const goal = gameState.dailyGoals.find(item => item.id === id)
  if (goal && !goal.completed) advanceDailyGoal(id, goal.progress + amount)
}

function trackSequenceDailyGoals(): void {
  incrementDailyGoal('completed_sequences')
  if (gameState.currentSequence.some(step => step.inverted)) incrementDailyGoal('reverse_sequence')
  if (gameState.measureCount === TOTAL_MEASURES - 1) incrementDailyGoal('final_move')
  if (gameState.roundMode === 'freestyle') incrementDailyGoal('freestyle_sequence')
  if (gameState.roundMode === 'hard') incrementDailyGoal('hard_sequence')
  if (gameState.currentSequence.length >= 8) incrementDailyGoal('long_sequence')
}

function awardPlacementRankPoints(): void {
  if (gameState.playMode !== 'multiplayer') return

  const entries = gameState.matchPlayers.filter(isActiveMatchPlayer).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.maxCombo !== a.maxCombo) return b.maxCombo - a.maxCombo
    return a.playerId.localeCompare(b.playerId)
  })
  const local = getLocalPlayerIdentity()
  const placement = entries.findIndex(player => player.playerId === local.playerId)
  if (placement < 0) return

  const rewards = [90, 65, 45, 30, 20]
  awardRankPoints(rewards[placement] ?? 10)
}

function recordGlobalLeaderboardScore(): void {
  const local = ensureLocalMatchPlayer()
  const scoreEntry: MatchPlayer = {
    ...local,
    score: gameState.score,
    maxCombo: gameState.maxCombo,
    finished: true,
    lastSeen: Date.now(),
  }
  recordLeaderboardEntry(scoreEntry)
}

function missSequence(): void {
  gameState.combo = 0
  gameState.misses++
  gameState.judgment = { text: 'MISS!', timer: MISS_DISPLAY_DURATION, totalDuration: MISS_DISPLAY_DURATION }
  setLocalJudgment('MISS!')
  playComboFailEmote()
  updateLocalMatchPlayer()
  publishScore(false)
}

function finishGame(completedSong: boolean): void {
  if (completedSong && !gameState.runFinishedAwarded) {
    gameState.runFinishedAwarded = true
    incrementDailyGoal('finish_song')
    if (gameState.playMode === 'solo') incrementDailyGoal('solo_match')
    if (gameState.playMode === 'multiplayer') incrementDailyGoal('multiplayer_match')
  }

  const local = ensureLocalMatchPlayer()
  if (!local.finished) local.matchesPlayed += 1
  if (gameState.playMode === 'multiplayer') {
    awardPlacementRankPoints()
  }
  updateLocalMatchPlayer(true)
  saveProgress()
  publishScore(true)
  recordGlobalLeaderboardScore()
  tryStartWinnerSpotlight()
  if (gameState.playMode === 'solo') {
    if (gameState.winnerCelebrationTimer <= 0) {
      winnerCelebrationStarted = true
      startVictoryCameraMotion(local)
    }
    playPredefinedEmote(WINNER_EMOTE)
  } else if (gameState.winnerCelebrationTimer <= 0) {
    // Start the results camera immediately using the current leader. The
    // authoritative all-finished winner spotlight can still retarget it.
    startVictoryCameraMotion(getMatchWinner() || local)
  }
  stopMatchMusic()
  gameState.phase = 'gameover'
  gameState.lobbyPrompt = 'choice'
  postGameReturnTimer = POST_GAME_RESULT_DURATION
  resultsPresentation.elapsed = 0
  resultsPresentation.remaining = POST_GAME_RESULT_DURATION
  // Mobile returns to the audience immediately; results must not keep its
  // native joystick or movement locked while the presentation is queued.
  setPlayerMovementLocked(!isMobile(), !isMobile(), true)
  setNativeTouchControlsHidden(!isMobile(), true)
  if (isMobile()) {
    setSoloIsolationActive(false)
    teleportPlayerToAudienceSpot()
    setCinematicCameraActive(false)
  }
  if (gameState.winnerCelebrationTimer <= 0) setCinematicCameraActive(false)
}

function setPlayerMovementLocked(locked: boolean, disableEmotes = false, force = false): void {
  if (locked === playerMovementLocked && disableEmotes === playerEmotesDisabled && !force) return

  if (locked || disableEmotes) {
    InputModifier.createOrReplace(engine.PlayerEntity, {
      mode: InputModifier.Mode.Standard({
        // Active gameplay reads global rhythm actions, so all voluntary avatar
        // controls can be disabled. Scene-triggered score emotes still work.
        disableAll: locked && disableEmotes,
        disableWalk: locked,
        disableJog: locked,
        disableRun: locked,
        disableJump: locked,
        disableEmote: disableEmotes,
        disableDoubleJump: locked,
        disableGliding: locked,
      }),
    })
  } else if (InputModifier.has(engine.PlayerEntity)) {
    InputModifier.deleteFrom(engine.PlayerEntity)
  }

  playerMovementLocked = locked
  playerEmotesDisabled = disableEmotes
}

function placePlayerOnDanceSpot(): void {
  if (!Transform.has(engine.PlayerEntity)) return

  const transform = Transform.getMutable(engine.PlayerEntity)
  const slotPosition = getLocalDanceSlotPosition()
  const dx = Math.abs(transform.position.x - slotPosition.x)
  const dy = Math.abs(transform.position.y - slotPosition.y)
  const dz = Math.abs(transform.position.z - slotPosition.z)

  if (dx > 0.03 || dy > 0.05 || dz > 0.03) {
    transform.position = Vector3.create(
      slotPosition.x,
      slotPosition.y,
      slotPosition.z,
    )
  }

  transform.rotation = FACE_GLOBAL_LEADERBOARD_ROTATION
}

function teleportPlayerToDanceSpot(): void {
  const slotPosition = getLocalDanceSlotPosition()

  const finishDanceSpotPlacement = (): void => {
    if (gameState.phase !== 'playing') return
    placePlayerOnDanceSpot()
    // Preserve the already-armed solo modifier. Replacing it after placement
    // would create the volume around a player who is already inside it, which
    // skips the overlap-enter event on some Explorer builds.
    if (gameState.playMode === 'solo' || pendingSoloStart) {
      setSoloIsolationActive(true)
    }
  }

  void movePlayerTo({
    newRelativePosition: Vector3.create(slotPosition.x, slotPosition.y, slotPosition.z),
    avatarTarget: Vector3.create(slotPosition.x, slotPosition.y + 1, sceneZ(0)),
  }).then(() => {
    finishDanceSpotPlacement()
  }).catch(() => {
    finishDanceSpotPlacement()
  })
}

function placePlayerOnAudienceSpot(): void {
  if (!Transform.has(engine.PlayerEntity)) return

  const transform = Transform.getMutable(engine.PlayerEntity)
  const slotPosition = getLocalAudienceSlotPosition()
  transform.position = Vector3.create(slotPosition.x, slotPosition.y, slotPosition.z)
  transform.rotation = Quaternion.fromEulerDegrees(0, 180, 0)
}

function teleportPlayerToAudienceSpot(): void {
  const slotPosition = getLocalAudienceSlotPosition()
  stopLocalDanceEmote()
  placePlayerOnAudienceSpot()

  void movePlayerTo({
    newRelativePosition: Vector3.create(slotPosition.x, slotPosition.y, slotPosition.z),
  }).then(() => {
    placePlayerOnAudienceSpot()
    stopLocalDanceEmote()
  }).catch(() => {
    placePlayerOnAudienceSpot()
    stopLocalDanceEmote()
  })
}

function keepNonPlayersOffDanceFloor(dt: number): void {
  audienceEnforceTimer = Math.max(0, audienceEnforceTimer - dt)
  remoteLiveMatchTimer = Math.max(0, remoteLiveMatchTimer - dt)
  syncMultiplayerLiveRemaining()
  if (audienceEnforceTimer > 0 || canLocalPlayerBeOnDanceFloor() || !isDanceFloorRestricted()) return

  const transform = Transform.getOrNull(engine.PlayerEntity)
  if (!transform || !isInsideDanceFloor(transform.position)) return

  audienceEnforceTimer = 0.75
  teleportPlayerToAudienceSpot()
}

function keepPlayerOnDanceSpot(): void {
  setPlayerMovementLocked(true, true)
  placePlayerOnDanceSpot()
}

function setNativeTouchControlsHidden(hidden: boolean, force = false): void {
  if (hidden === touchControlsHidden && !force) return

  TouchScreenControls.createOrReplace(engine.RootEntity, {
    touchInputs: hidden
      ? [
        InputAction.IA_POINTER,
        InputAction.IA_PRIMARY,
        InputAction.IA_SECONDARY,
        InputAction.IA_ANY,
        InputAction.IA_FORWARD,
        InputAction.IA_BACKWARD,
        InputAction.IA_RIGHT,
        InputAction.IA_LEFT,
        InputAction.IA_JUMP,
        InputAction.IA_WALK,
        InputAction.IA_ACTION_3,
        InputAction.IA_ACTION_4,
        InputAction.IA_ACTION_5,
        InputAction.IA_ACTION_6,
        InputAction.IA_MODIFIER,
      ].map(inputAction => ({ inputAction, hide: true }))
      : [],
    hideJoystick: hidden,
    hideCrosshair: hidden,
  })

  touchControlsHidden = hidden
}

function refreshActiveMatchRestrictions(dt: number): void {
  matchRestrictionRefreshTimer -= dt
  if (matchRestrictionRefreshTimer > 0) return

  // Some mobile Explorer builds rebuild their HUD after camera transitions.
  // Reassert match restrictions so the emote/native buttons cannot reappear.
  matchRestrictionRefreshTimer = 0.5
  setPlayerMovementLocked(true, true, true)
  setNativeTouchControlsHidden(true, true)
  // Solo uses its own scene-wide area. Re-creating the passport area here and
  // deleting it again next frame makes the Explorer show every avatar inside.
  if (gameState.playMode !== 'solo') setMatchPassportLock(true, true)
}

function initCinematicCamera(): void {
  if (cinematicReady) return
  cinematicReady = true

  cinematicTargetEntity = engine.addEntity()
  Transform.create(cinematicTargetEntity, { position: getLocalCameraTargetPosition() })
  cinematicCameraPosition = getLocalCameraStartPosition()
  cinematicCameraFov = 58

  cinematicCameraEntity = engine.addEntity()
  Transform.create(cinematicCameraEntity, {
    position: cinematicCameraPosition,
    rotation: Quaternion.Identity(),
  })
  VirtualCamera.create(cinematicCameraEntity, {
    lookAtEntity: cinematicTargetEntity,
    fov: 58,
    defaultTransition: {
      transitionMode: VirtualCamera.Transition.Time(1.8),
    },
  })

  hitSoundEntity = engine.addEntity()
  Transform.create(hitSoundEntity, {
    position: Vector3.create(sceneX(16), 1.2, sceneZ(16)),
  })
  AudioSource.create(hitSoundEntity, {
    audioClipUrl: HIT_SOUND_URL,
    playing: false,
    volume: 0.85,
    loop: false,
    global: false,
  })

  arrowClapSoundEntity = engine.addEntity()
  Transform.create(arrowClapSoundEntity, {
    position: Vector3.create(sceneX(16), 1.2, sceneZ(16)),
  })
  AudioSource.create(arrowClapSoundEntity, {
    audioClipUrl: ARROW_CLAP_SOUND_URL,
    playing: false,
    volume: 1.0,
    loop: false,
    global: true,
  })

  arrowFailSoundEntity = engine.addEntity()
  Transform.create(arrowFailSoundEntity, {
    position: Vector3.create(sceneX(16), 1.2, sceneZ(16)),
  })
  AudioSource.create(arrowFailSoundEntity, {
    audioClipUrl: ARROW_FAIL_SOUND_URL,
    playing: false,
    volume: 1.0,
    loop: false,
    global: true,
  })

  matchMusicEntity = engine.addEntity()
  Transform.create(matchMusicEntity, {
    position: Vector3.create(sceneX(16), 2.2, sceneZ(16)),
  })
  AudioSource.create(matchMusicEntity, {
    audioClipUrl: MATCH_MUSIC_URL,
    playing: false,
    volume: 0.72,
    loop: false,
    global: true,
  })
}

function setCinematicCameraActive(active: boolean): void {
  if (active === cinematicCameraActive) return
  if (!cinematicReady) initCinematicCamera()

  MainCamera.getMutable(engine.CameraEntity).virtualCameraEntity = active ? cinematicCameraEntity : undefined
  cinematicCameraActive = active
}

function triggerHitCinematic(): void {
  hitCinematicTimer = HIT_CINEMATIC_DURATION
}

function updateCinematicCamera(dt: number): void {
  if (!cinematicReady) return

  cinematicTime += dt
  hitCinematicTimer = Math.max(0, hitCinematicTimer - dt)
  const cameraTarget = getLocalCameraTargetPosition()

  Transform.createOrReplace(cinematicTargetEntity, {
    position: Vector3.create(
      cameraTarget.x,
      cameraTarget.y + Math.sin(cinematicTime * 1.2) * 0.10,
      cameraTarget.z,
    ),
  })

  if (gameState.winnerCelebrationTimer > 0) {
    const drift = Math.sin(cinematicTime * 0.32)
    const cameraSide = getCameraSide(getCameraFocusSlotPosition())
    const targetX = clampCameraX(cameraTarget.x + cameraSide * 0.45 + drift * 0.55)
    const targetY = 2.35 + Math.sin(cinematicTime * 0.7) * 0.12
    const targetZ = Math.max(cameraTarget.z - 4.6, sceneZ(8.8))
    const cameraEase = 1 - Math.exp(-dt * 0.72)

    cinematicCameraPosition = Vector3.create(
      cinematicCameraPosition.x + (targetX - cinematicCameraPosition.x) * cameraEase,
      cinematicCameraPosition.y + (targetY - cinematicCameraPosition.y) * cameraEase,
      cinematicCameraPosition.z + (targetZ - cinematicCameraPosition.z) * cameraEase,
    )

    Transform.createOrReplace(cinematicCameraEntity, {
      position: cinematicCameraPosition,
      rotation: Quaternion.Identity(),
    })

    const camera = VirtualCamera.getMutable(cinematicCameraEntity)
    cinematicCameraFov += (35 - cinematicCameraFov) * cameraEase
    camera.fov = cinematicCameraFov
    return
  }

  const hitElapsed = HIT_CINEMATIC_DURATION - hitCinematicTimer
  const rise = Math.min(hitElapsed / HIT_CINEMATIC_APPROACH, 1)
  const fall = Math.min(hitCinematicTimer / HIT_CINEMATIC_RELEASE, 1)
  const hitEase = (rise * rise * (3 - 2 * rise)) * (fall * fall * (3 - 2 * fall))
  const drift = Math.sin(cinematicTime * 0.18)
  const cameraSide = getCameraSide(getCameraFocusSlotPosition())
  const normalHeight = 2.7 + Math.sin(cinematicTime * 0.9) * 0.35
  const height = normalHeight + (2.05 - normalHeight) * hitEase
  const normalX = clampCameraX(cameraTarget.x + cameraSide * 0.9 + drift * 0.8)
  const normalZ = Math.max(cameraTarget.z - 7.2, sceneZ(8.8))
  const closeX = clampCameraX(cameraTarget.x + cameraSide * 0.3 + drift * 0.25)
  const closeZ = Math.max(cameraTarget.z - 3.35, sceneZ(9.2))
  const targetX = normalX + (closeX - normalX) * hitEase
  const targetZ = normalZ + (closeZ - normalZ) * hitEase
  const cameraEase = 1 - Math.exp(-dt * (hitEase > 0 ? 0.95 : 0.5))

  cinematicCameraPosition = Vector3.create(
    cinematicCameraPosition.x + (targetX - cinematicCameraPosition.x) * cameraEase,
    cinematicCameraPosition.y + (height - cinematicCameraPosition.y) * cameraEase,
    cinematicCameraPosition.z + (targetZ - cinematicCameraPosition.z) * cameraEase,
  )

  Transform.createOrReplace(cinematicCameraEntity, {
    position: cinematicCameraPosition,
    rotation: Quaternion.Identity(),
  })

  const camera = VirtualCamera.getMutable(cinematicCameraEntity)
  const targetFov = 58 + (42 - 58) * hitEase
  cinematicCameraFov += (targetFov - cinematicCameraFov) * cameraEase
  camera.fov = cinematicCameraFov
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomIntFrom(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function getRoundModeLabel(mode: RoundMode): string {
  return MODE_LABELS[mode]
}

export function getSpaceWindow(): { start: number; end: number } {
  const halfWindow = Math.max(BAD_WINDOW / gameState.roundDuration, MIN_HIT_WINDOW_PROGRESS)
  return {
    start: Math.max(0, JUDGMENT_CENTER - halfWindow),
    end: Math.min(1, JUDGMENT_CENTER + halfWindow),
  }
}

function getRoundMode(measureCount: number): RoundMode {
  const progress = measureCount / TOTAL_MEASURES
  if (progress < 0.25) return 'easy'
  if (progress < 0.50) return 'middle'
  if (progress < 0.75) return 'freestyle'
  return 'hard'
}

function getSequenceLength(mode: RoundMode, measureCount: number, rng = Math.random): number {
  if (measureCount >= TOTAL_MEASURES - 1) return 12
  if (mode === 'easy') return randomIntFrom(rng, 3, 4)
  if (mode === 'hard') return randomIntFrom(rng, 8, 10)
  return randomIntFrom(rng, 5, 8)
}

function getSequenceSeed(mode: RoundMode, measureCount: number): number {
  const modeSeed =
    mode === 'easy' ? 17 :
    mode === 'middle' ? 31 :
    mode === 'freestyle' ? 47 :
    67
  return 0xDABADA + measureCount * 101 + modeSeed
}

function getRoundDuration(mode: RoundMode, measureCount: number): number {
  const progress = Math.max(0, Math.min(measureCount / Math.max(1, TOTAL_MEASURES - 1), 1))
  const easedProgress = progress * progress * (3 - 2 * progress)
  const baseDuration = HIT_BAR_START_DURATION +
    (HIT_BAR_END_DURATION - HIT_BAR_START_DURATION) * easedProgress
  const finalMoveAllowance = measureCount >= TOTAL_MEASURES - 1 ? FINAL_MOVE_TIME_ALLOWANCE : 0
  return baseDuration + HIT_BAR_MODE_ALLOWANCE[mode] + finalMoveAllowance
}

function getComboWaitDuration(measureCount: number): number {
  return getBaseComboWaitDuration(measureCount)
}

function getMultiplayerTimeline(elapsedSeconds: number): {
  finished: boolean
  measureCount: number
  roundState: RoundState
  roundMode: RoundMode
  waitDuration: number
  waitTimer: number
  measureTime: number
  measureProgress: number
  beat: number
} {
  let cursor = 0

  for (let measure = 0; measure < TOTAL_MEASURES; measure++) {
    const waitDuration = getComboWaitDuration(measure)
    if (elapsedSeconds < cursor + waitDuration) {
      const mode = getRoundMode(measure)
      return {
        finished: false,
        measureCount: measure,
        roundState: 'waiting',
        roundMode: mode,
        waitDuration,
        waitTimer: Math.max(0, cursor + waitDuration - elapsedSeconds),
        measureTime: 0,
        measureProgress: 0,
        beat: Math.floor(elapsedSeconds / BEAT_DURATION),
      }
    }

    cursor += waitDuration
    const mode = getRoundMode(measure)
    const roundDuration = getRoundDuration(mode, measure)
    if (elapsedSeconds < cursor + roundDuration) {
      const measureTime = elapsedSeconds - cursor
      return {
        finished: false,
        measureCount: measure,
        roundState: 'active',
        roundMode: mode,
        waitDuration: 0,
        waitTimer: 0,
        measureTime,
        measureProgress: Math.min(measureTime / roundDuration, 1),
        beat: Math.floor(elapsedSeconds / BEAT_DURATION),
      }
    }

    cursor += roundDuration
  }

  return {
    finished: true,
    measureCount: TOTAL_MEASURES,
    roundState: 'active',
    roundMode: 'hard',
    waitDuration: 0,
    waitTimer: 0,
    measureTime: getRoundDuration('hard', TOTAL_MEASURES - 1),
    measureProgress: 1,
    beat: Math.floor(elapsedSeconds / BEAT_DURATION),
  }
}

function makeStep(displayDirection: Direction, inverted: boolean): SequenceStep {
  return {
    displayDirection,
    inputDirection: inverted ? INVERTED_INPUT[displayDirection] : displayDirection,
    inverted,
  }
}

function pickVariedDirection(pool: Direction[], seq: SequenceStep[], rng: () => number): Direction {
  const previous = seq[seq.length - 1]?.displayDirection
  const twoBack = seq[seq.length - 2]?.displayDirection
  const candidates = pool.filter(direction => direction !== previous)
  const variedPool = candidates.length > 1 && twoBack
    ? candidates.filter(direction => direction !== twoBack)
    : candidates
  const finalPool = variedPool.length > 0 ? variedPool : candidates.length > 0 ? candidates : pool

  return finalPool[Math.floor(rng() * finalPool.length)]
}

function generateSeq(mode: RoundMode, measureCount: number): SequenceStep[] {
  const rng = seededRandom(getSequenceSeed(mode, measureCount))
  const len = getSequenceLength(mode, measureCount, rng)
  const pool = mode === 'hard' ? HARD_DIRS : BASIC_DIRS
  const seq: SequenceStep[] = []
  const isFinalMove = measureCount >= TOTAL_MEASURES - 1
  const finalReverseIndex = isFinalMove ? randomIntFrom(rng, 0, len - 1) : -1

  for (let i = 0; i < len; i++) {
    const displayDirection = pickVariedDirection(pool, seq, rng)
    const inverted = isFinalMove
      ? i === finalReverseIndex
      : mode === 'freestyle' && rng() < 0.28
    seq.push(makeStep(displayDirection, inverted))
  }

  if (mode === 'freestyle') {
    let reverseCount = seq.filter(step => step.inverted).length
    const startIndex = randomIntFrom(rng, 0, len - 1)
    for (let offset = 0; reverseCount < 2 && offset < len; offset++) {
      const index = (startIndex + offset) % len
      if (seq[index].inverted) continue
      seq[index] = makeStep(seq[index].displayDirection, true)
      reverseCount++
    }
  }

  return seq
}

function startComboWait(duration = getComboWaitDuration(gameState.measureCount)): void {
  gameState.roundMode      = getRoundMode(gameState.measureCount)
  gameState.roundState     = 'waiting'
  gameState.waitDuration   = duration
  gameState.waitTimer      = gameState.waitDuration
  gameState.measureTime    = 0
  gameState.measureProgress = 0
  gameState.inputIndex     = 0
  gameState.sequenceFailed = false
  gameState.spacePressed   = false
  gameState.hitMarkerProgress = 0
  gameState.currentSequence = []
}

function newMeasure(): void {
  const mode = getRoundMode(gameState.measureCount)
  gameState.roundMode       = mode
  gameState.roundDuration   = getRoundDuration(mode, gameState.measureCount)
  gameState.roundState      = 'active'
  gameState.waitTimer       = 0
  gameState.waitDuration    = 0
  gameState.measureTime     = 0
  gameState.measureProgress = 0
  gameState.inputIndex      = 0
  gameState.sequenceFailed  = false
  gameState.spacePressed    = false
  gameState.hitMarkerProgress = 0
  gameState.currentSequence = generateSeq(mode, gameState.measureCount)
}

function syncMultiplayerTimeline(): boolean {
  if (gameState.playMode !== 'multiplayer' || multiplayerMatchStartTimeMs <= 0) return false

  const elapsed = Math.max(0, (getMultiplayerNowMs() - multiplayerMatchStartTimeMs) / 1000)
  const frame = getMultiplayerTimeline(elapsed)

  if (frame.finished) {
    if (syncedMultiplayerState === 'active' && !gameState.spacePressed) missSequence()
    if (gameState.phase === 'playing') finishGame(true)
    return true
  }

  const changedMeasure = frame.measureCount !== syncedMultiplayerMeasure
  const changedState = frame.roundState !== syncedMultiplayerState
  if (changedMeasure || changedState) {
    if (syncedMultiplayerState === 'active' && !gameState.spacePressed) missSequence()
    gameState.inputIndex = 0
    gameState.sequenceFailed = false
    gameState.spacePressed = false
    gameState.hitMarkerProgress = 0
    gameState.spaceFlash = 0
    gameState.currentSequence = frame.roundState === 'active'
      ? generateSeq(frame.roundMode, frame.measureCount)
      : []
    syncedMultiplayerMeasure = frame.measureCount
    syncedMultiplayerState = frame.roundState
  }

  gameState.measureCount = frame.measureCount
  gameState.roundMode = frame.roundMode
  gameState.roundDuration = getRoundDuration(frame.roundMode, frame.measureCount)
  gameState.roundState = frame.roundState
  gameState.waitDuration = frame.waitDuration
  gameState.waitTimer = frame.waitTimer
  gameState.measureTime = frame.measureTime
  gameState.measureProgress = frame.measureProgress

  if (frame.beat !== gameState.currentBeat) {
    gameState.currentBeat = frame.beat
    gameState.beatPulse = 1.0
  }

  return false
}

// ──────────────────────────────────────────────────────────
// Public: lobby / start / restart
// ──────────────────────────────────────────────────────────
function startGame(mode: Exclude<PlayMode, 'none'>): void {
  gameState.playMode = mode
  gameState.lobbyPrompt = 'hidden'
  postGameReturnTimer = 0
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  if (mode === 'solo') {
    resetMatchSlotLocks()
    multiplayerMatchStartTimeMs = 0
    gameState.matchPlayers = []
    gameState.matchWinnerName = ''
    // The server removed this player from public multiplayer when it accepted
    // the initial soloIsolation message. Sending playerLeave again here would
    // briefly remove the player from the solo roster and reveal their avatar.
    void multiplayerRoom.send('soloIsolation', { playerId: getLocalPlayerIdentity().playerId, active: true })
    setSoloIsolationActive(true)
  } else {
    setSoloIsolationActive(false)
    if (multiplayerMatchStartTimeMs <= 0) multiplayerMatchStartTimeMs = getMultiplayerNowMs()
    prepareMultiplayerParticipants()
    lockMatchSlots()
  }

  setPlayerMovementLocked(true, true)
  setNativeTouchControlsHidden(true)
  matchRestrictionRefreshTimer = 0
  teleportPlayerToDanceSpot()
  placePlayerOnDanceSpot()
  gameState.phase        = 'playing'
  // Solo isolation already includes passport blocking. Never create the
  // second overlapping area, even for the first frame of a solo match.
  setMatchPassportLock(mode !== 'solo')
  gameState.roundState   = 'active'
  gameState.roundMode    = 'easy'
  gameState.waitTimer    = 0
  gameState.waitDuration = 0
  gameState.roundDuration = getRoundDuration('easy', 0)
  gameState.score        = 0
  gameState.combo        = 0
  gameState.maxCombo     = 0
  gameState.perfectHits  = 0
  gameState.greatHits    = 0
  gameState.coolHits     = 0
  gameState.badHits      = 0
  gameState.misses       = 0
  gameState.measureCount = 0
  gameState.runFinishedAwarded = false
  gameState.judgment     = null
  gameState.keyFlash     = { left: 0, down: 0, up: 0, right: 0, upLeft: 0, upRight: 0 }
  gameState.spaceFlash   = 0
  gameState.hitMarkerProgress = 0
  gameState.winnerPlayerId = ''
  gameState.winnerCelebrationTimer = 0
  winnerCelebrationStarted = false
  gameState.multiplayerCountdown = 0
  localMatchElapsed = 0
  totalBeats             = 0
  updateLocalMatchPlayer(false)
  publishScore(false)
  playMatchMusic()
  startComboWait()
}

export function startSoloMode(): void {
  if (pendingSoloStart || gameState.playMode === 'solo') return
  pendingSoloStart = true
  pendingSoloStartDelay = -1
  soloDanceIsolationArmed = false
  soloWarmupRebuilds = SOLO_START_WARMUP_REBUILDS
  // Force the first replacement on the next engine frame instead of waiting
  // for the normal refresh interval on slower desktop Explorers.
  soloVisibilityRefreshTimer = SOLO_VISIBILITY_REFRESH_INTERVAL
  gameState.lobbyPrompt = 'hidden'
  setSoloIsolationActive(true)
  void multiplayerRoom.send('soloIsolation', {
    playerId: getLocalPlayerIdentity().playerId,
    active: true,
  })
}

export function isSoloTransitionPending(): boolean {
  return pendingSoloStart
}

function cancelPendingSoloStart(): void {
  if (!pendingSoloStart) return
  pendingSoloStart = false
  pendingSoloStartDelay = -1
  soloDanceIsolationArmed = false
  soloWarmupRebuilds = 0
  setSoloIsolationActive(false)
  void multiplayerRoom.send('soloIsolation', {
    playerId: getLocalPlayerIdentity().playerId,
    active: false,
  })
}

export function readyForMultiplayer(): void {
  cancelPendingSoloStart()
  void multiplayerRoom.send('soloIsolation', { playerId: getLocalPlayerIdentity().playerId, active: false })
  setSoloIsolationActive(false)
  resetMatchSlotLocks()
  postGameReturnTimer = 0
  const liveRemaining = syncMultiplayerLiveRemaining()
  multiplayerMatchStartTimeMs = liveRemaining > 0
    ? remoteLiveMatchStartTimeMs
    : getMultiplayerNowMs() + MULTIPLAYER_READY_WINDOW_MS
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  gameState.playMode = 'multiplayer'
  gameState.lobbyPrompt = 'hidden'
  gameState.phase = 'ready'
  gameState.roundState = 'waiting'
  const remaining = liveRemaining > 0
    ? liveRemaining
    : Math.max(0, (multiplayerMatchStartTimeMs - getMultiplayerNowMs()) / 1000)
  const local = ensureLocalMatchPlayer()
  local.ready = false
  localJoinConfirmed = false
  latestLocalJoinAckSentAt = 0
  local.phase = 'ready'
  local.matchStartTime = multiplayerMatchStartTimeMs
  local.rankPoints = gameState.rankPoints
  local.score = 0
  local.maxCombo = 0
  local.finished = false
  sortMatchPlayers()
  gameState.waitTimer = remaining
  gameState.waitDuration = Math.max(remaining, 1)
  gameState.multiplayerCountdown = remaining
  gameState.multiplayerLiveRemaining = liveRemaining
  setPlayerMovementLocked(false)
  setNativeTouchControlsHidden(false)
  setCinematicCameraActive(false)
  publishScore(false)
}

export function cancelMultiplayerReady(): void {
  cancelPendingSoloStart()
  const local = ensureLocalMatchPlayer()
  local.ready = false
  localJoinConfirmed = false
  local.finished = false
  gameState.phase = 'idle'
  local.phase = 'idle'
  multiplayerMatchStartTimeMs = 0
  local.matchStartTime = 0
  publishScore(false)
  gameState.playMode = 'none'
  gameState.lobbyPrompt = 'play'
  gameState.roundState = 'waiting'
  gameState.waitTimer = 0
  gameState.waitDuration = 0
  gameState.multiplayerCountdown = 0
  resetMatchSlotLocks()
  postGameReturnTimer = 0
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  resetMultiplayerReadyWindow()
  setPlayerMovementLocked(false)
  setNativeTouchControlsHidden(false)
  setCinematicCameraActive(false)
  teleportPlayerToAudienceSpot()
  stopMatchMusic()
  publishScore(false)
  void multiplayerRoom.send('playerLeave', { playerId: local.playerId })
  void multiplayerRoom.send('soloIsolation', { playerId: local.playerId, active: false })
}

export function joinMultiplayerMatch(): void {
  if (gameState.phase !== 'ready' || gameState.playMode !== 'multiplayer') return
  if (syncMultiplayerLiveRemaining() > 0) return

  const local = ensureLocalMatchPlayer()
  if (local.ready) return
  const queuedWithoutLocal = gameState.matchPlayers.filter(player =>
    player.playerId !== local.playerId &&
    player.ready &&
    player.phase === 'ready' &&
    isSameScheduledMatch(player.matchStartTime)
  )
  if (queuedWithoutLocal.length >= MAX_MULTIPLAYER_PLAYERS) {
    local.ready = false
    publishScore(false)
    return
  }

  local.ready = true
  localJoinConfirmed = false
  local.phase = 'ready'
  local.matchStartTime = multiplayerMatchStartTimeMs
  local.finished = false
  local.score = 0
  local.maxCombo = 0
  sortMatchPlayers()
  publishScore(false)
}

export function returnToLobby(): void {
  jumpOffRequested = false
  resultsPresentation.elapsed = 0
  resultsPresentation.remaining = 0
  cancelPendingSoloStart()
  stopLocalDanceEmote()
  const local = ensureLocalMatchPlayer()
  local.ready = false
  localJoinConfirmed = false
  local.finished = false
  gameState.phase = 'idle'
  local.phase = 'idle'
  multiplayerMatchStartTimeMs = 0
  local.matchStartTime = 0
  publishScore(false)
  void multiplayerRoom.send('playerLeave', { playerId: local.playerId })
  void multiplayerRoom.send('soloIsolation', { playerId: local.playerId, active: false })
  setSoloIsolationActive(false)
  gameState.playMode = 'none'
  gameState.lobbyPrompt = 'choice'
  gameState.roundState = 'active'
  gameState.waitTimer = 0
  gameState.waitDuration = 0
  gameState.winnerPlayerId = ''
  gameState.winnerCelebrationTimer = 0
  winnerCelebrationStarted = false
  resetMatchSlotLocks()
  postGameReturnTimer = 0
  multiplayerMatchStartTimeMs = 0
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  gameState.multiplayerCountdown = 0
  resetMultiplayerReadyWindow()
  setPlayerMovementLocked(false)
  setNativeTouchControlsHidden(false)
  setCinematicCameraActive(false)
  teleportPlayerToAudienceSpot()
  stopMatchMusic()
  publishScore(false)
}

// UI touch handlers must not tear down the active mobile controls while the
// same pointer event is still being dispatched. Queue the exit and consume it
// at the beginning of the next engine frame instead.
export function requestJumpOff(): void {
  if (gameState.phase !== 'playing' || jumpOffRequested) return
  jumpOffRequested = true
}

export function watchLiveMode(): void {
  cancelPendingSoloStart()
  stopLocalDanceEmote()
  const local = ensureLocalMatchPlayer()
  local.ready = false
  localJoinConfirmed = false
  local.finished = false
  gameState.phase = 'idle'
  local.phase = 'idle'
  multiplayerMatchStartTimeMs = 0
  local.matchStartTime = 0
  publishScore(false)
  void multiplayerRoom.send('playerLeave', { playerId: local.playerId })
  void multiplayerRoom.send('soloIsolation', { playerId: local.playerId, active: false })
  setSoloIsolationActive(false)
  gameState.playMode = 'none'
  gameState.lobbyPrompt = 'hidden'
  resetMatchSlotLocks()
  postGameReturnTimer = 0
  multiplayerMatchStartTimeMs = 0
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  resetMultiplayerReadyWindow()
  setPlayerMovementLocked(false)
  setNativeTouchControlsHidden(false)
  setCinematicCameraActive(false)
  teleportPlayerToAudienceSpot()
  stopMatchMusic()
  publishScore(false)
}

export function openPlayMenu(): void {
  cancelPendingSoloStart()
  const local = ensureLocalMatchPlayer()
  local.ready = false
  localJoinConfirmed = false
  local.finished = false
  gameState.phase = 'idle'
  local.phase = 'idle'
  multiplayerMatchStartTimeMs = 0
  local.matchStartTime = 0
  publishScore(false)
  gameState.playMode = 'none'
  gameState.lobbyPrompt = 'play'
  resetMatchSlotLocks()
  postGameReturnTimer = 0
  multiplayerMatchStartTimeMs = 0
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  resetMultiplayerReadyWindow()
  setPlayerMovementLocked(false)
  setNativeTouchControlsHidden(false)
  setCinematicCameraActive(false)
  stopMatchMusic()
  publishScore(false)
}

export function openLeaderboardMenu(): void {
  cancelPendingSoloStart()
  const local = ensureLocalMatchPlayer()
  local.ready = false
  localJoinConfirmed = false
  local.finished = false
  gameState.phase = 'idle'
  local.phase = 'idle'
  multiplayerMatchStartTimeMs = 0
  local.matchStartTime = 0
  publishScore(false)
  gameState.playMode = 'none'
  gameState.lobbyPrompt = 'leaderboards'
  resetMatchSlotLocks()
  postGameReturnTimer = 0
  multiplayerMatchStartTimeMs = 0
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  resetMultiplayerReadyWindow()
  setPlayerMovementLocked(false)
  setNativeTouchControlsHidden(false)
  // This is a UI-only action: preserve the avatar transform and the exact
  // camera/view the player had when they opened the leaderboard.
  stopMatchMusic()
  publishScore(false)
}

// ──────────────────────────────────────────────────────────
// Input handlers
// ──────────────────────────────────────────────────────────
function handleArrow(dir: Direction): void {
  if (gameState.phase !== 'playing') return
  if (gameState.roundState !== 'active') return
  if (gameState.spacePressed)   return  // measure already locked
  if (gameState.sequenceFailed) return  // already broken
  // Arrow input is only accepted before the judgment zone
  if (gameState.measureProgress > JUDGMENT_CENTER) return

  const sequenceIndex = gameState.inputIndex
  if (dir === gameState.currentSequence[sequenceIndex]?.inputDirection) {
    arrowInputFeedback.direction = dir
    arrowInputFeedback.sequenceIndex = sequenceIndex
    arrowInputFeedback.correct = true
    arrowInputFeedback.timer = arrowInputFeedback.duration
    playArrowClapSound()
    gameState.inputIndex++
  } else {
    arrowInputFeedback.direction = dir
    arrowInputFeedback.sequenceIndex = sequenceIndex
    arrowInputFeedback.correct = false
    arrowInputFeedback.timer = arrowInputFeedback.duration
    playArrowFailSound()
    gameState.inputIndex = 0
  }
}

function handleSpace(fromMobile = false): void {
  if (gameState.phase !== 'playing') return
  if (gameState.roundState !== 'active') return
  if (gameState.spacePressed) return
  const judgedProgress = Math.max(
    0,
    Math.min(
      1,
      gameState.measureProgress - (fromMobile ? MOBILE_HIT_LATENCY_COMPENSATION_SECONDS / gameState.roundDuration : 0),
    ),
  )
  // HIT is only consumed once while the beat marker is inside the judgment zone.
  const spaceWindow = getSpaceWindow()
  const mobileGraceProgress = fromMobile ? MOBILE_TOUCH_GRACE_SECONDS / gameState.roundDuration : 0
  if (judgedProgress < spaceWindow.start - mobileGraceProgress || judgedProgress > spaceWindow.end + mobileGraceProgress) return

  gameState.spacePressed = true
  gameState.hitMarkerProgress = judgedProgress
  gameState.spaceFlash   = 1.0

  // Sequence must be fully and correctly typed
  const complete =
    !gameState.sequenceFailed &&
    gameState.inputIndex >= gameState.currentSequence.length

  if (!complete) {
    missSequence()
    return
  }

  // Calculate timing precision
  const diff = Math.max(
    0,
    Math.abs(judgedProgress - JUDGMENT_CENTER) * gameState.roundDuration -
      (fromMobile ? MOBILE_TOUCH_GRACE_SECONDS : 0),
  )

  let text: JudgmentText
  let pts: number

  if (diff <= PERFECT_WINDOW) {
    text = 'PERFECT!'; pts = 1000
  } else if (diff <= GREAT_WINDOW) {
    text = 'GREAT!';   pts = 700
  } else if (diff <= COOL_WINDOW) {
    text = 'COOL!';    pts = 400
  } else if (diff <= BAD_WINDOW) {
    text = 'GOOD!';    pts = 100
  } else {
    text = 'GOOD!';    pts = 100
  }

  pts = Math.round(pts * MODE_SCORE_MULTIPLIER[gameState.roundMode])

  if (text === 'PERFECT!') {
    gameState.combo++
    gameState.maxCombo = Math.max(gameState.maxCombo, gameState.combo)
    const earnedScore = pts * Math.min(gameState.combo, 10)
    gameState.score += earnedScore
    incrementDailyGoal('score_total', earnedScore)
    gameState.perfectHits++
    incrementDailyGoal('perfect_hits')
    advanceDailyGoal('perfect_combo', gameState.combo)
    playComboSuccessEmote(gameState.combo)
  } else {
    gameState.combo = 0
    gameState.score += pts
    incrementDailyGoal('score_total', pts)

    if (text === 'GREAT!') {
      gameState.greatHits++
      incrementDailyGoal('great_hits')
      playGoodDanceEmote(gameState.greatHits)
    } else if (text === 'COOL!') {
      gameState.coolHits++
      incrementDailyGoal('cool_hits')
      playGoodDanceEmote(gameState.coolHits + 1)
    } else if (text === 'GOOD!') {
      gameState.badHits++
      playGoodDanceEmote(gameState.combo)
    }
  }
  trackSequenceDailyGoals()

  playHitBeatSound()
  triggerHitCinematic()

  const dur = JUDGMENT_DISPLAY_DURATION
  gameState.judgment = { text, timer: dur, totalDuration: dur }
  setLocalJudgment(text, text === 'PERFECT!' ? gameState.combo : 0)
  updateLocalMatchPlayer()
  publishScore(false)
}

// ──────────────────────────────────────────────────────────
// Main game system
// ──────────────────────────────────────────────────────────
export function initGame(): void {
  initRankUpSound()
  initMultiplayerScoreBus()
  ensureLocalMatchPlayer()
  const localPlayerId = getLocalPlayerIdentity().playerId
  if (localPlayerId !== 'local-player') scenePlayerIds.add(localPlayerId)
  loadProgress()
  publishRankPresence()
  resetMultiplayerReadyWindow()
  initCinematicCamera()

  engine.addSystem((dt: number) => {
    if (jumpOffRequested) {
      jumpOffRequested = false
      returnToLobby()
      return
    }
    refreshDailyGoals()
    tickRankPresence(dt)
    const soloPlaying = gameState.playMode === 'solo' && gameState.phase === 'playing'
    // The solo isolation area already disables passports. Keeping the separate
    // passport area would overlap it and break visibility on older clients.
    setMatchPassportLock(gameState.phase === 'playing' && !soloPlaying)
    const localSoloPlaying = gameState.playMode === 'solo' && (gameState.phase === 'playing' || (gameState.phase === 'gameover' && !isMobile()))
    const localSoloPresenceActive = localSoloPlaying || pendingSoloStart
    setSoloIsolationActive(localSoloPresenceActive)
    soloVisibilityRefreshTimer += dt
    if (soloVisibilityRefreshTimer >= SOLO_VISIBILITY_REFRESH_INTERVAL) {
      soloVisibilityRefreshTimer = 0
      if (localSoloPresenceActive && soloWarmupRebuilds > 0) {
        setSoloIsolationActive(true, true)
        soloWarmupRebuilds--
      }
      if (authoritativeSoloPlayerIds.size > 0) syncAuthoritativeSoloVisibility()
    }
    const currentLocalPlayerId = getLocalPlayerIdentity().playerId
    if (currentLocalPlayerId !== 'local-player' && !scenePlayerIds.has(currentLocalPlayerId)) {
      scenePlayerIds.add(currentLocalPlayerId)
      syncAuthoritativeSoloVisibility()
    }
    soloRosterRequestTimer += dt
    if (soloRosterRequestTimer >= SOLO_ROSTER_REQUEST_INTERVAL && currentLocalPlayerId !== 'local-player') {
      soloRosterRequestTimer = 0
      void multiplayerRoom.send('soloRosterRequest', { requesterId: currentLocalPlayerId })
    }
    if (localSoloPresenceActive && currentLocalPlayerId !== 'local-player') {
      if (announcedSoloPlayerId !== currentLocalPlayerId) {
        announcedSoloPlayerId = currentLocalPlayerId
        soloPresenceSyncTimer = 0
        void multiplayerRoom.send('soloIsolation', { playerId: currentLocalPlayerId, active: true })
      } else {
        soloPresenceSyncTimer += dt
        if (soloPresenceSyncTimer >= SOLO_PRESENCE_SYNC_INTERVAL) {
          soloPresenceSyncTimer = 0
          void multiplayerRoom.send('soloIsolation', { playerId: currentLocalPlayerId, active: true })
        }
      }
    } else {
      soloPresenceSyncTimer = 0
      announcedSoloPlayerId = ''
    }
    if (pendingSoloStart && pendingSoloStartDelay >= 0) {
      pendingSoloStartDelay = Math.max(0, pendingSoloStartDelay - dt)
      if (pendingSoloStartDelay <= 0) {
        if (!soloDanceIsolationArmed) {
          // The authoritative roster is confirmed. Replace the preparation
          // mask with the compact floor mask while the player is still in the
          // audience, then leave it mounted long enough for native physics to
          // observe that outside state before teleporting.
          soloDanceIsolationArmed = true
          pendingSoloStartDelay = SOLO_DANCE_ISOLATION_ARM_DELAY
          setSoloIsolationActive(true, true)
          return
        }
        pendingSoloStart = false
        pendingSoloStartDelay = -1
        startGame('solo')
        soloDanceIsolationArmed = false
        return
      }
    }

    // ── Decay visual feedback ──
    gameState.beatPulse  = Math.max(0, gameState.beatPulse  - dt * 6)
    gameState.spaceFlash = Math.max(0, gameState.spaceFlash - dt * 4)
    mobileTapFeedback.left = Math.max(0, mobileTapFeedback.left - dt * 2.2)
    mobileTapFeedback.down = Math.max(0, mobileTapFeedback.down - dt * 2.2)
    mobileTapFeedback.up = Math.max(0, mobileTapFeedback.up - dt * 2.2)
    mobileTapFeedback.right = Math.max(0, mobileTapFeedback.right - dt * 2.2)
    mobileTapFeedback.hit = Math.max(0, mobileTapFeedback.hit - dt * 1.8)
    arrowInputFeedback.timer = Math.max(0, arrowInputFeedback.timer - dt)
    if (arrowInputFeedback.timer <= 0) arrowInputFeedback.direction = null
    for (const d of ALL_DIRS) {
      gameState.keyFlash[d] = Math.max(0, gameState.keyFlash[d] - dt * 8)
    }
    if (gameState.judgment) {
      gameState.judgment.timer -= dt
      if (gameState.judgment.timer <= 0) gameState.judgment = null
    }
    for (const player of gameState.matchPlayers) {
      player.judgmentTimer = Math.max(0, player.judgmentTimer - dt)
    }
    pruneInactiveMatchPlayers()
    tickLobbyMatchWindow()
    keepNonPlayersOffDanceFloor(dt)

    if (gameState.phase === 'gameover' && postGameReturnTimer > 0 && !isRankPopupBlockingResults()) {
      resultsPresentation.elapsed += dt
      postGameReturnTimer = Math.max(0, postGameReturnTimer - dt)
      resultsPresentation.remaining = postGameReturnTimer
      if (postGameReturnTimer <= 0) {
        returnToLobby()
        return
      }
    }

    if (gameState.winnerCelebrationTimer > 0) {
      if (gameState.phase !== 'gameover' || !isRankPopupBlockingResults()) {
        gameState.winnerCelebrationTimer = Math.max(0, gameState.winnerCelebrationTimer - dt)
      }
      const mobileResults = isMobile() && gameState.phase === 'gameover'
      setCinematicCameraActive(!mobileResults)
      if (!mobileResults) updateCinematicCamera(dt)
      if (gameState.phase !== 'playing') {
        const stillOnDanceFloor = gameState.phase === 'gameover' && !isMobile()
        setPlayerMovementLocked(stillOnDanceFloor, stillOnDanceFloor)
        setNativeTouchControlsHidden(stillOnDanceFloor)
        if (gameState.winnerCelebrationTimer <= 0) setCinematicCameraActive(false)
        return
      }
    }

    if (gameState.phase === 'ready') {
      tickMultiplayerReadyWindow()
      setPlayerMovementLocked(false)
      setNativeTouchControlsHidden(false)
      setCinematicCameraActive(false)
      multiplayerSyncTimer += dt
      if (multiplayerSyncTimer >= MULTIPLAYER_SYNC_INTERVAL) {
        multiplayerSyncTimer = 0
        publishScore(false)
      }
      return
    }

    if (gameState.phase !== 'playing') {
      const stillOnDanceFloor = gameState.phase === 'gameover' && !isMobile()
      setPlayerMovementLocked(stillOnDanceFloor, stillOnDanceFloor)
      setNativeTouchControlsHidden(stillOnDanceFloor)
      setCinematicCameraActive(false)
      multiplayerSyncTimer = 0
      return
    }

    keepPlayerOnDanceSpot()
    refreshActiveMatchRestrictions(dt)
    stopUnauthorizedPlayerEmotes()
    localMatchElapsed += dt
    setNativeTouchControlsHidden(true)
    setCinematicCameraActive(true)
    updateCinematicCamera(dt)
    updateLocalMatchPlayer()
    multiplayerSyncTimer += dt
    if (multiplayerSyncTimer >= MULTIPLAYER_SYNC_INTERVAL) {
      multiplayerSyncTimer = 0
      publishScore(false)
    }

    if (gameState.playMode === 'multiplayer') {
      if (syncMultiplayerTimeline()) return
    }

    // ── Breath between combos ──
    if (gameState.roundState === 'waiting') {
      if (gameState.playMode === 'solo') {
        gameState.waitTimer = Math.max(0, gameState.waitTimer - dt)
      if (gameState.waitTimer <= 0) {
          if (gameState.measureCount >= TOTAL_MEASURES) finishGame(true)
          else newMeasure()
        }
      }
      return
    }

    // ── Advance measure time before reading inputs so the hit window matches the rendered marker.
    if (gameState.playMode === 'solo') {
      gameState.measureTime    += dt
      gameState.measureProgress = Math.min(gameState.measureTime / gameState.roundDuration, 1.0)

      const beatIdx = Math.floor(gameState.measureTime / BEAT_DURATION) + totalBeats
      if (beatIdx !== gameState.currentBeat) {
        gameState.currentBeat = beatIdx
        gameState.beatPulse   = 1.0
      }
    }

    // ── Arrow inputs (WASD / directional) ──
    const mobileInput = isMobile()

    if (
      inputSystem.isTriggered(InputAction.IA_LEFT, PointerEventType.PET_DOWN) ||
      (mobileInput && inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN))
    ) {
      if (mobileInput) mobileTapFeedback.left = 1
      gameState.keyFlash.left = 1.0
      handleArrow('left')
    }
    if (
      inputSystem.isTriggered(InputAction.IA_RIGHT, PointerEventType.PET_DOWN) ||
      (mobileInput && inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN))
    ) {
      if (mobileInput) mobileTapFeedback.right = 1
      gameState.keyFlash.right = 1.0
      handleArrow('right')
    }
    if (
      inputSystem.isTriggered(InputAction.IA_FORWARD, PointerEventType.PET_DOWN) ||
      (mobileInput && inputSystem.isTriggered(InputAction.IA_ACTION_5, PointerEventType.PET_DOWN))
    ) {
      if (mobileInput) mobileTapFeedback.up = 1
      gameState.keyFlash.up = 1.0
      handleArrow('up')
    }
    if (
      inputSystem.isTriggered(InputAction.IA_BACKWARD, PointerEventType.PET_DOWN) ||
      (mobileInput && inputSystem.isTriggered(InputAction.IA_ACTION_6, PointerEventType.PET_DOWN))
    ) {
      if (mobileInput) mobileTapFeedback.down = 1
      gameState.keyFlash.down = 1.0
      handleArrow('down')
    }
    if (
      (!mobileInput && inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) ||
      inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)
    ) {
      gameState.keyFlash.upLeft = 1.0
      handleArrow('upLeft')
    }
    if (
      inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN) ||
      (!mobileInput && inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN))
    ) {
      gameState.keyFlash.upRight = 1.0
      handleArrow('upRight')
    }

    // ── Spacebar = timing judgment ──
    if (inputSystem.isTriggered(InputAction.IA_JUMP, PointerEventType.PET_DOWN)) {
      if (mobileInput) mobileTapFeedback.hit = 1
      handleSpace(mobileInput)
    }

    placePlayerOnDanceSpot()

    // ── Auto-miss if measure ends without Space ──
    if (gameState.measureProgress >= 1.0 && !gameState.spacePressed) {
      missSequence()
    }

    if (gameState.playMode === 'multiplayer') return

    // ── Advance to next measure ──
    if (gameState.measureProgress >= 1.0) {
      gameState.measureCount++
      if (gameState.measureCount >= TOTAL_MEASURES) {
        finishGame(true)
      } else {
        totalBeats += Math.ceil(gameState.roundDuration / BEAT_DURATION)
        startComboWait()
      }
    }
  })
}
