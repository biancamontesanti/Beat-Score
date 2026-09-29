# Beat Score

Beat Score is a Decentraland SDK7 rhythm dance game built around quick arrow combos, tight timing, and score-chasing dance battles.

Players step onto a neon club floor, follow the displayed direction sequence, and hit the beat window at the right moment to earn judgments, build combos, climb ranks, and compete with other dancers.

## Game Overview

Beat Score combines dance-game combo input with a timing-based rhythm hit. Each measure gives the player a short direction sequence. The player enters the sequence first, then presses the beat hit input when the moving rhythm marker reaches the judgment zone.

The game runs on a 128 BPM track and plays through 23 measures, ending with a final move.

## Core Mechanics

- Direction combos: Enter the displayed arrows in order before the beat hit.
- Beat hit: Press Space on desktop, or Jump on mobile, when the marker reaches the highlighted judgment zone.
- Timing judgments: Hits are graded as PERFECT, GREAT, COOL, BAD, or MISS.
- Combo scoring: Strong timing and complete sequences increase score and max combo.
- Failed sequences: Pressing a wrong direction breaks the current sequence for that measure.
- Reactive dance floor: Floor tiles pulse and flash with the beat, player movement, and match state.

## Controls

Desktop:

- `A`: left
- `S`: down
- `W`: up
- `D`: right
- `Q` or `1`: up-left
- `E`: up-right
- `Space`: beat hit

Mobile:

- Use the on-screen Decentraland movement controls for direction input.
- Use Jump as the beat hit.

## Timing Windows

The rhythm marker moves across the timeline once per measure. The best hit is near the judgment center.

- PERFECT: within about 35 ms
- GREAT: within about 75 ms
- COOL: within about 120 ms
- BAD: within about 180 ms
- MISS: no valid hit, an incomplete combo, or a badly timed input

## Round Modes

Beat Score changes the feel of the combo rounds as the song progresses:

- Easy: standard one-measure rhythm flow.
- Middle: longer combo windows and a slightly higher score multiplier.
- Freestyle: longer sequences, higher scoring, and inverted red directions.
- Hard: longer patterns with a high score multiplier.
- Final Move: the last measure challenge before the run ends.

## Progression

Players earn rank points from strong performances and completed goals. Progress is saved locally in the browser.

Dance ranks include:

- Hit Apprentice: 0 RP
- Move Riser: 100 RP
- Club Star: 250 RP
- Step Legend: 500 RP
- Dance Royalty: 900 RP

Crossing a rank threshold celebrates the new rank in the center of the player's
screen and displays an animated badge above their avatar for 6 seconds, with a
smooth fade. Rank presence and promotions are synchronized through the scene
server, including snapshots for players joining later. Loading saved progress
does not replay a promotion.

The centered rank-up popup shows only the badge with a confetti burst. Local
promotions are queued before the results card, with slow entrances and exits
and a short pause between them. Results retain their full display time after
rank-up finishes. Both overlays fit portrait and landscape mobile canvases.
The supplied `public/sounds/rankup.mp3` is preloaded and plays once when each
queued local badge starts entering, rather than when the reward is first earned.
Solo result panels follow their content height, with heavy layered lettering.
Menu rank names use label textures; the desktop RP badge has no container fill
or border. UI leaderboard entries are enlarged and paginated to fit each canvas.

Rank labels remain visible in front of avatars, in the match lobby, and on the
UI and 3D leaderboards. The victory screen and physical winner display show the
winner's rank badge. Avatar rank visuals respect solo-mode isolation.

Each player receives three daily goals with randomized targets: one technique
challenge, one timing challenge, and one session goal. The selection varies by
player, day, and rank, and stays saved throughout the day.

The 14 goal types include completing reverse sequences, landing a Final Move,
building a 3x PERFECT combo, hitting exactly two COOL judgments, completing
freestyle/hard/long sequences, earning score, and finishing solo or multiplayer
songs. Counts and score accumulate across runs; PERFECT combos require
consecutive hits. Sequence goals require all arrows and a successful HIT, and
song goals require finishing the song. Daily goals refresh at midnight even if
the scene stays open, and each goal awards RP only once.

## Multiplayer

Beat Score includes a multiplayer dance-battle prototype using Decentraland message bus sync.

Players can:

- Queue for synchronized multiplayer matches.
- See other ready and active dancers.
- Compare live score, combo, rank points, wins, and match results.
- Watch active live matches from the audience.
- Celebrate the winner after a battle ends.

Multiplayer matches start on shared timed windows when enough players are ready.

## Project Structure

- `src/index.ts`: scene entry point.
- `src/game.ts`: rhythm logic, input, scoring, progression, multiplayer state, and camera flow.
- `src/beatmap.ts`: BPM, measure duration, and song length constants.
- `src/dancefloor.ts`: 3D club floor, reactive tiles, stage visuals, leaderboards, and winner displays.
- `src/ui.tsx`: ReactEcs HUD, menus, rhythm timeline, combo bar, score, goals, and multiplayer screens.
- `src/ranks.ts`: shared rank thresholds, badge/label assets, and promotion animation timing.
- `public/sounds/`: music and hit feedback sounds.
- `public/emotes/`: avatar animation assets.

## Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm start
```

Build:

```bash
npm run build
```

Deploy:

```bash
npm run deploy
```

## Repository

GitHub: [biancamontesanti/BeatScore](https://github.com/biancamontesanti/BeatScore)
