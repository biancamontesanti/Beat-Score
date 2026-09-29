import { initDanceFloor } from './dancefloor'
import { initGame } from './game'
import { setupUI } from './ui'

/**
 * Scene entry point — called once by the Decentraland runtime.
 *
 * Boot order:
 *   1. Dance floor (3-D world — tiles, stage, lights)
 *   2. Game logic  (ECS system — note spawning, input, scoring)
 *   3. UI          (ReactEcs — HUD, lanes, overlays)
 */
export function main(): void {
  initDanceFloor()
  initGame()
  setupUI()
}
