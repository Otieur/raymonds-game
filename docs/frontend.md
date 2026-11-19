# Client

The browser client lives in `web/`. It is React 19 and TypeScript, served and bundled by Vite 7, with no state library and one stylesheet. It imports the engine straight from `../src/index.ts`, so the rules in the browser are the rules the tests cover.

```bash
npm run dev
```

Vite serves `web/` on port 5173 (`vite.config.ts`). `npm run build` writes a static site to `dist/`, and `npm run app` packs the game into a [desktop app](#the-desktop-app).

## What a player sees

1. **The opening screen.** Each of the four factions (Wei, Shu, Wu, Qun) is set to a person, the computer, or out of the game; at least two must play. Each faction holds one of four tokens, changed by tapping it. The game is the full one or the short one. An unfinished game can be resumed.
2. **The opening roll.** Everyone throws for the order of play, and the roster is reseated in that order.
3. **The table.** The board on the left; on the right, a command panel for whoever must act, the roster, and a chronicle of events.
4. **The finale.** The winner's token and the final ranking.

## Files

| File | Responsibility |
| --- | --- |
| `web/index.html` | The page, and the web fonts. |
| `web/src/main.tsx` | Mounts the app. |
| `web/src/App.tsx` | Holds the language, the saved game and the game in progress. Shows the opening screen or the table. |
| `web/src/game/store.ts` | `GameStore`: runs one game, plays events back as animation, moves the computer players, saves. |
| `web/src/game/describe.ts` | Words each engine event as a line of the chronicle, in both languages. |
| `web/src/game/assets.ts` | Portraits, tokens, factions, and small helpers about squares. |
| `web/src/game/music.ts` | The background music and its on/off switch. |
| `web/src/i18n.tsx` | Every piece of interface text in Chinese and English, and the helpers that pick between them. |
| `web/src/components/Setup.tsx` | The opening screen. |
| `web/src/components/Game.tsx` | The table: top bar, board, side panels, dialogs, finale. |
| `web/src/components/Board.tsx` | The 40 squares, with ownership, buildings and tokens. |
| `web/src/components/Center.tsx` | The middle of the board: portrait in focus, dice, latest event, decks, the card just drawn. |
| `web/src/components/CommandPanel.tsx` | What the acting player can do, by kind of decision. |
| `web/src/components/Players.tsx` | The roster, and the chronicle. |
| `web/src/components/SquareModal.tsx` | A property's deed, with build, sell, mortgage and redeem. |
| `web/src/components/TradeModal.tsx` | Composing a trade offer. |
| `web/src/components/Token.tsx` | A player's token at any size. |
| `web/src/components/ui.tsx` | Buttons, money, dialogs, a cross-fading picture. |
| `web/src/components/Embers.tsx` | The drifting sparks behind everything. |
| `web/src/theme.css` | All styling. |

## How a game runs

`GameStore` is the only thing that touches the engine. Components read a snapshot and send actions.

```text
component ──dispatch(action)──▶ GameStore ──engine.apply──▶ { state, events }
                                    │
                                    ├─ plays the events one by one (dice, steps, cards, payments)
                                    ├─ then commits the new state to the snapshot
                                    ├─ saves
                                    └─ if a computer player must act, schedules its move
component ◀──snapshot (useSyncExternalStore)──┘
```

### The snapshot

`snap.state` is the last *settled* engine state. While events are being played, `state` stays where it was and a few mirrors move ahead of it:

| Field | Purpose |
| --- | --- |
| `state` | The settled engine state. Ownership, buildings, whose turn it is and the open decision are read from here. |
| `busy` | Events are being played. Input is ignored until they finish. |
| `positions`, `cash` | Where each token stands and what each player holds *as shown*, updated step by step during playback. |
| `seating` | The roster's order. Changes when the opening roll is decided. |
| `orderRolls` | Each player's latest opening throw, shown beside their name until the order is settled. |
| `dice`, `rolling` | The dice on the board. |
| `card` | The card being shown, if any. |
| `focus` | The street whose portrait fills the centre of the board and tints the table. |
| `spot` | The square being pointed out while something happens on it. |
| `log` | The last 250 events, for the chronicle. |
| `floats` | Recent cash changes, shown as numbers drifting off a player's row. |
| `thinking` | The computer player about to act. |
| `fast`, `error` | The speed switch, and the last refused action. |

Because `state` commits only after playback, a purchase shows its owner's frame, and a building shows on the board, at the end of the pause that announces it.

### Pacing

Every duration is in one table at the top of `store.ts`:

| Entry | ms | What it times |
| --- | ---: | --- |
| `think` | 850 | A computer player's pause before each action. |
| `tumble`, `settle` | 800, 550 | Dice in the air, then at rest. |
| `step`, `stride` | 240, 110 | One square of a walk; one square of a journey longer than 12 squares. |
| `arrive` | 650 | Standing on the new square. |
| `paid` | 480 | A payment. |
| `acquired`, `built` | 950, 850 | A deed changing hands; a building going up. |
| `bid`, `pass` | 650, 380 | Moves in an auction. |
| `cardAi`, `cardHuman` | 3200, 6000 | A drawn card on screen. A person can dismiss it early. |
| `bankrupt` | 1400 | A bankruptcy. |

Two multipliers apply. The **fast** switch in the top bar runs everything at 0.3 times these figures. A person's own confirmations (their purchase, their bid) are held for 0.35 times the figure, since they already know what they did; what a computer player does is held in full.

A computer player's ordinary turn takes 7 to 9 seconds at normal speed.

### Computer players

When the settled state is waiting on a seat marked as computer-played, `schedule()` waits `think` milliseconds and asks the rule-based agent for an action (`chooseHeuristicAction`). If the agent has no answer, `fallback()` picks a safe one (end the turn, pass, decline, reject). This is the one place to change when another agent is plugged in; see [ai.md](ai.md).

### Saving

After every action the store writes `{ config, state, log }` to `localStorage` under `three-kingdoms.save.v3`. On load, a save is offered for resuming only if:

- its board and state format match;
- every seat is a known faction with a known token, no token twice;
- `engine.checkInvariants` finds nothing wrong.

Saves under earlier keys are deleted. Bump the key whenever the shape of the seats or the state changes.

The language is kept under `three-kingdoms.lang`.

## Music

One track, `assets/audio/bgm.m4a` (5 minutes 56 seconds), looped by `web/src/game/music.ts`.

- **It starts at the first click or key press.** Browsers do not let a page make sound before the visitor has touched it, so there is no music until then.
- **It runs across screens.** The opening screen and the table share one player, so the music does not restart when a game begins.
- **It pauses while the page is hidden** and resumes when the page is shown again.
- **The switch** is the Music button in the top bar of both screens. The choice is kept under `three-kingdoms.music`.
- The loop is the browser's own (`loop` on an audio element). There can be a very short gap where the track wraps.

## Players, factions and tokens

- A player *is* a faction. Player ids are the faction ids `wei`, `shu`, `wu` and `qun`, and the faction's name is the player's name everywhere.
- A faction's color rings its token and frames what it owns.
- The token is separate: a player's pick among sword, crossbow, axe and halberd, stored on the seat. `Token.tsx` reads the picks from a React context, so any component can draw a player's token from the id alone.

`assets.ts` lists both (`FACTIONS`, `TOKENS`).

## Languages

Chinese is the default; the top bar switches to English.

- `i18n.tsx` holds two tables with the same keys. The Chinese table defines the keys, and the type checker requires the English table to match.
- `useTongue()` gives a component `t(key, values)` for interface text, plus helpers for names that come from the board: `square`, `group`, `deck`, `card`, `building`, `who` (a player), `token`, `reason` (why money moved) and `problem` (a refused action).
- Corner squares always show both the characters and the pinyin as written on the board: LuoYang, ChiBi, HanZhong, YiLing.

To add a piece of text: add the key to both tables, then call `t('key')`.

## Styling

Everything is in `web/src/theme.css`. The look is ink black, gold leaf and cinnabar, set inside the portraits the board shows.

- **Tokens of the design** are CSS variables at the top of the file: the ink, gold, cinnabar and paper colors, and three font stacks (brush for Chinese headings, a serif for text, an inscription face for Latin).
- **The board** is an 11 by 11 grid and a size container. Everything on it is sized in `cqw`, so the whole board scales as one piece.
- **Use `cqw`, not `cqi`.** Vertical text (`writing-mode: vertical-rl`) flips the inline axis, and `cqi` inside it resolves against the board's height.
- **Breakpoints:** below 1060 px the side panels move under the board; below 900 px the opening screen stacks; below 520 px small labels are dropped.
- **The opening screen is one screenful** beside the paintings (wider than 900 px). Its sizes follow the window's height, so it fits a full-screen laptop display as well as a small window; below about 780 px of height the column scrolls on its own, and the paintings and the switches stay put.
- **English** gets its own type through `:lang(en)` rules: Latin text never uses the brush face.
- **Motion** is cut to nothing under `prefers-reduced-motion`.

Fonts load from Google Fonts (Ma Shan Zheng, Noto Serif SC, Cinzel). Offline, the stacks fall back to the system's Kaiti and Songti.

## Artwork

Both sets are third-party illustrations from the card game Sanguosha (三国杀), used for private development. See the notice in the [README](../README.md#artwork-and-music).

### Portraits

`assets/three-kingdoms/portraits/<square id>.jpg`, one per street, 22 in all, each 750 by 950. `assets.ts` loads whatever is in the folder and keys it by file name, so a portrait is replaced by replacing the file.

### Tokens

`assets/three-kingdoms/tokens/<token id>.webp`, four images of 640 by 640 with transparency: the weapon alone, as dark ink, to be laid on the token's paper-colored face.

They were made from four equipment cards by the scripts in `tools/token-art/`:

1. Crop the drawing from the card.
2. Enlarge it four times with Real-ESRGAN. The two smallest sources (the halberd, 184 px wide, and the crossbow, 250 px) blend the general model with the line-art model.
3. Estimate the paper's color around the weapon and divide it out, so the parchment becomes white.
4. Keep whatever is darker than the paper as ink with transparency, and whatever is brighter, inside the weapon's outline, as white highlight.
5. Centre the result on a square and save it.

For the two small sources the fine texture is the model's reconstruction: outlines and shading follow the card, the smallest strokes do not exist in it. Larger scans would give a truer result.

The source cards and the model weights are not in the repository. `tools/token-art/README.md` says how to run the scripts.

## The desktop app

```bash
npm run app
```

This writes `build/The Romance of Three Kingdoms Tycoon.app`, a macOS app of about 11 MB. Double-clicking it opens the game in Google Chrome, in a window of its own without tabs or an address bar. The app can be moved anywhere: to Applications, to the Dock, to another Mac.

```bash
npm run app:install
```

This builds the app and also installs a copy in `/Applications`, which puts it in Launchpad and Spotlight. Run it again to refresh that copy. It replaces an app of the same name there only if that one is an earlier copy of this app, and it clears away copies left under the app's earlier name.

**The name.** Finder, Launchpad and the Dock show *The Romance of Three Kingdoms: Tycoon*. The file on disk has no colon, because Finder cannot show one in a file name; the colon comes from the app's localized display name. Rename the file and macOS shows the new file name instead. The names are two constants at the top of `scripts/make-app.ts`, and the window's title is the `<title>` in `web/index.html`.

**How it works.** The app carries a copy of the game and a launcher, and nothing else.

- The launcher (`Contents/MacOS/launcher`) is a shell script. It builds the `file://` address of the page inside the app, asks Chrome to open it as an app window, and exits. Nothing is served and nothing keeps running. Without Chrome on the machine, the page opens in the default browser.
- The game (`Contents/Resources/site/`) is a build made to run from disk, by `vite build --mode app`:
  - one classic script instead of modules, because browsers will not load module scripts for a `file://` page;
  - the stylesheet folded into that script;
  - every file in one folder and every address relative, so the page works from wherever the app is put.
- `scripts/make-app.ts` assembles the bundle: the game, `Info.plist`, the launcher, and the icon at every size macOS asks for, cut from `assets/app/icon.png`.

**Things to know.**

- The app holds a snapshot. After changing the game, run `npm run app` again, or `npm run app:install` if the copy in Applications is the one in use.
- Saved games live in the browser, per address. The app's saves are separate from those of the dev server.
- The fonts still load from Google Fonts. Offline, the game runs with the system's Kaiti and Songti.
- The app is not signed. On the Mac that built it, it opens normally. Copied to another Mac by download or message, macOS will ask for confirmation the first time.
- It only assembles on macOS (`sips` and `iconutil` do the icon).

## What has been checked

There are no automated tests of the client. The following were checked by hand in a browser, in both languages, at desktop and phone widths: the opening screen and token choice, the opening roll including ties, a save made mid-roll and resumed, moving, rent, buying, auctions against computer bidders, cards, deeds and selling a building, debt, the finale, and tokens on corners, on portraits, stacked, and in jail.

The opening screen was measured at window sizes from 1280 by 720 to 1920 by 1080, including a 14-inch MacBook's full screen (1512 by 945): the page never scrolls, and from 780 px of height upward the column does not either. The table was measured at the same sizes and never overflows.

The music was checked in the dev client: it starts at the first click, wraps at the end of the track, follows the switch, and stays silent on a fresh visit with the switch off. The from-disk build was checked in headless Chrome over `file://`: the page mounts with its styles, portraits and tokens. The app was launched once and macOS accepted it; the window Chrome then opened was not inspected by the tooling.

Not yet checked by hand:

- completing a trade from proposal to acceptance;
- the building-shortage auction panel;
- the choice after a third failed jail roll;
- settling a received mortgage;
- several people sharing the screen;
- the music inside the desktop app, by ear;
- tablet widths, since the tokens and the opening roll were added.

The engine actions behind all of these are covered by the engine tests.
