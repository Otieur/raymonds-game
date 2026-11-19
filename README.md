# Three Kingdoms

A property-trading board game set at the fall of the Han dynasty. Players take the side of Wei, Shu, Wu or Qun, roll for the order of play, travel a 40-square board of warlords, passes and works, buy and build on what they land on, trade, and try to be the last one solvent.

The repository holds three things:

- a **rules engine** in TypeScript, with no dependencies and no build step;
- a **browser client** (React and Vite) that plays the game with people and computer opponents at one screen, and can be packed into a **desktop app** for macOS;
- **computer opponents**, rule-based today, with learned agents planned.

## Status

| Part | State |
| --- | --- |
| Rules engine | Complete for the rules in [docs/rules.md](docs/rules.md). 144 tests. |
| Board | One board, Three Kingdoms: 22 streets in 8 groups, 4 passes, 2 works, 2 card decks of 16. |
| Client | Playable from the opening roll to the final ranking. 2 to 4 players, each a person or the computer. Chinese and English. Background music. |
| Desktop app | `npm run app` builds a macOS app that opens the game in Google Chrome. |
| Computer opponents | A rule-based agent. Machine-learning and reinforcement-learning agents are planned in [docs/ai.md](docs/ai.md), on the evidence of a simulation study in [docs/statistics.md](docs/statistics.md). |
| Not built | Online play, sound effects, automated tests of the client, continuous integration. |

## Quick start

Node.js 22.18 or later is required: the engine and tests are TypeScript files that Node runs directly.

```bash
npm install
```

```bash
npm run dev
```

Then open `http://localhost:5173`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Serves the client with hot reload on port 5173. |
| `npm test` | Runs the engine tests with Node's test runner. |
| `npm run typecheck` | Type-checks the engine, the tests and the client. |
| `npm run build` | Builds the client into `dist/`, to be served by a web server. |
| `npm run app` | Builds the macOS app in `build/`. It carries the game and opens it in Google Chrome. Its name is *The Romance of Three Kingdoms: Tycoon*. |
| `npm run app:install` | The same, and installs a copy in `/Applications`, where Launchpad and Spotlight find it. |
| `node scripts/benchmark.ts` | Plays games between the built-in agents and reports speed, length and win rates. |
| `node scripts/study.ts` | The simulation study: plays many thousands of games on every processor and reports where players land, what property earns, how games unfold and what winning goes with. |

## Layout

```text
src/                 Rules engine. Start at src/index.ts.
  types.ts           Boards, rules, state, actions and events.
  rules.ts           Default rules and the short-game variant.
  engine/            One file per part of the rules.
  boards/            The Three Kingdoms board and its names, colors and art paths.
  sim/               Agents (random, rule-based) and the game simulator.
test/                Engine tests, on a small fixture board and on the real one.
web/                 Browser client.
  src/game/          The store that drives a game, the event wording, the assets.
  src/components/    Screens and panels.
  src/theme.css      All styling.
assets/              Portraits for the streets, the four token drawings, the music, the app icon.
scripts/             benchmark.ts: engine speed, game length and agent win rates.
                     study.ts: the simulation study behind docs/statistics.md.
                     make-app.ts: assembles the macOS app.
tools/token-art/     The scripts that prepared the token drawings (not run by anything).
docs/                Documentation.
```

## Using the engine

The engine is a set of pure functions over a plain-JSON state. A game is a loop: ask who must act, ask what they may do, apply one action.

```ts
import { createEngine, threeKingdoms } from './src/index.ts';

const engine = createEngine(threeKingdoms);
let state = engine.newGame({ players: ['wei', 'shu', 'wu', 'qun'], seed: 7 });

while (state.winner === null) {
  const [actor] = engine.awaiting(state);
  const legal = engine.legalActions(state, actor);
  const result = engine.apply(state, pick(legal)); // pick: your own choice among the legal actions
  if (!result.ok) throw new Error(result.error.message);
  state = result.state; // result.events says what happened
}
```

Two legal actions are descriptions rather than ready-made actions: a bid lists the range of amounts, and a trade proposal lists the possible partners. [docs/engine.md](docs/engine.md) covers both.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/rules.md](docs/rules.md) | The game as implemented: the board, every rule, the short game, the rule options. |
| [docs/engine.md](docs/engine.md) | How the engine is built and how to call it: state, actions, events, determinism, adding a board, testing. |
| [docs/frontend.md](docs/frontend.md) | How the client is built: the store, playback and pacing, saving, languages, tokens, styling. |
| [docs/statistics.md](docs/statistics.md) | What several hundred thousand simulated games show about the board, the course of a game and what winning goes with. |
| [docs/ai.md](docs/ai.md) | The computer opponents today, measured baselines, and the plan for agents trained by machine learning and reinforcement learning. |
| [docs/plan/](docs/plan/README.md) | That plan stage by stage: files, formats, tasks, tests, experiments and their cost, and the figures that close each stage. |

## Artwork and music

The street portraits in `assets/three-kingdoms/portraits/` and the token drawings in `assets/three-kingdoms/tokens/` are third-party illustrations from the card game Sanguosha (三国杀). The background music in `assets/audio/bgm.m4a` is a third-party recording as well; its title tag names it as a theme from the same game. All of it is here for private development only and none of it is licensed for redistribution. Replace it or obtain a license before the repository or a build of the game, the desktop app included, is made public. [docs/frontend.md](docs/frontend.md) describes how each set was prepared.

The app icon in `assets/app/icon.png` was drawn for this project.

## License

No license has been chosen. The repository is private.
