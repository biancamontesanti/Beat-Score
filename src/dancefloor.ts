import {
  Billboard,
  engine,
  Entity,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  MaterialTransparencyMode,
  TextShape,
  VisibilityComponent,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { JUDGMENT_DISPLAY_DURATION, MISS_DISPLAY_DURATION, gameState, getDanceSlotForPlayer, isPlayerRankVisible, localRankUp, playerRankPresences, type JudgmentText, type MatchPlayer } from './game'
import { getDanceRank, RANK_UP_DURATION, rankUpMotion } from './ranks'

// ──────────────────────────────────────────────────────────
// Scene constants  — 2×2 parcel = 32×32 m, centre at (16,0,16)
// ──────────────────────────────────────────────────────────
const CX = 16   // scene centre X
const CZ = 16   // scene centre Z
const SCENE_X_OFFSET = 16
const SCENE_Z_OFFSET = 16

function sceneX(x: number): number {
  return x + SCENE_X_OFFSET
}

function sceneZ(z: number): number {
  return z + SCENE_Z_OFFSET
}

// Main dance floor: 16×16 tiles, 1 m each
const FLOOR_TILE   = 16
const TILE_SIZE    = 1.0
const FLOOR_HEIGHT = 0.30
const FLOOR_OX     = CX - FLOOR_TILE / 2   //  8
const FLOOR_OZ     = CZ - FLOOR_TILE / 2   //  8

// ──────────────────────────────────────────────────────────
// Tile state
// ──────────────────────────────────────────────────────────
interface Tile { entity: Entity; baseColor: Color4; x: number; z: number }
const tiles: Tile[] = []

interface TileFlash {
  entity:     Entity
  baseColor:  Color4
  flashColor: Color4
  timer:      number
  duration:   number
  intensity:  number
}
const activeFlashes: TileFlash[] = []

// ──────────────────────────────────────────────────────────
// Disco-ball rotation
// ──────────────────────────────────────────────────────────
const discoBalls: Entity[] = []
let discoBallAngle = 0

interface LeaderboardRow {
  avatar: Entity
  placeBadge: Entity
  placeText: Entity
  nameText: Entity
  rankLabel: Entity
  rpText: Entity
  scoreText: Entity
  winsText: Entity
}
const leaderboardRows: LeaderboardRow[] = []

interface GlobalRecordRow {
  avatar: Entity
  nameText: Entity
  rankLabel: Entity
  rpText: Entity
  perfectText: Entity
  playedText: Entity
}
const globalRecordRows: GlobalRecordRow[] = []
const currentDanceEntities: Entity[] = []
const winnerHighlightEntities: Entity[] = []
interface WinnerConfettiPiece {
  entity: Entity
  x: number
  phase: number
  speed: number
  sway: number
}
const winnerHighlightConfetti: WinnerConfettiPiece[] = []
const globalRecordEntities: Entity[] = []
let currentDanceBoardRoot: Entity | null = null
const playerJudgmentTexts = new Map<string, Entity>()
const playerJudgmentCombos = new Map<string, Entity>()
const playerJudgmentSparkles = new Map<string, Entity[]>()
const playerJudgmentTextures = new Map<string, JudgmentText>()
let currentDanceTitleEntity: Entity | null = null
let currentDanceTitleSource = ''
let winnerHighlightAvatar: Entity | null = null
let winnerHighlightRankBadge: Entity | null = null
let winnerHighlightNameText: Entity | null = null
let winnerHighlightRankText: Entity | null = null
let winnerHighlightScoreText: Entity | null = null
let lastDancePhase = gameState.phase
let winnerHighlightTimer = 0
let leaderboardTimer = 0
let winnerCelebrationWasActive = false
let winnerConfettiTime = 0
let currentDancePage = 0
let currentDancePageTimer = 0
let lastDanceEntries: MatchPlayer[] = []
const WINNER_HIGHLIGHT_SECONDS = 8.0
const CURRENT_DANCE_PAGE_SECONDS = 3.0
const REACTIVE_FLOOR_INTERVAL = 0.12
const REACTIVE_FLOOR_MOVE_DISTANCE = 0.34
const REACTIVE_FLOOR_RADIUS = 0.92
const LEADERBOARD_LIFT = 1.65
let reactiveFloorTimer = 0
let lastReactiveX = Number.NaN
let lastReactiveZ = Number.NaN

// ──────────────────────────────────────────────────────────
// Colours
// ──────────────────────────────────────────────────────────
const TILE_BASE: Color4[] = [
  Color4.create(0.06, 0.04, 0.18, 1),
  Color4.create(0.08, 0.03, 0.22, 1),
  Color4.create(0.04, 0.06, 0.20, 1),
]

const FLASH_POOL: Color4[] = [
  Color4.create(1.0, 0.3, 0.7,  1),
  Color4.create(0.3, 0.6, 1.0,  1),
  Color4.create(0.4, 1.0, 0.5,  1),
  Color4.create(1.0, 0.9, 0.2,  1),
  Color4.create(1.0, 0.4, 0.1,  1),
  Color4.create(0.8, 0.2, 1.0,  1),
]

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────
function pbr(
  entity: Entity,
  albedo: Color4,
  emissive: Color3,
  emissiveIntensity: number,
  metallic = 0.85,
  roughness = 0.15,
): void {
  Material.setPbrMaterial(entity, { albedoColor: albedo, emissiveColor: emissive, emissiveIntensity, metallic, roughness })
}

function box(entity: Entity, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
  Transform.create(entity, {
    position: Vector3.create(sceneX(x), y, sceneZ(z)),
    scale:    Vector3.create(sx, sy, sz),
  })
  MeshRenderer.setBox(entity)
  MeshCollider.setBox(entity)
}

function setEntityGroupVisible(entities: Entity[], visible: boolean): void {
  for (const entity of entities) {
    VisibilityComponent.createOrReplace(entity, { visible, propagateToChildren: true })
  }
}

function remember(entity: Entity, collection: Entity[]): Entity {
  collection.push(entity)
  return entity
}

function playerFacingData(entity: Entity): Entity {
  return entity
}

function createFixedBoardRoot(originX: number, originZ: number, rotationY: number): Entity {
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(sceneX(originX), LEADERBOARD_LIFT, sceneZ(originZ)),
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
  })
  return root
}

function attachBoardEntities(root: Entity, entities: Entity[], originX: number, originZ: number): void {
  const originWorldX = sceneX(originX)
  const originWorldZ = sceneZ(originZ)
  for (const entity of entities) {
    const transform = Transform.getMutable(entity)
    transform.position = Vector3.create(
      transform.position.x - originWorldX,
      transform.position.y,
      transform.position.z - originWorldZ,
    )
    transform.rotation = Quaternion.Identity()
    transform.parent = root
  }
}

function textEntity(text: string, x: number, y: number, z: number, fontSize: number, color: Color4, scale = 0.35, rotationY = 180): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(sceneX(x), y, sceneZ(z)),
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
    scale: Vector3.create(scale, scale, scale),
  })
  TextShape.create(entity, {
    text,
    fontSize,
    textColor: color,
    outlineWidth: 0.08,
    outlineColor: Color3.create(0, 0, 0),
  })
  return entity
}

function neonTitleEntity(text: string, x: number, y: number, z: number, fontSize: number, color: Color4, scale: number, rotationY: number): Entity {
  const entity = textEntity(text, x, y, z, fontSize, color, scale, rotationY)
  const shape = TextShape.getMutable(entity)
  shape.outlineWidth = 0.24
  shape.outlineColor = Color3.create(color.r * 0.72, color.g * 0.72, color.b * 0.72)
  return entity
}

function addLeaderboardFrame(collection: Entity[], boardX: number, boardZ: number, accent: Color3): void {
  const frameColor = Color4.create(accent.r * 0.55, accent.g * 0.55, accent.b * 0.55, 1)
  const pieces: [number, number, number, number, number, number][] = [
    [boardX, 7.88, boardZ, 10.95, 0.12, 0.22],
    [boardX, 2.68, boardZ, 10.95, 0.12, 0.22],
    [boardX - 5.43, 5.28, boardZ, 0.12, 5.30, 0.22],
    [boardX + 5.43, 5.28, boardZ, 0.12, 5.30, 0.22],
  ]
  for (const [x, y, z, sx, sy, sz] of pieces) {
    const frame = remember(engine.addEntity(), collection)
    box(frame, x, y, z, sx, sy, sz)
    pbr(frame, frameColor, accent, 2.4, 0.2, 0.18)
  }
}

function leaderboardTitleEntity(src: string, x: number, y: number, z: number, width: number, rotationY: number): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(sceneX(x), y, sceneZ(z)),
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
    scale: Vector3.create(width, width / 3, 1),
  })
  MeshRenderer.setPlane(entity)
  setLeaderboardTitleImage(entity, src)
  return entity
}

function setLeaderboardTitleImage(entity: Entity, src: string): void {
  const texture = Material.Texture.Common({ src })
  Material.setBasicMaterial(entity, {
    texture,
    alphaTexture: texture,
    alphaTest: 0.04,
    castShadows: false,
    diffuseColor: Color4.White(),
  })
}

function glassRoundedSign(x: number, y: number, z: number, width: number, height: number, showCorners = true): void {
  const panel = engine.addEntity()
  box(panel, x, y, z, width, height, 0.10)
  pbr(panel,
    Color4.create(0.95, 0.55, 1.0, 0.22),
    Color3.create(0.95, 0.20, 0.75),
    0.85, 0.05, 0.08,
  )

  if (!showCorners) return

  const cornerPositions: [number, number][] = [
    [x - width / 2, y - height / 2],
    [x + width / 2, y - height / 2],
    [x - width / 2, y + height / 2],
    [x + width / 2, y + height / 2],
  ]

  for (const [cx, cy] of cornerPositions) {
    const corner = engine.addEntity()
    Transform.create(corner, {
      position: Vector3.create(sceneX(cx), cy, sceneZ(z + 0.03)),
      scale: Vector3.create(0.42, 0.42, 0.08),
    })
    MeshRenderer.setSphere(corner)
    pbr(corner,
      Color4.create(1.0, 0.35, 0.88, 0.34),
      Color3.create(1.0, 0.20, 0.78),
      1.2, 0.05, 0.06,
    )
  }
}

function placementLabel(index: number): string {
  return `${index + 1}º`
}

function placementColor(index: number): Color4 {
  if (index === 0) return Color4.create(1.0, 0.72, 0.10, 0.96)
  if (index === 1) return Color4.create(0.74, 0.78, 0.90, 0.94)
  if (index === 2) return Color4.create(0.84, 0.46, 0.18, 0.94)
  return Color4.create(0.30, 0.16, 0.52, 0.92)
}

const rankImageSources = new Map<Entity, string>()

function setRankImage(entity: Entity, src: string, alpha = 1): void {
  if (rankImageSources.get(entity) !== src) {
    const texture = Material.Texture.Common({ src })
    Material.setPbrMaterial(entity, {
      texture, emissiveTexture: texture,
      albedoColor: Color4.create(1, 1, 1, alpha),
      emissiveColor: Color3.White(), emissiveIntensity: 1,
      directIntensity: 0, specularIntensity: 0,
      metallic: 0, roughness: 1, castShadows: false,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    })
    rankImageSources.set(entity, src)
  } else {
    const material = Material.get(entity).material
    if (material?.$case === 'pbr' && material.pbr.albedoColor?.a !== alpha) {
      const mutable = Material.getMutable(entity).material
      if (mutable?.$case === 'pbr') mutable.pbr.albedoColor = Color4.create(1, 1, 1, alpha)
    }
  }
}

function rankImageEntity(x: number, y: number, z: number, width: number, points: number, badge = false, rotationY = 0): Entity {
  const entity = engine.addEntity()
  const rank = getDanceRank(points)
  Transform.create(entity, {
    position: Vector3.create(sceneX(x), y, sceneZ(z)),
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
    scale: Vector3.create(width, badge ? width : width / rank.labelAspect, 1),
  })
  MeshRenderer.setPlane(entity)
  setRankImage(entity, badge ? rank.badge : rank.label)
  return entity
}

interface AvatarRankVisuals {
  label: Entity
  badge: Entity
  sparkles: Entity[]
}
const avatarRankVisuals = new Map<string, AvatarRankVisuals>()
const AVATAR_RANK_LABEL_WIDTH = 1.35 * 0.8
const AVATAR_RANK_LABEL_HEIGHT = 2.65

function updateAvatarRanks(): void {
  const profiles = new Map(playerRankPresences)
  const local = getPlayer()
  if (local) profiles.set(local.userId.toLowerCase(), {
    playerId: local.userId.toLowerCase(), rankPoints: gameState.rankPoints,
    rankUpId: localRankUp.id, rankUpPoints: localRankUp.points, rankUpTimer: localRankUp.timer, lastSeen: Date.now(),
  })
  // A match update can arrive before the separate rank presence snapshot.
  for (const player of gameState.matchPlayers) {
    const id = player.playerId.toLowerCase()
    if (!profiles.has(id)) profiles.set(id, {
      playerId: id, rankPoints: player.rankPoints, rankUpId: 0, rankUpPoints: 0, rankUpTimer: 0, lastSeen: player.lastSeen,
    })
  }
  for (const [id, profile] of profiles) {
    const player = getPlayer({ userId: id })
    let visuals = avatarRankVisuals.get(id)
    const visible = !!player?.position && isPlayerRankVisible(id)
    if (!visible) {
      if (visuals) setEntityGroupVisible([visuals.label, visuals.badge, ...visuals.sparkles], false)
      continue
    }
    if (!visuals) {
      const label = rankImageEntity(16, AVATAR_RANK_LABEL_HEIGHT, 16, AVATAR_RANK_LABEL_WIDTH, profile.rankPoints)
      const badge = rankImageEntity(16, 3.5, 16, 0.9, profile.rankPoints, true)
      Billboard.create(label, {})
      Billboard.create(badge, {})
      visuals = { label, badge, sparkles: [] }
      avatarRankVisuals.set(id, visuals)
    }
    const position = player!.position!
    // Place the permanent label just in front of the avatar, facing each viewer.
    const camera = Transform.getOrNull(engine.CameraEntity)?.position
    const dx = (camera?.x ?? position.x) - position.x
    const dz = (camera?.z ?? position.z - 1) - position.z
    const distance = Math.max(0.001, Math.hypot(dx, dz))
    const x = position.x + dx / distance * 0.35
    const z = position.z + dz / distance * 0.35
    const rank = getDanceRank(profile.rankPoints)
    Transform.getMutable(visuals.label).position = Vector3.create(x, position.y + AVATAR_RANK_LABEL_HEIGHT, z)
    Transform.getMutable(visuals.label).scale = Vector3.create(AVATAR_RANK_LABEL_WIDTH, AVATAR_RANK_LABEL_WIDTH / rank.labelAspect, 1)
    setRankImage(visuals.label, rank.label)
    VisibilityComponent.createOrReplace(visuals.label, { visible: true })

    const celebrating = profile.rankUpTimer > 0
    if (celebrating && visuals.sparkles.length === 0) {
      visuals.sparkles = Array.from({ length: 10 }, (_, index) => {
        const sparkle = textEntity(index % 2 === 0 ? '★' : '✦', 16, 3.5, 16, 3, Color4.White(), 0.15, 0)
        Billboard.create(sparkle, {})
        return sparkle
      })
    }
    VisibilityComponent.createOrReplace(visuals.badge, { visible: celebrating })
    for (const sparkle of visuals.sparkles) VisibilityComponent.createOrReplace(sparkle, { visible: celebrating })
    if (!celebrating) continue
    const elapsed = RANK_UP_DURATION - profile.rankUpTimer
    const motion = rankUpMotion(elapsed)
    const y = position.y + 3.55 + motion.rise
    const badge = Transform.getMutable(visuals.badge)
    badge.position = Vector3.create(x, y, z)
    badge.scale = Vector3.create(0.95 * motion.scale, 0.95 * motion.scale, 1)
    const celebrationRank = getDanceRank(profile.rankUpPoints)
    setRankImage(visuals.badge, celebrationRank.badge, motion.alpha)
    for (let index = 0; index < visuals.sparkles.length; index++) {
      const angle = Math.PI * 2 * index / visuals.sparkles.length + elapsed * 0.8
      const radius = 0.55 + Math.min(elapsed, 1.6) * 0.22
      const sparkle = visuals.sparkles[index]
      Transform.getMutable(sparkle).position = Vector3.create(
        x + dz / distance * Math.cos(angle) * radius,
        y + Math.sin(angle) * radius,
        z - dx / distance * Math.cos(angle) * radius,
      )
      const color = celebrationRank.confetti[index % celebrationRank.confetti.length]
      TextShape.getMutable(sparkle).textColor = Color4.create(color.r, color.g, color.b, motion.alpha * Math.max(0, 1 - elapsed / 3))
    }
  }
  for (const [id, visuals] of avatarRankVisuals) {
    if (profiles.has(id)) continue
    for (const entity of [visuals.label, visuals.badge, ...visuals.sparkles]) {
      rankImageSources.delete(entity)
      engine.removeEntity(entity)
    }
    avatarRankVisuals.delete(id)
  }
}

function judgmentColor(text: JudgmentText | ''): Color4 {
  if (text === 'PERFECT!') return Color4.create(0.25, 0.85, 1.0, 1)
  if (text === 'GREAT!') return Color4.create(0.4, 1.0, 0.55, 1)
  if (text === 'COOL!') return Color4.create(0.75, 0.35, 1.0, 1)
  if (text === 'GOOD!') return Color4.create(1.0, 0.55, 0.15, 1)
  return Color4.create(1.0, 0.30, 0.30, 1)
}

function judgmentTexture(text: JudgmentText): string {
  if (text === 'PERFECT!') return 'assets/images/ui/judgment-perfect.png'
  if (text === 'GREAT!') return 'assets/images/ui/judgment-great.png'
  if (text === 'COOL!') return 'assets/images/ui/judgment-cool.png'
  if (text === 'GOOD!') return 'assets/images/ui/judgment-good.png'
  return 'assets/images/ui/judgment-miss.png'
}

function judgmentPopScale(progress: number): number {
  if (progress < 0.14) return 0.68 + (progress / 0.14) * 0.48
  if (progress < 0.28) return 1.16 - ((progress - 0.14) / 0.14) * 0.16
  return 1
}

function getPlayerJudgmentText(player: MatchPlayer): Entity {
  let entity = playerJudgmentTexts.get(player.playerId)
  if (!entity) {
    entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.create(sceneX(16), 1.72, sceneZ(16)),
      scale: Vector3.create(1.78, 0.44, 1),
    })
    MeshRenderer.setPlane(entity)
    Billboard.create(entity, {})
    const texture = Material.Texture.Common({ src: judgmentTexture('MISS!') })
    Material.setBasicMaterial(entity, {
      texture,
      alphaTexture: texture,
      alphaTest: 0.04,
      castShadows: false,
      diffuseColor: Color4.White(),
    })
    VisibilityComponent.createOrReplace(entity, { visible: false })
    playerJudgmentTexts.set(player.playerId, entity)

    const combo = textEntity('', 16, 1.72, 16, 4, Color4.create(0.25, 0.85, 1.0, 1), 0.34, 0)
    Billboard.create(combo, {})
    VisibilityComponent.createOrReplace(combo, { visible: false })
    playerJudgmentCombos.set(player.playerId, combo)

    const sparkles = Array.from({ length: 10 }, (_, index) => {
      const sparkle = textEntity(index % 3 === 0 ? '★' : index % 2 === 0 ? '✦' : '◆', 16, 1.7, 16, 3, Color4.White(), 0.18, 0)
      Billboard.create(sparkle, {})
      VisibilityComponent.createOrReplace(sparkle, { visible: false })
      return sparkle
    })
    playerJudgmentSparkles.set(player.playerId, sparkles)
  }
  return entity
}

function updatePlayerJudgmentTexts(): void {
  const activeIds = new Set<string>()
  const visiblePhase = gameState.phase === 'playing' && gameState.playMode === 'multiplayer'

  for (const player of gameState.matchPlayers) {
    activeIds.add(player.playerId)
    const slot = getDanceSlotForPlayer(player.playerId)
    const entity = getPlayerJudgmentText(player)
    const visible = visiblePhase && player.ready && player.phase === 'playing' && player.judgmentTimer > 0 && !!player.judgmentText
    VisibilityComponent.createOrReplace(entity, { visible, propagateToChildren: true })
    const combo = playerJudgmentCombos.get(player.playerId)
    const sparkles = playerJudgmentSparkles.get(player.playerId) || []
    if (!visible) {
      if (combo) VisibilityComponent.createOrReplace(combo, { visible: false })
      for (const sparkle of sparkles) VisibilityComponent.createOrReplace(sparkle, { visible: false })
      continue
    }

    const transform = Transform.getMutable(entity)
    transform.position = Vector3.create(slot.x, 1.72, slot.z - 0.36)
    transform.scale = Vector3.create(1.78, 0.44, 1)

    if (playerJudgmentTextures.get(player.playerId) !== player.judgmentText) {
      const texture = Material.Texture.Common({ src: judgmentTexture(player.judgmentText as JudgmentText) })
      Material.setBasicMaterial(entity, {
        texture,
        alphaTexture: texture,
        alphaTest: 0.04,
        castShadows: false,
        diffuseColor: Color4.White(),
      })
      playerJudgmentTextures.set(player.playerId, player.judgmentText as JudgmentText)
    }

    if (combo) {
      const showCombo = player.judgmentText === 'PERFECT!' && player.judgmentCombo > 1
      VisibilityComponent.createOrReplace(combo, { visible: showCombo })
      if (showCombo) {
        Transform.getMutable(combo).position = Vector3.create(slot.x + 0.58, 1.70, slot.z - 0.36)
        const comboText = TextShape.getMutable(combo)
        comboText.text = `${player.judgmentCombo}x`
        comboText.textColor = Color4.create(0.25, 0.85, 1.0, Math.max(0, player.judgmentTimer / JUDGMENT_DISPLAY_DURATION))
      }
    }

    const showSparkles = player.judgmentText !== 'MISS!'
    const displayDuration = player.judgmentText === 'MISS!' ? MISS_DISPLAY_DURATION : JUDGMENT_DISPLAY_DURATION
    const progress = Math.max(0, Math.min(1, 1 - player.judgmentTimer / displayDuration))
    const popScale = judgmentPopScale(progress)
    transform.position = Vector3.create(slot.x, 1.72 + (1 - popScale) * 0.16, slot.z - 0.36)
    transform.scale = Vector3.create(1.78 * popScale, 0.44 * popScale, 1)
    const color = judgmentColor(player.judgmentText)
    for (let index = 0; index < sparkles.length; index++) {
      const sparkle = sparkles[index]
      VisibilityComponent.createOrReplace(sparkle, { visible: showSparkles })
      if (!showSparkles) continue
      const angle = (Math.PI * 2 * index) / sparkles.length
      const distance = 0.34 + progress * (0.72 + (index % 3) * 0.12)
      Transform.getMutable(sparkle).position = Vector3.create(
        slot.x + Math.cos(angle) * distance,
        1.72 + Math.sin(angle) * distance * 0.48,
        slot.z - 0.38,
      )
      TextShape.getMutable(sparkle).textColor = Color4.create(color.r, color.g, color.b, Math.max(0, 1 - progress))
    }
  }

  for (const [playerId, entity] of playerJudgmentTexts) {
    if (!activeIds.has(playerId)) {
      VisibilityComponent.createOrReplace(entity, { visible: false, propagateToChildren: true })
      const combo = playerJudgmentCombos.get(playerId)
      if (combo) VisibilityComponent.createOrReplace(combo, { visible: false })
      for (const sparkle of playerJudgmentSparkles.get(playerId) || []) {
        VisibilityComponent.createOrReplace(sparkle, { visible: false })
      }
    }
  }
}

function getCurrentDanceEntries(): MatchPlayer[] {
  if (gameState.playMode === 'solo') {
    const profile = getPlayer()
    const localEntry = gameState.matchPlayers.find(player => player.isLocal)
    const profilePlayerId = profile?.userId || ''
    const playerId = profilePlayerId || localEntry?.playerId || 'local-player'

    // `ready` is a public-matchmaking flag, so solo entries deliberately keep
    // it false. Build the private result row from the local player only instead
    // of applying the multiplayer ready filter. This also supplies a stable
    // profile id for the physical avatar portrait on the victory banner.
    return [{
      playerId,
      name: profile?.name || localEntry?.name || 'YOU',
      score: gameState.score,
      maxCombo: gameState.maxCombo,
      rankPoints: gameState.rankPoints,
      wins: localEntry?.wins || 0,
      matchesPlayed: localEntry?.matchesPlayed || 0,
      slotIndex: localEntry?.slotIndex || 0,
      finished: gameState.phase === 'gameover' || !!localEntry?.finished,
      ready: false,
      phase: gameState.phase,
      matchStartTime: 0,
      judgmentText: localEntry?.judgmentText || '',
      judgmentCombo: localEntry?.judgmentCombo || 0,
      judgmentSentAt: localEntry?.judgmentSentAt || 0,
      judgmentTimer: localEntry?.judgmentTimer || 0,
      isLocal: true,
      lastSeen: localEntry?.lastSeen || Date.now(),
    }]
  }

  return gameState.matchPlayers
    .filter(player => player.ready && (player.phase === 'playing' || player.phase === 'gameover'))
    .slice()
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.maxCombo !== a.maxCombo) return b.maxCombo - a.maxCombo
      return a.name.localeCompare(b.name)
    })
}

// ──────────────────────────────────────────────────────────
// 1. 16×16 reflective dance floor
// ──────────────────────────────────────────────────────────
function buildFloor(): void {
  for (let row = 0; row < FLOOR_TILE; row++) {
    for (let col = 0; col < FLOOR_TILE; col++) {
      const e = engine.addEntity()
      const base = TILE_BASE[(row + col) % TILE_BASE.length]
      const x = sceneX(FLOOR_OX + col + 0.5)
      const z = sceneZ(FLOOR_OZ + row + 0.5)

      Transform.create(e, {
        position: Vector3.create(x, FLOOR_HEIGHT + 0.01, z),
        scale: Vector3.create(TILE_SIZE * 0.97, 0.04, TILE_SIZE * 0.97),
      })
      MeshRenderer.setBox(e)
      pbr(e, base, Color3.create(base.r * 0.4, base.g * 0.4, base.b * 0.4), 0.3)
      tiles.push({ entity: e, baseColor: base, x, z })
    }
  }

  // Raised stage platform under the floor
  const stage = engine.addEntity()
  box(stage, CX, FLOOR_HEIGHT - 0.15, CZ, FLOOR_TILE + 2, 0.3, FLOOR_TILE + 2)
  pbr(stage,
    Color4.create(0.04, 0.03, 0.10, 1),
    Color3.create(0.06, 0.03, 0.15),
    0.4, 0.9, 0.1,
  )
}

// ──────────────────────────────────────────────────────────
// 2. Stage backdrop — full 32 m wide back wall
// ──────────────────────────────────────────────────────────
function buildBackdrop(): void {
  // Main dark panel
  const back = engine.addEntity()
  box(back, CX, 5.0, 1.5, 30, 10, 0.25)
  pbr(back,
    Color4.create(0.02, 0.01, 0.08, 1),
    Color3.create(0.06, 0.03, 0.20),
    0.5, 0.95, 0.05,
  )

  // Left neon bar
  const lBar = engine.addEntity()
  box(lBar, 1.8, 5.0, 1.6, 0.18, 10, 0.18)
  pbr(lBar, Color4.create(0.3, 0.5, 1, 1), Color3.create(0.3, 0.5, 1), 3.0, 0.0, 1.0)

  // Right neon bar
  const rBar = engine.addEntity()
  box(rBar, 30.2, 5.0, 1.6, 0.18, 10, 0.18)
  pbr(rBar, Color4.create(1, 0.3, 0.6, 1), Color3.create(1, 0.3, 0.6), 3.0, 0.0, 1.0)

  // Horizontal top strip
  const topStrip = engine.addEntity()
  box(topStrip, CX, 10.1, 1.6, 30, 0.18, 0.18)
  pbr(topStrip, Color4.create(0.8, 0.2, 1.0, 1), Color3.create(0.8, 0.2, 1.0), 2.5, 0.0, 1.0)

  // Horizontal bottom strip
  const botStrip = engine.addEntity()
  box(botStrip, CX, 0.25, 1.6, 30, 0.12, 0.12)
  pbr(botStrip, Color4.create(0.2, 0.8, 1.0, 1), Color3.create(0.2, 0.8, 1.0), 2.0, 0.0, 1.0)

  // Opposite records wall
  const recordsWall = engine.addEntity()
  box(recordsWall, CX, 5, 30.5, 30, 10, 0.25)
  pbr(recordsWall,
    Color4.create(0.02, 0.01, 0.07, 1),
    Color3.create(0.04, 0.02, 0.12),
    0.3, 0.9, 0.1,
  )
}

function buildPhysicalLeaderboard(): void {
  const boardX = 16.0
  const boardZ = 30.18
  const rowZ = 29.98
  const badgeZ = 29.84
  const textZ = 29.76
  // Keep the title plane clearly in front of the board/frame to avoid
  // depth-buffer clipping at oblique camera angles.
  const titleZ = 29.38
  const rotationY = 0

  const board = engine.addEntity()
  remember(board, currentDanceEntities)
  box(board, boardX, 5.28, boardZ, 10.75, 5.18, 0.16)
  pbr(board,
    Color4.create(0.015, 0.012, 0.045, 0.98),
    Color3.create(0.06, 0.02, 0.16),
    0.9, 0.2, 0.35,
  )
  addLeaderboardFrame(currentDanceEntities, boardX, boardZ, Color3.create(1.0, 0.18, 0.58))

  currentDanceTitleSource = 'assets/images/ui/levels/current-game.png'
  currentDanceTitleEntity = remember(leaderboardTitleEntity(currentDanceTitleSource, boardX, 7.50, titleZ, 6.7, rotationY), currentDanceEntities)
  remember(playerFacingData(textEntity('PLAYER', boardX - 2.45, 6.86, textZ, 5, Color4.create(0.82, 0.86, 1.0, 1), 0.43, rotationY)), currentDanceEntities)
  remember(playerFacingData(textEntity('DANCE RANK', boardX - 0.55, 6.86, textZ, 5, Color4.create(1.0, 0.58, 1.0, 1), 0.41, rotationY)), currentDanceEntities)
  remember(playerFacingData(textEntity('RP POINTS', boardX + 1.32, 6.86, textZ, 5, Color4.create(1.0, 0.82, 0.22, 1), 0.41, rotationY)), currentDanceEntities)
  remember(playerFacingData(textEntity('SCORE', boardX + 2.62, 6.86, textZ, 5, Color4.create(0.78, 0.92, 1.0, 1), 0.41, rotationY)), currentDanceEntities)
  remember(playerFacingData(textEntity('WINS', boardX + 3.48, 6.86, textZ, 5, Color4.create(0.40, 1.0, 0.85, 1), 0.41, rotationY)), currentDanceEntities)
  remember(playerFacingData(textEntity('PLACE', boardX + 4.45, 6.86, textZ, 5, Color4.create(1.0, 0.82, 0.22, 1), 0.43, rotationY)), currentDanceEntities)

  for (let i = 0; i < 5; i++) {
    const y = 6.38 - i * 0.72
    const rowBack = engine.addEntity()
    remember(rowBack, currentDanceEntities)
    box(rowBack, boardX, y, rowZ, 10.15, 0.62, 0.08)
    pbr(rowBack,
      i === 0 ? Color4.create(0.18, 0.12, 0.02, 0.95) : Color4.create(0.035, 0.035, 0.09, 0.90),
      i === 0 ? Color3.create(0.75, 0.46, 0.08) : Color3.create(0.08, 0.10, 0.20),
      i === 0 ? 1.2 : 0.45, 0.35, 0.45,
    )

    const placeBadge = engine.addEntity()
    remember(placeBadge, currentDanceEntities)
    box(placeBadge, boardX + 4.45, y, badgeZ, 0.92, 0.46, 0.06)
    const placeColor = placementColor(i)
    pbr(
      placeBadge,
      placeColor,
      Color3.create(placeColor.r, placeColor.g, placeColor.b),
      i < 3 ? 0.9 : 0.45,
      0.18,
      0.18,
    )

    const rankLabel = remember(rankImageEntity(boardX - 0.55, y, textZ, 1.65, 0, false, rotationY), currentDanceEntities)

    const avatar = engine.addEntity()
    remember(avatar, currentDanceEntities)
    Transform.create(avatar, {
      position: Vector3.create(sceneX(boardX - 4.35), y, sceneZ(textZ)),
      rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
      scale: Vector3.create(0.70, 0.70, 0.70),
    })
    MeshRenderer.setPlane(avatar)
    Material.setBasicMaterial(avatar, {
      diffuseColor: Color4.create(0.05, 0.05, 0.12, 1),
    })
    playerFacingData(avatar)

    leaderboardRows.push({
      avatar,
      placeBadge,
      placeText: remember(playerFacingData(textEntity(placementLabel(i), boardX + 4.45, y - 0.01, textZ, 5, Color4.create(0.04, 0.03, 0.08, 1), 0.43, rotationY)), currentDanceEntities),
      nameText: remember(playerFacingData(textEntity('---', boardX - 2.45, y - 0.02, textZ, 5, Color4.create(0.96, 0.96, 1.0, 1), 0.46, rotationY)), currentDanceEntities),
      rankLabel,
      rpText: remember(playerFacingData(textEntity('0', boardX + 1.32, y - 0.02, textZ, 5, Color4.create(1.0, 0.82, 0.22, 1), 0.41, rotationY)), currentDanceEntities),
      scoreText: remember(playerFacingData(textEntity('0', boardX + 2.62, y - 0.02, textZ, 5, Color4.create(0.78, 0.92, 1.0, 1), 0.38, rotationY)), currentDanceEntities),
      winsText: remember(playerFacingData(textEntity('0', boardX + 3.48, y - 0.02, textZ, 5, Color4.create(0.40, 1.0, 0.85, 1), 0.41, rotationY)), currentDanceEntities),
    })
  }

  currentDanceBoardRoot = createFixedBoardRoot(boardX, boardZ, 0)
  attachBoardEntities(currentDanceBoardRoot, currentDanceEntities, boardX, boardZ)
}

function buildWinnerHighlight(): void {
  const boardX = 16.0
  const boardZ = 30.18
  const textZ = 29.56
  const rotationY = 0

  const panel = engine.addEntity()
  remember(panel, winnerHighlightEntities)
  box(panel, boardX, 5.35, boardZ, 10.75, 5.60, 0.18)
  pbr(panel,
    Color4.create(0.012, 0.008, 0.045, 0.98),
    Color3.create(0.18, 0.02, 0.20),
    0.82, 0.18, 0.28,
  )
  addLeaderboardFrame(winnerHighlightEntities, boardX, boardZ, Color3.create(1.0, 0.16, 0.64))

  const badge = engine.addEntity()
  remember(badge, winnerHighlightEntities)
  box(badge, boardX, 7.48, boardZ - 0.18, 5.4, 0.78, 0.08)
  pbr(badge,
    Color4.create(1.0, 0.68, 0.08, 0.96),
    Color3.create(1.0, 0.62, 0.16),
    1.15, 0.18, 0.16,
  )

  remember(neonTitleEntity('★  VICTORY  ★', boardX, 7.48, textZ - 0.12, 8, Color4.create(0.08, 0.02, 0.10, 1), 0.68, rotationY), winnerHighlightEntities)
  remember(neonTitleEntity('♛', boardX - 2.55, 7.03, textZ - 0.16, 8, Color4.create(1.0, 0.82, 0.16, 1), 0.56, rotationY), winnerHighlightEntities)

  const avatar = engine.addEntity()
  winnerHighlightAvatar = remember(avatar, winnerHighlightEntities)
  Transform.create(avatar, {
    position: Vector3.create(sceneX(boardX - 2.55), 5.42, sceneZ(textZ - 0.22)),
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
    scale: Vector3.create(2.55, 2.55, 2.55),
  })
  MeshRenderer.setPlane(avatar)
  Material.setPbrMaterial(avatar, {
    albedoColor: Color4.create(1, 1, 1, 0),
    transparencyMode: 3,
    alphaTest: 0.02,
    metallic: 0,
    roughness: 1,
  })
  playerFacingData(avatar)

  remember(playerFacingData(textEntity('WINNER', boardX + 1.45, 6.66, textZ - 0.12, 5, Color4.create(0.40, 1.0, 0.88, 1), 0.43, rotationY)), winnerHighlightEntities)
  winnerHighlightRankBadge = remember(rankImageEntity(boardX - 1.35, 4.3, textZ - 0.30, 1.1, 0, true), winnerHighlightEntities)
  winnerHighlightNameText = remember(playerFacingData(neonTitleEntity('---', boardX + 1.45, 5.76, textZ - 0.14, 10, Color4.create(1.0, 0.26, 0.76, 1), 0.82, rotationY)), winnerHighlightEntities)
  winnerHighlightRankText = remember(playerFacingData(textEntity('---', boardX + 1.45, 4.72, textZ - 0.12, 5, Color4.create(0.40, 1.0, 0.85, 1), 0.50, rotationY)), winnerHighlightEntities)
  winnerHighlightScoreText = remember(playerFacingData(neonTitleEntity('SCORE 0', boardX + 1.45, 3.86, textZ - 0.14, 6, Color4.create(1.0, 0.82, 0.22, 1), 0.56, rotationY)), winnerHighlightEntities)

  const confettiSymbols = ['◆', '●', '★', '✦']
  const confettiColors = getDanceRank(0).confetti.map(color => Color4.create(color.r, color.g, color.b, 1))
  for (let index = 0; index < 34; index++) {
    const x = -5.0 + ((index * 37) % 100) / 100 * 10.0
    const y = 2.80 + ((index * 29) % 100) / 100 * 5.5
    const confetti = remember(playerFacingData(textEntity(
      confettiSymbols[index % confettiSymbols.length],
      boardX + x,
      y,
      textZ - 0.20,
      4,
      confettiColors[index % confettiColors.length],
      0.22 + (index % 3) * 0.035,
      rotationY,
    )), winnerHighlightEntities)
    winnerHighlightConfetti.push({
      entity: confetti,
      x,
      phase: ((index * 29) % 100) / 100,
      speed: 0.10 + (index % 5) * 0.018,
      sway: 0.18 + (index % 4) * 0.06,
    })
  }

  if (currentDanceBoardRoot) {
    attachBoardEntities(currentDanceBoardRoot, winnerHighlightEntities, boardX, boardZ)
  }

  setEntityGroupVisible(winnerHighlightEntities, false)
}

function buildGlobalRecordsLeaderboard(): void {
  const boardX = 16.0
  const boardZ = 4.92
  const frameZ = 5.06
  const rowZ = 4.58
  const badgeZ = 4.34
  const textZ = 4.12
  const rotationY = 180

  // 15% larger and lifted by another 8% of its rendered height.
  remember(leaderboardTitleEntity('assets/images/ui/levels/global-leaderboard.png', boardX, 7.77, textZ, 10.58, rotationY), globalRecordEntities)

  const board = engine.addEntity()
  remember(board, globalRecordEntities)
  box(board, boardX, 5.28, boardZ, 10.75, 5.18, 0.16)
  pbr(board,
    Color4.create(0.015, 0.012, 0.045, 0.98),
    Color3.create(0.06, 0.02, 0.16),
    0.9, 0.2, 0.35,
  )
  addLeaderboardFrame(globalRecordEntities, boardX, frameZ, Color3.create(0.0, 0.83, 1.0))

  remember(playerFacingData(textEntity('PLAYER', boardX - 2.55, 6.98, textZ, 5, Color4.create(0.82, 0.86, 1.0, 1), 0.43, rotationY)), globalRecordEntities)
  remember(playerFacingData(textEntity('BADGES', boardX - 0.72, 6.98, textZ, 5, Color4.create(1.0, 0.58, 1.0, 1), 0.41, rotationY)), globalRecordEntities)
  remember(playerFacingData(textEntity('RP', boardX + 0.88, 6.98, textZ, 5, Color4.create(1.0, 0.82, 0.22, 1), 0.41, rotationY)), globalRecordEntities)
  remember(playerFacingData(textEntity('MAX PERFECT', boardX + 2.15, 6.98, textZ, 5, Color4.create(0.78, 0.92, 1.0, 1), 0.34, rotationY)), globalRecordEntities)
  remember(playerFacingData(textEntity('PLAYED', boardX + 3.58, 6.98, textZ, 5, Color4.create(0.40, 1.0, 0.85, 1), 0.39, rotationY)), globalRecordEntities)

  for (let i = 0; i < 5; i++) {
    const y = 6.36 - i * 0.72
    const rowBack = engine.addEntity()
    remember(rowBack, globalRecordEntities)
    box(rowBack, boardX, y, rowZ, 10.15, 0.62, 0.08)
    pbr(rowBack,
      i === 0 ? Color4.create(0.04, 0.17, 0.20, 0.95) : Color4.create(0.035, 0.035, 0.09, 0.90),
      i === 0 ? Color3.create(0.30, 1.0, 0.85) : Color3.create(0.08, 0.10, 0.20),
      i === 0 ? 1.0 : 0.45, 0.35, 0.45,
    )

    const rankLabel = remember(rankImageEntity(boardX - 0.72, y, textZ, 1.65, 0, false, rotationY), globalRecordEntities)

    const avatar = engine.addEntity()
    remember(avatar, globalRecordEntities)
    Transform.create(avatar, {
      position: Vector3.create(sceneX(boardX - 4.35), y, sceneZ(textZ)),
      rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
      scale: Vector3.create(0.70, 0.70, 0.70),
    })
    MeshRenderer.setPlane(avatar)
    Material.setBasicMaterial(avatar, {
      diffuseColor: Color4.create(0.05, 0.05, 0.12, 1),
    })
    playerFacingData(avatar)

    globalRecordRows.push({
      avatar,
      nameText: remember(playerFacingData(textEntity('---', boardX - 2.55, y - 0.02, textZ, 5, Color4.create(0.96, 0.96, 1.0, 1), 0.46, rotationY)), globalRecordEntities),
      rankLabel,
      rpText: remember(playerFacingData(textEntity('0', boardX + 0.88, y - 0.02, textZ, 5, Color4.create(1.0, 0.82, 0.22, 1), 0.41, rotationY)), globalRecordEntities),
      perfectText: remember(playerFacingData(textEntity('0x', boardX + 2.15, y - 0.02, textZ, 5, Color4.create(0.78, 0.92, 1.0, 1), 0.38, rotationY)), globalRecordEntities),
      playedText: remember(playerFacingData(textEntity('0', boardX + 3.58, y - 0.02, textZ, 5, Color4.create(0.40, 1.0, 0.85, 1), 0.39, rotationY)), globalRecordEntities),
    })
  }

  const globalBoardRoot = createFixedBoardRoot(boardX, boardZ, 180)
  attachBoardEntities(globalBoardRoot, globalRecordEntities, boardX, boardZ)
}

function getCurrentDanceDisplayEntries(): MatchPlayer[] {
  if (gameState.phase === 'playing') return getCurrentDanceEntries()
  return lastDanceEntries.length > 0 ? lastDanceEntries : getCurrentDanceEntries()
}

function updateCurrentDancePagination(dt: number): void {
  const rows = getCurrentDanceDisplayEntries()
  const pageCount = Math.max(1, Math.ceil(rows.length / Math.max(leaderboardRows.length, 1)))
  if (pageCount <= 1) {
    currentDancePage = 0
    currentDancePageTimer = 0
    return
  }

  currentDancePageTimer += dt
  if (currentDancePageTimer >= CURRENT_DANCE_PAGE_SECONDS) {
    currentDancePageTimer = 0
    currentDancePage = (currentDancePage + 1) % pageCount
  }
}

function updatePhysicalLeaderboard(): void {
  const allRows = getCurrentDanceDisplayEntries()
  const pageCount = Math.max(1, Math.ceil(allRows.length / Math.max(leaderboardRows.length, 1)))
  const pageStart = (currentDancePage % pageCount) * leaderboardRows.length
  const rows = allRows
    .slice(pageStart, pageStart + leaderboardRows.length)
    .slice(0, leaderboardRows.length)

  leaderboardRows.forEach((row, i) => {
    const placeIndex = pageStart + i
    const entry = rows[i]
    TextShape.getMutable(row.placeText).text = placementLabel(placeIndex)
    const placeColor = placementColor(placeIndex)
    pbr(
      row.placeBadge,
      placeColor,
      Color3.create(placeColor.r, placeColor.g, placeColor.b),
      placeIndex < 3 ? 0.9 : 0.45,
      0.18,
      0.18,
    )

    if (!entry) {
      TextShape.getMutable(row.nameText).text = '---'
      setRankImage(row.rankLabel, getDanceRank(0).label, 0)
      TextShape.getMutable(row.rpText).text = '0'
      TextShape.getMutable(row.scoreText).text = '0'
      TextShape.getMutable(row.winsText).text = '0'
      Material.setBasicMaterial(row.avatar, {
        diffuseColor: Color4.create(0.05, 0.05, 0.12, 1),
      })
      return
    }

    TextShape.getMutable(row.nameText).text = String(entry.name).slice(0, 12)
    const rank = getDanceRank(entry.rankPoints)
    setRankImage(row.rankLabel, rank.label)
    Transform.getMutable(row.rankLabel).scale = Vector3.create(1.65, 1.65 / rank.labelAspect, 1)
    TextShape.getMutable(row.rpText).text = String(entry.rankPoints)
    TextShape.getMutable(row.scoreText).text = String(entry.score)
    TextShape.getMutable(row.winsText).text = String(entry.wins)
    Material.setBasicMaterial(row.avatar, {
      texture: Material.Texture.Avatar({ userId: entry.playerId }),
      diffuseColor: Color4.create(1, 1, 1, 1),
    })
  })
}

function updateGlobalRecordsLeaderboard(): void {
  const rows = gameState.globalLeaderboard
    .slice()
    .sort((a, b) => {
      if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
      if (b.maxCombo !== a.maxCombo) return b.maxCombo - a.maxCombo
      if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed
      if (b.wins !== a.wins) return b.wins - a.wins
      return b.score - a.score
    })
    .slice(0, globalRecordRows.length)

  globalRecordRows.forEach((row, i) => {
    const entry = rows[i]
    if (!entry) {
      TextShape.getMutable(row.nameText).text = '---'
      setRankImage(row.rankLabel, getDanceRank(0).label, 0)
      TextShape.getMutable(row.rpText).text = '0'
      TextShape.getMutable(row.perfectText).text = '0x'
      TextShape.getMutable(row.playedText).text = '0'
      Material.setBasicMaterial(row.avatar, {
        diffuseColor: Color4.create(0.05, 0.05, 0.12, 1),
      })
      return
    }

    TextShape.getMutable(row.nameText).text = String(entry.name).slice(0, 12)
    const rank = getDanceRank(entry.rankPoints)
    setRankImage(row.rankLabel, rank.label)
    Transform.getMutable(row.rankLabel).scale = Vector3.create(1.65, 1.65 / rank.labelAspect, 1)
    TextShape.getMutable(row.rpText).text = String(entry.rankPoints)
    TextShape.getMutable(row.perfectText).text = `${entry.maxCombo}x`
    TextShape.getMutable(row.playedText).text = String(entry.matchesPlayed)
    Material.setBasicMaterial(row.avatar, {
      texture: Material.Texture.Avatar({ userId: entry.playerId }),
      diffuseColor: Color4.create(1, 1, 1, 1),
    })
  })
}

function updateWinnerHighlight(dt: number): void {
  const winner = getCurrentDanceEntries()[0]
  if (!winner) {
    if (winnerHighlightRankBadge) setRankImage(winnerHighlightRankBadge, getDanceRank(0).badge, 0)
    if (winnerHighlightNameText) TextShape.getMutable(winnerHighlightNameText).text = '---'
    if (winnerHighlightRankText) TextShape.getMutable(winnerHighlightRankText).text = '---'
    if (winnerHighlightScoreText) TextShape.getMutable(winnerHighlightScoreText).text = 'SCORE 0'
    if (winnerHighlightAvatar) {
      Material.setPbrMaterial(winnerHighlightAvatar, {
        albedoColor: Color4.create(1, 1, 1, 0),
        transparencyMode: 3,
        alphaTest: 0.02,
        metallic: 0,
        roughness: 1,
      })
    }
    return
  }

  const winnerRank = getDanceRank(winner.rankPoints)
  if (winnerHighlightNameText) TextShape.getMutable(winnerHighlightNameText).text = String(winner.name).slice(0, 14)
  if (winnerHighlightRankBadge) setRankImage(winnerHighlightRankBadge, winnerRank.badge)
  if (winnerHighlightRankText) TextShape.getMutable(winnerHighlightRankText).text = `${winnerRank.name}  ${winner.rankPoints} RP`
  if (winnerHighlightScoreText) TextShape.getMutable(winnerHighlightScoreText).text = `SCORE ${winner.score}`
  if (winnerHighlightAvatar) {
    Material.setPbrMaterial(winnerHighlightAvatar, {
      texture: Material.Texture.Avatar({ userId: winner.playerId }),
      albedoColor: Color4.create(1, 1, 1, 1),
      transparencyMode: 3,
      alphaTest: 0.02,
      metallic: 0,
      roughness: 1,
    })
  }

  winnerConfettiTime += dt
  for (let index = 0; index < winnerHighlightConfetti.length; index++) {
    const piece = winnerHighlightConfetti[index]
    const color = winnerRank.confetti[index % winnerRank.confetti.length]
    TextShape.getMutable(piece.entity).textColor = Color4.create(color.r, color.g, color.b, 1)
    const progress = (piece.phase + winnerConfettiTime * piece.speed) % 1
    const transform = Transform.getMutable(piece.entity)
    transform.position = Vector3.create(
      piece.x + Math.sin(winnerConfettiTime * 1.8 + index) * piece.sway,
      8.2 - progress * 5.55,
      -0.82,
    )
    transform.rotation = Quaternion.fromEulerDegrees(0, 0, winnerConfettiTime * (35 + (index % 6) * 11) + index * 23)
  }
}

function updateCurrentDancePresentation(dt: number): void {
  const winnerCelebrationActive = gameState.winnerCelebrationTimer > 0

  if (gameState.phase !== lastDancePhase) {
    if (lastDancePhase === 'playing' && gameState.phase === 'gameover') {
      lastDanceEntries = getCurrentDanceEntries()
      currentDancePage = 0
      currentDancePageTimer = 0
    }
    if (gameState.phase === 'gameover' && gameState.playMode === 'solo') winnerHighlightTimer = WINNER_HIGHLIGHT_SECONDS
    if (gameState.phase === 'playing') {
      lastDanceEntries = []
      winnerHighlightTimer = 0
      currentDancePage = 0
      currentDancePageTimer = 0
    }
    lastDancePhase = gameState.phase
  }
  if (winnerCelebrationActive && !winnerCelebrationWasActive) winnerHighlightTimer = WINNER_HIGHLIGHT_SECONDS
  winnerCelebrationWasActive = winnerCelebrationActive

  if (gameState.phase === 'gameover') {
    const finalRows = getCurrentDanceEntries()
    if (finalRows.length > 0) lastDanceEntries = finalRows
  }

  if (winnerHighlightTimer > 0) winnerHighlightTimer = Math.max(0, winnerHighlightTimer - dt)
  updateCurrentDancePagination(dt)

  const showWinnerHighlight = gameState.phase === 'gameover' && winnerHighlightTimer > 0
  setEntityGroupVisible(currentDanceEntities, !showWinnerHighlight)
  setEntityGroupVisible(winnerHighlightEntities, showWinnerHighlight)

  if (currentDanceTitleEntity) {
    const nextTitleSource = gameState.phase === 'playing'
      ? 'assets/images/ui/levels/current-game.png'
      : 'assets/images/ui/levels/last-game.png'
    if (nextTitleSource !== currentDanceTitleSource) {
      setLeaderboardTitleImage(currentDanceTitleEntity, nextTitleSource)
      currentDanceTitleSource = nextTitleSource
    }
    // Last Game sits 5% of the title height higher than Current Game.
    Transform.getMutable(currentDanceTitleEntity).position.y = gameState.phase === 'playing' ? 7.50 : 7.61
  }

  if (showWinnerHighlight) updateWinnerHighlight(dt)
}

// ──────────────────────────────────────────────────────────
// 4. Overhead lighting truss
// ──────────────────────────────────────────────────────────
function buildTruss(): void {
  // Two parallel truss beams running front-to-back
  for (const tx of [CX - 6, CX + 6]) {
    const beam = engine.addEntity()
    box(beam, tx, 9.6, CZ, 0.22, 0.22, 20)
    pbr(beam, Color4.create(0.2, 0.2, 0.2, 1), Color3.create(0.1, 0.1, 0.1), 0.2, 0.8, 0.3)

    // Hanging spot-light cones along each beam
    const spotPositions = [10, 14, 18, 22]
    const spotColors: Color3[] = [
      Color3.create(1.0, 0.3, 0.6),
      Color3.create(0.3, 0.6, 1.0),
      Color3.create(0.5, 1.0, 0.3),
      Color3.create(1.0, 0.8, 0.2),
    ]

    spotPositions.forEach((sz, i) => {
      // Light housing
      const housing = engine.addEntity()
      box(housing, tx, 9.3, sz, 0.4, 0.4, 0.4)
      pbr(housing, Color4.create(0.1, 0.1, 0.1, 1), Color3.create(0.05, 0.05, 0.05), 0.1, 0.8, 0.4)

      // Glowing lens
      const lens = engine.addEntity()
      box(lens, tx, 9.0, sz, 0.3, 0.12, 0.3)
      const sc = spotColors[i]
      pbr(lens,
        Color4.create(sc.r, sc.g, sc.b, 1),
        sc,
        3.5, 0.0, 1.0,
      )
    })
  }

  // Cross beam left-right at front and back
  for (const tz of [10, 22]) {
    const cross = engine.addEntity()
    box(cross, CX, 9.6, tz, 20, 0.22, 0.22)
    pbr(cross, Color4.create(0.2, 0.2, 0.2, 1), Color3.create(0.1, 0.1, 0.1), 0.2, 0.8, 0.3)
  }
}

// ──────────────────────────────────────────────────────────
// 5. Speaker towers — wider apart on the larger stage
// ──────────────────────────────────────────────────────────
function buildSpeakers(): void {
  const configs: [number, number][] = [
    [4.5,  5.5],   // left front
    [27.5, 5.5],   // right front
    [4.5,  26.5],  // left back
    [27.5, 26.5],  // right back
  ]

  for (const [px, pz] of configs) {
    const faceDir = pz > CZ ? -1 : 1

    // Cabinet
    const cab = engine.addEntity()
    box(cab, px, 2.0, pz, 1.6, 4.0, 1.4)
    pbr(cab, Color4.create(0.05, 0.05, 0.05, 1), Color3.create(0.02, 0.02, 0.02), 0.1, 0.3, 0.8)

    // Woofer
    const woof = engine.addEntity()
    Transform.create(woof, {
      position: Vector3.create(sceneX(px), 2.0, sceneZ(pz + faceDir * 0.72)),
      scale:    Vector3.create(1.15, 1.15, 0.18),
    })
    MeshRenderer.setSphere(woof)
    pbr(woof, Color4.create(0.12, 0.12, 0.12, 1), Color3.create(0.06, 0.06, 0.06), 0.1, 0.6, 0.6)

    // Tweeter glow
    const twt = engine.addEntity()
    Transform.create(twt, {
      position: Vector3.create(sceneX(px), 3.5, sceneZ(pz + faceDir * 0.73)),
      scale:    Vector3.create(0.28, 0.28, 0.1),
    })
    MeshRenderer.setSphere(twt)
    pbr(twt, Color4.create(1, 0.6, 0.1, 1), Color3.create(1, 0.6, 0.1), 2.0, 0.8, 0.2)
  }
}

// ──────────────────────────────────────────────────────────
// 6. Disco balls — main + two flanking
// ──────────────────────────────────────────────────────────
function buildDiscoBalls(): void {
  const configs: [number, number, number, number][] = [
    [CX, 8.5, CZ, 1.65],
  ]

  for (const [x, y, z, r] of configs) {
    const ball = engine.addEntity()
    Transform.create(ball, {
      position: Vector3.create(sceneX(x), y, sceneZ(z)),
      scale:    Vector3.create(r, r, r),
    })
    MeshRenderer.setSphere(ball)
    pbr(ball,
      Color4.create(0.92, 0.92, 0.96, 1),
      Color3.create(0.5, 0.5, 0.55),
      0.7, 1.0, 0.0,
    )
    discoBalls.push(ball)

    // Hanging rod
    const rod = engine.addEntity()
    box(rod, x, y + r * 0.5 + 0.5, z, 0.07, 1.0, 0.07)
    pbr(rod, Color4.create(0.35, 0.35, 0.35, 1), Color3.create(0.12, 0.12, 0.12), 0.1, 0.9, 0.2)
  }
}

// ──────────────────────────────────────────────────────────
// 7. Corner & perimeter light pillars
// ──────────────────────────────────────────────────────────
function buildPillars(): void {
  // 8 pillars around the dance floor
  const positions: [number, number][] = [
    [FLOOR_OX - 1, FLOOR_OZ - 1],
    [FLOOR_OX + FLOOR_TILE + 1, FLOOR_OZ - 1],
    [FLOOR_OX - 1, CZ],
    [FLOOR_OX + FLOOR_TILE + 1, CZ],
    [FLOOR_OX - 1, FLOOR_OZ + FLOOR_TILE + 1],
    [FLOOR_OX + FLOOR_TILE + 1, FLOOR_OZ + FLOOR_TILE + 1],
  ]

  const pillarColors: Color3[] = [
    Color3.create(1.0, 0.2, 0.5),
    Color3.create(0.2, 0.5, 1.0),
    Color3.create(0.5, 1.0, 0.2),
    Color3.create(1.0, 0.8, 0.1),
    Color3.create(0.8, 0.2, 1.0),
    Color3.create(0.2, 1.0, 0.8),
    Color3.create(1.0, 0.5, 0.1),
    Color3.create(0.4, 0.9, 1.0),
  ]

  positions.forEach(([px, pz], i) => {
    // Shaft
    const shaft = engine.addEntity()
    box(shaft, px, 5.0, pz, 0.28, 10, 0.28)
    const c = pillarColors[i]
    pbr(shaft,
      Color4.create(c.r * 0.12, c.g * 0.12, c.b * 0.12, 1),
      c,
      1.8, 0.2, 0.8,
    )

    // Top cap glow
    const cap = engine.addEntity()
    box(cap, px, 10.1, pz, 0.5, 0.5, 0.5)
    pbr(cap,
      Color4.create(c.r, c.g, c.b, 1),
      c,
      4.0, 0.0, 1.0,
    )
  })
}

// ──────────────────────────────────────────────────────────
// 8. Audience bleachers (3 sides around the dance floor)
// ──────────────────────────────────────────────────────────
function buildBleachers(): void {
  // Each bleacher is a stepped set of raised platforms
  // Left side: x = 3–7, z = 7–25
  // Right side: x = 25–29, z = 7–25
  // Back (player-side): x = 7–25, z = 25–30

  const bleacherSections: {
    x: number; y: number; z: number
    sx: number; sy: number; sz: number
  }[] = [
    // Left bleachers (3 steps)
    { x: 5.0, y: 0.4, z: CZ, sx: 1.8, sy: 0.8,  sz: 16 },
    { x: 4.0, y: 1.1, z: CZ, sx: 1.6, sy: 0.8,  sz: 16 },
    { x: 3.0, y: 1.9, z: CZ, sx: 1.6, sy: 0.8,  sz: 16 },
    // Right bleachers
    { x: 27.0, y: 0.4, z: CZ, sx: 1.8, sy: 0.8, sz: 16 },
    { x: 28.0, y: 1.1, z: CZ, sx: 1.6, sy: 0.8, sz: 16 },
    { x: 29.0, y: 1.9, z: CZ, sx: 1.6, sy: 0.8, sz: 16 },
    // Back bleachers
    { x: CX, y: 0.4, z: 26.5, sx: 20, sy: 0.8,  sz: 2.0 },
    { x: CX, y: 1.1, z: 28.0, sx: 20, sy: 0.8,  sz: 2.0 },
    { x: CX, y: 1.9, z: 29.5, sx: 20, sy: 0.8,  sz: 2.0 },
  ]

  for (const s of bleacherSections) {
    const e = engine.addEntity()
    box(e, s.x, s.y, s.z, s.sx, s.sy, s.sz)
    pbr(e,
      Color4.create(0.08, 0.06, 0.16, 1),
      Color3.create(0.04, 0.03, 0.10),
      0.2, 0.6, 0.5,
    )
  }

}

// ──────────────────────────────────────────────────────────
// 9. Floor beat-flash
// ──────────────────────────────────────────────────────────
function triggerBeatFlash(): void {
  const count = 12 + Math.floor(Math.random() * 8)
  const shuffled = [...tiles].sort(() => Math.random() - 0.5).slice(0, count)

  for (const tile of shuffled) {
    const fc = FLASH_POOL[Math.floor(Math.random() * FLASH_POOL.length)]
    setTileFlash(tile, fc, 0.45)
  }
}

function setTileFlash(tile: Tile, flashColor: Color4, duration: number, intensity = 5.0): void {
  const existing = activeFlashes.find(f => f.entity === tile.entity)
  if (existing) {
    existing.flashColor = flashColor
    existing.timer = Math.max(existing.timer, duration)
    existing.duration = Math.max(existing.duration, duration)
    existing.intensity = Math.max(existing.intensity, intensity)
    return
  }

  activeFlashes.push({ entity: tile.entity, baseColor: tile.baseColor, flashColor, timer: duration, duration, intensity })
}

function triggerReactiveFloor(dt: number): void {
  if (gameState.phase === 'playing') return

  reactiveFloorTimer -= dt
  if (reactiveFloorTimer > 0) return

  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player) return

  const px = player.position.x
  const pz = player.position.z
  const insideFloor =
    px >= sceneX(FLOOR_OX) &&
    px <= sceneX(FLOOR_OX + FLOOR_TILE) &&
    pz >= sceneZ(FLOOR_OZ) &&
    pz <= sceneZ(FLOOR_OZ + FLOOR_TILE)

  if (!insideFloor) {
    lastReactiveX = Number.NaN
    lastReactiveZ = Number.NaN
    return
  }

  const movedEnough =
    Number.isNaN(lastReactiveX) ||
    Math.hypot(px - lastReactiveX, pz - lastReactiveZ) >= REACTIVE_FLOOR_MOVE_DISTANCE

  if (!movedEnough) return

  reactiveFloorTimer = REACTIVE_FLOOR_INTERVAL
  lastReactiveX = px
  lastReactiveZ = pz

  for (const tile of tiles) {
    const dx = tile.x - px
    const dz = tile.z - pz
    const dist = Math.hypot(dx, dz)
    if (dist > REACTIVE_FLOOR_RADIUS) continue

    const strength = Math.max(0, 1 - dist / REACTIVE_FLOOR_RADIUS)
    const palette = FLASH_POOL[(Math.floor(tile.x * 3 + tile.z * 5 + Date.now() / 180) % FLASH_POOL.length)]
    const blend = 0.08 + strength * 0.13
    const glow = Color4.create(
      tile.baseColor.r + (palette.r - tile.baseColor.r) * blend,
      tile.baseColor.g + (palette.g - tile.baseColor.g) * blend,
      tile.baseColor.b + (palette.b - tile.baseColor.b) * blend,
      1,
    )
    setTileFlash(tile, glow, 0.46 + strength * 0.24, 0.95)
  }
}

// ──────────────────────────────────────────────────────────
// Visual update system (runs every frame)
// ──────────────────────────────────────────────────────────
let lastBeatProcessed = -1

function danceFloorSystem(dt: number): void {
  updateCurrentDancePresentation(dt)
  updatePlayerJudgmentTexts()
  updateAvatarRanks()

  leaderboardTimer += dt
  if (leaderboardTimer >= 1.0) {
    leaderboardTimer = 0
    updatePhysicalLeaderboard()
    updateGlobalRecordsLeaderboard()
  }

  // Beat flash on new beat
  if (gameState.phase === 'playing' && gameState.currentBeat !== lastBeatProcessed) {
    lastBeatProcessed = gameState.currentBeat
    triggerBeatFlash()
  }

  triggerReactiveFloor(dt)

  // Decay tile flashes
  for (let i = activeFlashes.length - 1; i >= 0; i--) {
    const f = activeFlashes[i]
    f.timer -= dt
    if (f.timer <= 0) {
      Material.setPbrMaterial(f.entity, {
        albedoColor:      f.baseColor,
        emissiveColor:    Color3.create(f.baseColor.r * 0.4, f.baseColor.g * 0.4, f.baseColor.b * 0.4),
        emissiveIntensity: 0.3,
        metallic:  0.85,
        roughness: 0.15,
      })
      activeFlashes.splice(i, 1)
    } else {
      const p = f.timer / f.duration
      const blended = Color4.create(
        f.baseColor.r + (f.flashColor.r - f.baseColor.r) * p,
        f.baseColor.g + (f.flashColor.g - f.baseColor.g) * p,
        f.baseColor.b + (f.flashColor.b - f.baseColor.b) * p,
        1,
      )
      Material.setPbrMaterial(f.entity, {
        albedoColor:      blended,
        emissiveColor:    Color3.create(blended.r * p * 3, blended.g * p * 3, blended.b * p * 3),
        emissiveIntensity: p * f.intensity,
        metallic:  0.85,
        roughness: 0.12,
      })
    }
  }

  // Spin disco balls — each at a slightly different speed
  discoBallAngle += dt * 45
  if (discoBallAngle > 360) discoBallAngle -= 360

  discoBalls.forEach((ball, i) => {
    const speed = 1.0 + i * 0.35
    Transform.getMutable(ball).rotation =
      Quaternion.fromEulerDegrees(0, discoBallAngle * speed, 0)
  })
}

// ──────────────────────────────────────────────────────────
// Public initialiser
// ──────────────────────────────────────────────────────────
export function initDanceFloor(): void {
  buildFloor()
  buildPhysicalLeaderboard()
  buildWinnerHighlight()
  buildGlobalRecordsLeaderboard()
  updatePhysicalLeaderboard()
  updateGlobalRecordsLeaderboard()

  engine.addSystem(danceFloorSystem)
}
