# M4. The environment

## Purpose

To turn a game into a stream of decisions that a learner can be trained on, without a second copy of the rules. It answers requirement R6 of [ai.md](../ai.md) (training reaches the game only through `src/env/`) and prepares R4 (every reward signal a named, switchable term) and R7 (the same encoder runs in the browser).

The stage ends with a number: how many decisions a second the bridge to Python carries. Until that number exists, nothing later can be costed.

## Deliverables

| File | Contents |
| --- | --- |
| `src/env/ledger.ts` | Running counts of how each seat has behaved, built from events. |
| `src/env/observe.ts` | The observation encoder and its layout. |
| `src/env/actions.ts` | The action codec, the mask, and the drafting of offers. |
| `src/env/potentials.ts` | The potentials: the valuation and the milestone signals. |
| `src/env/env.ts` | `createEnv`: seats, stepping, truncation. |
| `src/env/index.ts` | What the client and the scripts import. |
| `scripts/env-server.ts` | Serves many environments over standard input and output. |
| `scripts/bench-env.ts` | Measures decisions a second, in process and through the server. |
| `train/envs.py` | The Python client: worker processes, batched stepping. |
| `train/bench_bridge.py` | Drives the server with random legal actions and reports the rate. |
| `train/requirements.txt` | Pinned versions. NumPy only at this stage. |
| `test/env/*.test.ts` | Tests. |

## Specification

### Decisions

The engine waits on one player or, in an auction, on several. The environment serves one decision at a time.

- **Order.** When several seats are awaited, they are asked in the order of play, starting after the high bidder.
- **Forced moves.** When exactly one indexed action is legal, the environment applies it and does not ask. That removes the opening roll and every roll with nothing else to do.
- **No indexed action.** A seat in debt can be left with only the engine's whole-group sale of buildings (`SELL_BUILDINGS`), which has no index. The environment then applies what the rule-based agent's `raiseFunds` would. It is counted in `info`.
- **Seats played inside.** A seat that is a league member is played by that member inside the environment. A trainer sees only its own seats' decisions.
- **Offers out of turn.** The rules let any player propose a trade whenever no decision is open. The environment asks a seat only when the engine awaits it, so a seat proposes only on its own turn. Today's agent has the same limit.

### The observation

A flat vector of 985 numbers, written from the point of view of the seat that decides. "Me" is relative seat 0, and the others follow in the order of play. Amounts are divided by the starting cash (1,500) unless a divisor is given.

| Block | For each | Contents | Numbers |
| --- | --- | --- | ---: |
| Seats | 4 relative seats | present; out; is the turn player; cash; position, one-hot over 40; in jail; jail rolls over 3; jail cards over 2; chance of winning by the valuation | 4 × 48 = 192 |
| Standing | 4 relative seats | the twenty measures of `MEASURES`, each as the seat's share of the table's total | 4 × 20 = 80 |
| Habits | 4 relative seats | twelve rates from the ledger (below) | 4 × 12 = 48 |
| Properties | 28 properties | owner, one-hot over bank and four relative seats (5); mortgaged; level, one-hot over six; is the subject of the open decision; I would receive it; I would give it | 28 × 15 = 420 |
| Property facts | 28 properties | price over 400; landing rate times 20; rent at its present level over 2,000; my share of its set; the largest share one rival holds; it would complete a set for me; it would complete one for a rival | 28 × 7 = 196 |
| Table | once | see below | 47 |
| Risk | once | the largest rent or tax I could owe on my next roll; the amount expected | 2 |

The table block, 47 numbers: before or after the roll (2); doubles so far over 2; round over 100, capped at 1; farmsteads left over 32; fortresses left over 12; the kind of decision, one-hot over free turn, buy, property auction, building auction, debt, received mortgage, jail roll, offer (8); the building at auction is a fortress; the stage of my draft, one-hot over none, give, cash (3); the high bid; who is still bidding (4); who is the high bidder (4); the debt; the creditor, one-hot over bank and three rivals (4); cash I would receive and cash I would give under the offer or draft (2); the other party, one-hot over three rivals (3); table size, one-hot (3); players still in over 4; short game; my place in the order of play, one-hot (4); offers I may still make this turn over 2.

"I would receive it" and "I would give it" describe an offer made to me and my own draft alike; the kind of decision and the stage say which.

The layout is data: `OBS_LAYOUT` in `observe.ts` lists every block with its name, offset and length, and the encoder writes through it. The server sends it in its greeting, the Python side asserts it, and a test pins the total at 985. Changing the layout means a new version number, and a model records the version it was trained on.

What a seat may not know stays out: the order of the decks, `state.rng`, and `state.diceQueue`.

### The ledger

For each seat, from the game's events:

| Count | From |
| --- | --- |
| Bought at list price; declined | `PROPERTY_ACQUIRED` by purchase; `PROPERTY_OFFERED` followed by `AUCTION_STARTED` |
| Auctions bid in; auctions won; highest bid over list price | `BID_PLACED`, `AUCTION_ENDED` |
| Offers made; accepted as proposer | `TRADE_PROPOSED`, `TRADE_ACCEPTED` |
| Offers received; accepted as receiver | the same |
| Buildings bought; buildings sold | `BUILT`, `BUILDINGS_SOLD` |
| Mortgages taken | `MORTGAGED` |
| Own turns; cash at the start of each | `TURN_STARTED` |

The twelve numbers in the observation are these as rates: share bought of what it could buy; auctions bid in per auction held; share won of those bid in; highest bid multiple over 3; offers made per own turn; share of its offers accepted; offers received over 10; share of received offers accepted; buildings bought over 20; buildings sold over 10; mortgages taken over 10; mean cash at the start of its turns. A rate with nothing under it is 0.5 until there are three cases, so that a seat nobody has tested does not read as one that never trades.

`createLedger()`, `note(ledger, state, events)` and `ledgerOf(events)` are the whole interface. The client feeds it the same events.

### Actions

One choice among 188, masked to what is legal.

| Indices | Action | Count |
| --- | --- | ---: |
| 0 to 12 | `ROLL`, `END_TURN`, `PAY_BAIL`, `USE_JAIL_CARD`, `BUY`, `DECLINE`, `PASS`, `ACCEPT_TRADE`, `REJECT_TRADE`, `CANCEL_TRADE`, `DECLARE_BANKRUPTCY`, `SETTLE_TRANSFER` lifting the mortgage, `SETTLE_TRANSFER` keeping it | 13 |
| 13 to 34 | `BUILD` on street k | 22 |
| 35 to 56 | `SELL_BUILDING` on street k | 22 |
| 57 to 84 | `MORTGAGE` property k | 28 |
| 85 to 112 | `UNMORTGAGE` property k | 28 |
| 113 to 120 | `BID` at level 0 to 7 | 8 |
| 121 to 148 | Draft: ask for property k | 28 |
| 149 to 176 | Draft: give property k | 28 |
| 177 | Draft: give nothing | 1 |
| 178 to 186 | Draft: cash at level 0 to 8, which sends the offer | 9 |
| 187 | Draft: drop it | 1 |

Streets and properties are numbered in the order of `ctx.propertyOrder`.

**Bids.** The eight levels are: the minimum; the minimum plus 10; 50%, 75%, 100%, 125% and 150% of the list price; and all the bidder's cash. A level is legal when its amount lies between the engine's minimum and maximum and differs from every lower level's amount. In a building auction the percentages are of the building's cost, and the street is the one among the engine's `targets` where the next building adds most rent.

**Drafting an offer.** An offer is composed in three choices, of which only the last reaches the engine.

| Stage | Legal | Then |
| --- | --- | --- |
| None, on a free turn where the engine lists `PROPOSE_TRADE` and the seat has offers left this turn | Ask for a property that one of the listed partners owns, and that this seat has not been refused this turn | Give |
| Give | Give one of its own properties whose group has no buildings, or nothing; or drop | Cash |
| Cash | Each of the nine levels for which the engine's `validate` accepts the finished offer; or drop | The offer is sent; the partner is asked |

The nine cash levels are the cash that passes from the proposer to the partner, as a multiple of the list price of the property asked for: −1, −0.5, 0, 0.5, 1, 1.5, 2, 3, and all the proposer's cash above the largest rent it could owe on its next roll. A negative level asks the partner to pay.

A draft step does not touch the game; the same seat is asked again with the stage and the draft in its observation. A seat may send two offers on a turn of its own (`maxProposals`). Version 2 asks for exactly one property in every offer and gives at most one; selling a property for cash and multi-property deals are left to M9.

**While drafting is off.** The draft actions are masked. If the configuration names a `proposer`, that league member is asked, on the learner's turn after its roll, whether it would propose for this seat, and what it proposes is sent. Finding S6 is why: a seat that never proposes wins 5.9% of four-player games.

### Potentials and results

The environment does not compute rewards. It reports what rewards are made from, and the trainer combines them, so that a weight or the discount can change without touching the environment.

- **`phi`.** At every decision of a seat, the value of each configured potential for that seat. The trainer forms `γ · phi(next) − phi(now)` between two decisions of the same seat, with `phi` taken as 0 at the end of the game.
- **`result`.** At the end, for each seat: 1 for the winner and 0 for the rest, and the finishing place.

The potentials, each between 0 and 1:

| Name | Value for a seat |
| --- | --- |
| `value` | Its chance of winning by V1. |
| `groups` | Complete groups, each counted by its static return at three buildings, scaled so that the best three count as 1. |
| `built3` | The share of streets in its complete groups at three buildings or more. |
| `passes` | 0, 0.03, 0.13, 0.38, 1 for none to four. |
| `rentRoll` | Its share of the table's rent roll. |
| `reach` | Its share of the table's rent roll within reach. |
| `denial` | The share of groups in which a rival holds every street but one and the seat holds that one. |
| `safety` | 1 when its cash covers the largest rent it could owe on its next roll. |
| `funds` | Its share of the table's disposable funds. |
| `supply` | Its share of the buildings in play, while the bank holds fewer than eight farmsteads; else 0. |
| `solvency` | The share of its property, by list price, that is not mortgaged. |
| `eliminations` | Rivals it has bankrupted, over its rivals. |

Any measure of standing can be added as a potential with one line: the name, and whether it is taken as a share.

### Configuration

```ts
export interface EnvConfig {
  players: 2 | 3 | 4 | { 2: number; 3: number; 4: number };   // a size, or weights to draw one for each game
  rules: 'full' | 'short';
  learners: number | { min: number; max: number };            // seats exposed to the trainer
  opponents: { member: string; weight: number }[];            // league members for the other seats
  turnLimit: { 2: number; 3: number; 4: number };
  potentials: string[];
  drafting: boolean;
  proposer: string | null;
  maxProposals: number;
  seeds: { start: number; step: number };                     // game k of this environment uses start + k * step
  mode: 'play' | 'teach' | 'conduct';                         // 'play' unless a later stage says otherwise
}
```

Which places in the order of play the learners take follows from the seed's opening roll.

`teach` and `conduct` are added by the stages that need them and are named here so that the configuration has one shape. In `teach` (M5) a learner seat is driven by a named league member and each step reports the action that member took. In `conduct` (M8) the learner does not choose moves: at the start of each of its turns it chooses which school plays its seat for that turn, and a rule-based agent with that school's style makes the moves.

### One decision, worked through

Seat 2 in the order of play, with 640 coins, lands on Cao Cao, which the bank holds and which costs 180. Nothing else is open.

| Step | What happens |
| --- | --- |
| The engine | `pending` holds `{ kind: 'buy', player: 'p3', property: 'cao-cao' }`, and `awaiting` returns that player. |
| Legal actions | `BUY` and `DECLINE`, which are indices 4 and 5. Mortgaging, building and offering are not legal while a purchase is open. |
| Forced? | No: two indices are legal. The seat is asked. |
| The observation | In the seats block, relative seat 0 is this player: cash 640 / 1,500 = 0.427, position one-hot at square 16. In the properties block, Cao Cao's row has the owner one-hot on "bank" and "is the subject of the open decision" set. In its facts row, "would complete a set for me" is 0 and "my share of its set" is 0 or more. In the table block the kind of decision is "buy". |
| The potentials | `value` is this seat's chance by V1 before the purchase. |
| The step returned | `{ seat: 2, kind: 1, legal: [4, 5], ... }`. |
| The learner answers 4 | The environment applies `{ type: 'BUY', player: 'p3' }`. The engine moves 180 coins and the deed. |
| What follows | The same seat is awaited again for its free turn. If its only legal index is `END_TURN` or `ROLL`, that is applied without asking, and play runs on through the other seats until a learner seat has a real choice. The next step for seat 2 carries `value` after the purchase, and the trainer credits the difference to the decision to buy. |

### The environment

```ts
export interface Step {
  seat: number;                // relative to nothing: the index in the order of play
  kind: number;                // the kind of decision, as in the table block
  observation: Float32Array;   // 985
  legal: Uint8Array;           // 188
  phi: Float32Array;           // one for each configured potential
  done: boolean;
  truncated: boolean;
  final?: { result: number[]; places: number[]; turns: number; learners: number[] };
  info: { turn: number; round: number; forced: number; ruled: number };
}
export function createEnv(config: EnvConfig): { reset(): Step; step(action: number): Step };
```

**Truncation.** A game that reaches its turn limit ends with `truncated` set and no `result`. The trainer takes the value of each learner's last observation in place of a result. The limits to start from are 310, 360 and 410 turns in the full game and 320 in the four-player short game.

**The end of a game.** The step that ends a game carries `final`. It may come many turns after a learner's last decision; the trainer closes each learner's sequence with it. The next call to `step` returns the first decision of a new game.

### The server

`node scripts/env-server.ts` reads one JSON message a line and answers each with one line.

| Request | Reply |
| --- | --- |
| `{"op":"hello"}` | `{"version":2,"obs":985,"actions":188,"layout":[...],"kinds":[...],"potentials":[...],"members":[...]}` |
| `{"op":"make","count":64,"config":{...}}` | `{"ok":true}` |
| `{"op":"reset"}` | `{"steps":[...]}`, one for each environment |
| `{"op":"step","actions":[...]}` | `{"steps":[...]}` |
| `{"op":"close"}` | none; the process ends |

In a reply a step is `{"e":3,"seat":1,"kind":0,"obs":[...],"legal":[0,13,57],"phi":[...],"done":false}`, with `legal` as the list of legal indices. An illegal action in a request is an error that names the environment, the action and the legal list, and ends the process: an agent must never send one.

If JSON proves the slow part, the same messages are sent as a length-prefixed binary frame with the observations as raw 32-bit floats. The Python client hides the difference.

### The Python client

`train/envs.py`: `VecEnv(workers, envs_per_worker, config)` starts one server process for each worker, sends requests to all of them at once, and returns arrays: observations `[N, 985]`, masks `[N, 188]`, potentials, seats, kinds, done flags, and the list of finals. It checks the greeting's version and sizes against its own constants and refuses to start on a mismatch.

## Tasks

1. **Ledger.** *Check:* the ledger rebuilt from a game's whole event list equals the ledger kept while playing, over 300 games.
2. **Action codec and mask,** without drafting. *Check:* the mask tests under Tests.
3. **Bid levels.** *Check:* every legal level decodes to a bid the engine accepts; no two legal levels have the same amount.
4. **Observation encoder and `OBS_LAYOUT`.** *Check:* the total is 985; the hidden-information test; a hand-built position encodes to expected values for one block at a time.
5. **Potentials.** *Check:* each lies in 0 to 1 over 300 games; `value` equals `chances` from M1.
6. **`createEnv`:** seats, forced moves, the order of bidders, the ruled move, truncation, the end of a game. *Check:* the determinism test; a full game driven by the rule-based agent through the environment's own indices reaches the same final state as `simulateGame` on the same seed.
7. **Drafting.** *Check:* every sendable draft is accepted by the engine; a refused ask is masked for the rest of the turn; a third offer in one turn is masked.
8. **The proposer on a learner's behalf.** *Check:* with drafting off and `proposer: 'baseline'`, a learner seat that is fed the baseline's own choices wins an even share among baselines within its interval, and not the 5.9% of a seat that never proposes.
9. **`scripts/bench-env.ts`,** in process. Record decisions a second with random legal actions. *Check:* a figure for each table size, with and without the valuation in the observation, is written into this file.
10. **The server and `train/envs.py`.** *Check:* 10,000 games through Python with random legal actions end without an error, at each table size.
11. **`train/bench_bridge.py`.** Record decisions a second for 1, 2, 4 and 8 workers and for 16, 64 and 256 environments a worker. *Check:* the table of rates by workers and environments is written into this file, with the machine.
12. **If the rate is below the target,** apply the remedies under Decision points in order, measuring after each. *Check:* after each remedy the determinism, mask and hidden-information tests still pass, and the new rate is recorded beside the old.
13. **Write up.** *Check:* every figure quoted in the documents can be found in a report under the data directory, the Result section names the command, seeds and commit, and the link check passes.

## Tests

- **Mask.** Over 2,000 games at each table size with random legal play: an index is marked legal exactly when the engine lists the action it decodes to (for a bid, when its amount is within the listed range; for a draft step, as specified above).
- **Decode.** Every legal index decodes to an action that `engine.apply` accepts.
- **Hidden information.** Shuffling each deck's remaining cards, changing `state.rng` and replacing `state.diceQueue` leave the observation unchanged.
- **Seat rotation.** Renaming the players, and relabelling which is seat 0, changes the observation only through the rotation.
- **Determinism.** The same configuration, seed and actions give the same steps, bit for bit.
- **Potentials telescope.** For any sequence of legal actions that returns a seat to an equal position, the sum of `phi(next) − phi(now)` is zero; a build followed by a sale earns nothing from `built3` or `rentRoll`.
- **No stall.** A seat cannot take more than `maxProposals` draft sequences in a turn, and a turn always ends within a bounded number of its own decisions when it has no cash to act with.
- **Layout.** The offsets in `OBS_LAYOUT` are contiguous and sum to 985; the names are unique.

## Experiments and cost

| Run | What is measured |
| --- | --- |
| `bench-env.ts` | Decisions a second in process, by table size, with and without the valuation in the observation. The engine alone does about 34,000 actions a second; with one learner among three rule-based players about a quarter of those are the learner's. |
| `bench_bridge.py` | The same through the server, by number of workers and environments a worker. |

**Target.** 5,000 learner decisions a second in total on eight processes. At that rate 100 million decisions take five and a half hours. This is a planning figure, chosen so that a first reinforcement-learning run fits in a night; it is not a requirement of the method.

## Commands

```sh
node scripts/bench-env.ts --size 4 --games 200                 # decisions a second in process
node scripts/env-server.ts < requests.jsonl                    # the server, driven by hand
python train/bench_bridge.py --workers 8 --envs 64 --size 4    # the same through Python
```

## Gate

1. Every test above passes.
2. The bridge's rate is written into this file and into ai.md, with the machine it was measured on. Meeting the target is not part of the gate; knowing the number is.

## Decision points

When the rate is below the target, in order:

1. Send observations as binary frames.
2. Encode incrementally: the property facts and most of the seats block change only when ownership, level or cash changes.
3. Give the engine an in-place `apply` for the environment's use, which skips the clone of the state at every action, and check it against the cloning one over 10,000 games.
4. Compute legal actions without validating every candidate from scratch.
5. More environments a worker, so that each message carries more.

If the valuation dominates the encoder, cache `chances` for a state and reuse it for every seat's observation of that state.

## Feeds back into

- [ai.md](../ai.md): the bridge's rate in "Running experiments"; the observation and action tables of workstream D replaced by a pointer to this file; the open question on compute half answered.
- The cost columns of M5 to M9, which are guesses until now.

## Out of scope

- Any network or training.
- Offers that sell for cash or carry several properties.
- Running the environment in the browser. The encoder is written so that it can, and M10 uses it there.

## Result

Done on 18 November 2026, unattended; the details are in [log.md](log.md).

- **Tests.** `test/env/env.test.ts`, nine tests, pass in `npm test`; the mask test also passes over 100 games at each table size (`ENV_CHECK_GAMES=100`).
- **Rates,** four players, random legal actions for the learner, rule-based players elsewhere, measured on this machine (10 cores) while nine other processes were running:

| Path | Learner decisions a second |
| --- | ---: |
| In process, one core: two, three, four players | 2,794, 1,027, 855 |
| In process, four players, V1 left out of the observation | 1,020 |
| Through the server, one worker of 32 environments | 723 |
| Through the server, two workers of 32 | 1,285 |

The bridge costs about 15% over running in process. Eight workers on an idle machine should give roughly 5,800 to 6,800 a second; this is extrapolated, not measured.

- **Not done.** The test of a full game driven by the rule-based agent through the environment's own indices, and task 8's check that a learner seat fed the baseline's choices wins an even share: the baseline's bids and offer prices are drawn from ranges that the bid and cash levels do not contain, so the mapping is not exact. Binary frames and the other remedies were not needed.
- **Commit:** `cdcedc2`.
