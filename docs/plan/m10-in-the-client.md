# M10. In the client

## Purpose

To put the opponents in front of a player. Everything before this stage is measured by programs; this one is measured by a person at the board. It answers requirement R7 of [ai.md](../ai.md), and the last line of the evaluation protocol: before a model ships, play it.

A first, small version of this stage can be done as soon as M5 has a clone that plays, and is worth doing then: it shows whether the opponents are pleasant to play long before they are strong. The final version follows M9.

## Deliverables

| File | Contents |
| --- | --- |
| `src/sim/opponents.ts` | The list of opponents a player can choose: a name, a description, a level, the table sizes it plays, and how to build it. |
| `web/src/game/store.ts` | A seat's opponent is a choice, not a constant. Events are fed to each opponent. A failed model falls back. |
| `web/src/game/brain.ts` | Runs a learned opponent's network off the main thread. |
| `web/src/components/` | The choice on the setup screen. The "who is ahead" strip, if it is kept. |
| `web/src/i18n.tsx` | Names and descriptions in Chinese and English. |
| `assets/models/` | The shipped models, each with its record. |
| `docs/frontend.md` | How opponents are chosen, loaded and replaced. |
| `test/opponents.test.ts` | Tests. |

## Specification

### Opponents

```ts
export interface Opponent {
  id: string;                    // 'rules', 'school-reference', 'learned-main', ...
  level: 1 | 2 | 3 | 4;
  sizes: (2 | 3 | 4)[];
  name: Label;                   // { zh, en }
  describe: Label;
  /** May load a model. Resolves to an agent for one seat of one game. */
  create(size: 2 | 3 | 4): Promise<SeatAgent>;
}
export interface SeatAgent {
  choose(engine: Engine, state: GameState, actor: PlayerId, random: () => number): Action | null | Promise<Action | null>;
  observe(events: GameEvent[]): void;
}
```

What is offered, and from which stage it comes:

| Level | Opponent | From |
| --- | --- | --- |
| 1 | Today's rule-based agent | Exists |
| 2 | Named schools, as characters: the reference style, the pass baron, the blocker, the dealer, the composed schools, the Opportunist and other playbooks, and others that pass the person's check | M2 |
| 2 or 3, by its rating | The schools that play the table: the Statesman in both forms, Reference II, and those of the single-behaviour schools a player can tell apart | M3b |
| 3 | The best found style for the table size | M3 |
| 4 | The learned agent for the table size; the style learners as learned characters; the conductor | M7 to M9 |

Levels are assigned from the league report, not by hand: an opponent's level is the band its rating falls in, and the bands are drawn so that each level beats the one below as the one among copies by more than its interval. An opponent that does not fit a band is offered as a character without a level.

Only holders are offered. An opponent at level 3 or 4 is whatever holds its line of succession in `assets/lines.json` ([README.md](README.md#new-against-best)), so the client never carries a version that lost to the one before it.

### What an opponent is doing

A playbook and the conductor change plan during a game, and each can say what its plan is: the rules that are on, or the school in force. The client can show that as a word or two beside the seat ("building out", "refusing deals", "playing for passes"), in both languages. It makes an opponent's change of mind something a player sees happen, and it teaches the game. It also tells the table what that seat intends. It is built behind a setting, off by default, and the person's check decides whether it is offered and whether it is on for the easier levels.

For the schools of M3b the words name what the seat is doing about the table: "buying toward a group", "stopping the leader", "buying out a failing player", "dealing with the weaker seats". A refusal can carry its reason the same way ("will not sell to the leader"), which answers the question a player otherwise cannot: why was that offer turned down?

### Playing the table against a person

Opponents from M3b on treat a seat by its standing, and a person who plays well is often ahead. The author settled the two questions this raises on 18 November 2026.

1. **How hard computer players work against a person who is ahead: as far as it helps them win, and no further.** There is no setting. An opponent weighs a deal with a person exactly as it weighs the same deal with a program of the same standing, and the level it works at is the one its own win share set (M3b, task 16a). No opponent is ever told which seat is a person, and the store passes agents nothing that would let them tell. A player who wants a gentler table chooses opponents that do not play this layer; the schools of M2 are still offered.
2. **No channel for speech.** An alliance is asked for and answered with offers (M3b, Signals). A computer seat that wants the player as a partner sends an invitation, an offer plainly in the player's favour while a third seat leads; a player who wants a computer seat as a partner does the same and is read by the same rule. The client adds nothing to say it with. What it must not do is hide it: an offer from a computer seat is shown in full, and the word or two beside a seat, when that setting is on, may say "seeking a partner".

One thing is a setting, because it is about patience and not about strength:

| Setting | Values | Default |
| --- | --- | --- |
| `maxAsks`, for a computer seat | The most offers it makes in one turn, to any seats, counting repeats of a refused ask. An invitation counts. | 5 (the author's choice of 20 November 2026; the first value, one offer to a seat in a round, was too few) |

**At a rival's debt.** The rules let any player offer for a debtor's property while the debt is open, and M3b's schools do. The store asks computer seats at that moment, as the simulator does, and a person is shown the same chance: while another seat's debt is open, the trade panel stays usable for offers to the debtor.

### In the store

- A computer seat holds an `Opponent` id. The default is level 1, so a game set up as before plays as before.
- `schedule()` asks the seat's agent instead of calling `chooseHeuristicAction`. The agent's answer may be a promise; the wait of 850 ms before a computer player acts starts when it is asked and covers the model's work.
- After every applied action the store passes the events to every seat's agent.
- If an agent throws, returns nothing while the engine awaits its seat, or returns an action the engine refuses, the store plays the rule-based agent's choice, marks the seat as fallen back, and reports it once in the console. A game never stops because a model failed.
- A saved game stores each seat's opponent id and the model's version. A game saved with a model the build no longer carries reopens with that seat at the nearest level.

### Running a network

- A learned opponent's `create` imports its weight module on first use. The app build carries the weights inside its single script; the dev server serves them as a chunk.
- `web/src/game/brain.ts` runs the forward pass in a web worker when workers are available, and on the main thread otherwise. A page opened from `file://` may refuse to start a worker from its own script; the store tries once and settles on the main thread. On the main thread a decision is one call of about a million multiply-adds, which M5 measures.
- The model's record states its layout and action versions. `create` refuses a model whose versions differ from the encoder's and falls back.
- Size budget: each shipped model adds about 3 MB to the app's script. With one model for each size and three learned characters that is under 20 MB; the app is checked to open in under two seconds from Launchpad.

### Who is ahead

The valuation gives each seat's chance of winning at any moment. A thin strip under the roster can show it. Whether it should is a question of play, not of engineering: it tells a player who to gang up on and takes away the pleasure of judging the table. It is built behind a setting, off by default, and the person's check decides whether it is offered at all.

### The person's check

For every opponent put forward, at each table size it plays, a person plays at least three full games and fills in a short record kept beside the model:

| Question | Answer |
| --- | --- |
| Did it ever do something that looked broken: an offer that made no sense, a turn that would not end, a building sold and bought back? | Each case, with the saved game. |
| Did it stall? | The longest wait for one of its decisions; the length of the games. |
| Were its offers reasonable to receive: not insulting, not endless? | Offers received per game; how many were worth considering. |
| When it asked again for the same property, did that read as bargaining or as nagging? | The most asks for one property in a game; in a sentence. |
| When you were ahead, did the computer players work against you? Did it feel like play or like three against one? | In a sentence. |
| When a computer seat sent you an invitation, did you take it for one? | Invitations received; how many you read as such at the time, before looking at the record. |
| When you offered a computer seat a favourable deal against the leader, did it answer in kind? | Invitations sent; agreements that followed. |
| At a rival's debt, did the offers made to the debtor make sense, and did you get your own chance to offer? | In a sentence. |
| Could you tell why an offer of yours was refused? | In a sentence. |
| Could it be told apart from the level below? From the other characters? | In a sentence. |
| Was it fun to play against? Would losing to it feel fair? | In a sentence. |
| Did its strength match its level? | Wins and losses, for what three games are worth. |

An opponent with an entry under the first question does not ship until the case is understood. Strength alone never ships an opponent: one that wins by refusing every deal and waiting is strong and poor company, and the plan's open question on what "strong" should mean is answered here, by what is offered and what is left out.

## Tasks

**First version, after M5.**

1. **`src/sim/opponents.ts`** with the rule-based agent and the named schools. *Check:* each plays 200 games at each of its sizes through the `SeatAgent` interface with no refused action.
2. **The store:** opponent ids, events to agents, promises, the fallback. *Check:* the tests under Tests; a game with every seat at the default plays exactly as before on the same random draws.
3. **The setup screen:** one choice for each computer seat, with the name and one line of description, in both languages. *Check:* at the 1512 by 945 window the desktop app opens in, the setup screen needs no scrolling with four seats.
4. **A cloned model as a development opponent,** through `brain.ts`. *Check:* a full game in the dev server and in the installed app; the fallback fires when the weight module is removed.
5. **The person's check** on the schools. Drop or retune the ones that fail it. *Check:* a filled record for every school offered, with nothing open under the first question.
5a. **Playing the table in the client,** once M3b's schools exist: `maxAsks`; the debt window for computer seats and for the player; invitations shown as the offers they are. *Check:* no computer seat makes more than `maxAsks` offers in a turn (first written as: with `maxAsks: 1` no seat receives two offers from one computer seat in a round); a test confirms that an agent's inputs are the same whether a seat is marked as a person or not; with a seat in a debt it cannot pay, a computer seat's offer to the debtor arrives before the debtor acts, and the player can send one.
5b. **The person's check on the schools of M3b.** *Check:* a filled record for each, with the five questions on table politics answered, and the count of invitations the person read as invitations.

**Final version, after M9.**

6. **Levels from the league report.** *Check:* gate 2: each level beats the one below.
7. **The learned agents and the learned characters,** with their records. *Check:* the parity and version tests pass for each; each record names its line of succession and the match it won.
8. **The strip,** behind its setting. *Check:* the strip is off by default; switched on, its figures add up to 100% at every moment of a recorded game.
9. **Saved games** across versions. *Check:* the saved-games test.
10. **The person's check** on every learned opponent. *Check:* a filled record for every learned opponent offered, with nothing open under the first question.
11. **The app:** `npm run app:install`; size and opening time recorded. *Check:* the app opens and plays a full game with a learned opponent in every computer seat; its size and its opening time are recorded.
12. **Write up:** `docs/frontend.md`, the README, and the baselines table of ai.md with what shipped. *Check:* every figure quoted in the documents can be found in a report under the data directory, the Result section names the command, seeds and commit, and the link check passes.

## Tests

- Every opponent, through the interface, at each of its sizes: no refused action over 200 games.
- **Fallback:** an agent that throws, one that returns nothing, and one that returns an illegal action each lead to the rule-based choice and a game that continues.
- **Versions:** a model with another layout version is refused.
- **Events:** every agent at the table receives every event exactly once, in order.
- **Saved games:** a game saved with an opponent the build lacks reopens and plays.
- **No change by default:** with every seat at level 1, a game on fixed random draws matches a recording made before this stage.

## Experiments and cost

| Run | Cost |
| --- | --- |
| The levels: the league report restricted to the opponents offered | From M3's figures; under an hour on eight processes at 500 games a pair |
| The time for one decision of each learned opponent, on the main thread and in a worker, in the app | Measured in the client |
| The person's check | Three games for each opponent at each of its sizes. A full four-player game against computer players takes a person well over half an hour. With ten opponents this is the long pole of the stage, and it is not skipped. |

## Commands

```sh
npm run dev                                    # the client, with the development switch for a cloned opponent
npm test                                       # includes test/opponents.test.ts
node scripts/league.ts --members offered --games 500 > $DATA_DIR/league/levels.md
npm run app:install                            # the desktop app, with the shipped models inside its script
```

## Gate

1. Every test passes, and a game with default seats is unchanged.
2. Each level beats the level below as the one among copies, at each table size, by more than its interval over 2,000 games on evaluation seeds.
3. Every opponent offered has a filled record from the person's check with nothing open under the first question.
4. A learned opponent's decision takes under 50 ms of the main thread's time, or runs in a worker.
5. The desktop app opens and plays a full game with a learned opponent in every computer seat.

## Decision points

- **A strong opponent is no fun.** It is offered at level 4 with an honest description, or not at all. A weaker one that plays like a person is preferred for the default hard level.
- **The levels do not separate** (level 3 does not beat level 2 clearly). Merge them. Three clear levels are better than four blurred ones.
- **Opponents that play the table feel like three against one.** By the author's decision they are not blunted: they go as far as wins. The remedy is in what is offered. Such opponents sit at the higher levels with an honest description, and the easier levels are filled from schools that do not play this layer.
- **A person does not read an invitation as one.** Make the signal plainer before adding anything: raise `giftEdge` for the client so that an invitation is unmistakably generous. If that fails, the conventions are described in the game's help, as a bridge player learns a convention from a card. Still no channel for speech.
- **Opponents that ask again are tiresome.** Lower `maxAsks` (the author set 5 a turn) and lengthen the schools' `probeGap` for the client; the asking that wins among programs need not be the asking a person sits through.
- **The characters cannot be told apart at the board.** Offer fewer. A character earns its place by being recognised in play, not by its descriptors.
- **A worker will not start from `file://`.** Stay on the main thread; the wait before a computer player acts already hides the work.
- **The app grows too large or slow to open.** Ship one learned agent for each size and no learned characters; the written schools cost nothing.

## Feeds back into

- [ai.md](../ai.md): the "Today" section, which then describes what a player can choose; the open question on what "strong" should mean.
- [frontend.md](../frontend.md) and the README.
- The league: an opponent that people enjoy and the agents beat easily is a reason to look at what the agents are being trained to do.

## Out of scope

- Opponents that learn from the person playing.
- Playing over a network.
- Explaining a move to the player, beyond the word or two beside a seat.
- Any channel for speech. Decided against: alliances are signalled with offers.

## Result

First version, tasks 1 to 4, built on 20 November 2026 without the disk; the record is in [log.md](log.md) under that date.

- Task 1: every opponent offered, at each of its sizes, in both games, 200 games each (46 combinations, 9,200 games): every action answered and accepted.
- Task 2: the store's tests pass, including the unchanged play of default seats.
- Task 3: the menu fits the 1512 by 945 window with four seats in both languages.
- Task 4: checked with an untrained network of the real size, in the dev server and in the from-disk build in headless Chrome, where the worker started. G1's model is not shipped yet: it is on the disk.

- Task 5a: `maxAsks` (five offers a turn, the author's setting), the debt window for computer seats and for a person, and offers shown in full; its three checks are met in `test/seats.test.ts`, and the window was played through in the client from a saved game.

Gate 4 holds through the worker; on the main thread a decision takes 3.3 ms at the median and up to 180 ms at worst. Tasks 5 and 5b, the person's checks, are open, and so is everything of the final version.
