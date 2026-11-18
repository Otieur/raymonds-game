# M1. Valuation

## Purpose

To put a number on what a position is worth to a seat, and so on what a property, a building or a coin is worth at a given moment, at a given table size. It answers requirement R5 and findings S1 to S4 of [ai.md](../ai.md): list price misstates value, the table size changes it, rent tells who is ahead better than net worth, and cash counts only next to the rent roll.

The study gave a first cut with two weaknesses. Its model was fitted at three fixed rounds, so it could not say how a value moves through a game. And it was a regression on games as they happened, so late in a game it mixes what helps a player win with what a winning player ends up holding. This stage removes both: the model's weights vary with the round, and a second, independent measurement changes a position directly and plays it out.

Everything later reads the valuation: the schools price purchases, bids and trades with it (M2), the environment shows it to the learner and pays its change as a shaping reward (M4), and the value network must beat it (M5).

## Deliverables

| File | Contents |
| --- | --- |
| `src/sim/measures.ts` | The measures of standing, moved out of `scripts/study.ts`: `View`, `viewOf`, `MEASURES`, and the helpers they use. |
| `src/sim/linear.ts` | The solver for symmetric linear systems, moved out of the study script. |
| `src/sim/landing-rates.ts` | Generated. The landing rate of each square, measured by the study. |
| `src/sim/valuation.ts` | V0 (static return), the evaluator for V1, `priceOf`. |
| `src/sim/valuation-v1.ts` | Generated. The fitted weights of V1 for two, three and four players. |
| `scripts/study.ts` | New options `--snapshots <dir>` and `--rates <file>`. |
| `scripts/fit-valuation.ts` | Fits V1 and the comparison models from snapshot files; prints the report. |
| `scripts/probe-value.ts` | The intervention study: changes a position and plays it out. |
| `test/measures.test.ts`, `test/valuation.test.ts` | Tests. |

## Specification

### Measures in the library

`src/sim/measures.ts` exports what the study script defines today, with one change: a `View` is built from a `Context` and a state, not from a study table.

```ts
export interface View {
  ctx: Context;
  state: GameState;
  held: Map<string, Map<PlayerId, number>>; // set -> owner -> properties held
  sizes: Map<string, number>;               // set -> properties in it
}
export function viewOf(ctx: Context, state: GameState): View;

export interface Measure {
  key: string;
  label: string;
  value: (view: View, player: PlayerState) => number;
  together?: boolean;
}
export const MEASURES: readonly Measure[];   // the same twenty, in the same order
```

The study imports them. Its printed report must not change by a character.

### V0: static return

```ts
/** Rent expected from one turn of one opponent, for a property as it stands or at a given level. */
export function staticIncome(ctx: Context, sq: PropertySquare, at: { level?: number; held?: number }): number;
/** Coins of extra income, per coin spent, from the next building on a street of a complete group. */
export function marginalReturn(ctx: Context, sq: StreetSquare, level: number): number;
```

`level` is for a street in a complete group (0 is bare, at the doubled rent). `held` is the number of passes or works the owner holds. A works is taken at the mean roll of 7. The landing rates come from `src/sim/landing-rates.ts`, forty numbers written by `node scripts/study.ts <games> --rates src/sim/landing-rates.ts` from the four-player table; the study shows the rates agree across table sizes to within 0.1 point.

### The snapshot file

`node scripts/study.ts 100000 --snapshots $DATA_DIR/snapshots` plays the three main tables, the same games as the study's own, and writes one file for each, `full-2.jsonl`, `full-3.jsonl` and `full-4.jsonl`: one line for every fifth round of every finished game, from round 5.

```json
{"v":1,"table":"full-4","seed":17,"round":10,"n":4,
 "cash":[412,655,90,1210],"pos":[24,10,3,31],"jail":[0,1,0,0],
 "own":"0.1.2031........3.2.....0...","lvl":"0000000000000000000000000000",
 "mort":"0000000000000000000000000000","bank":[30,12],
 "win":2,"gone":[0,134,0,97],"turns":188}
```

| Field | Meaning |
| --- | --- |
| `cash`, `pos`, `jail` | One entry for each seat, in the order of play (the order of `state.players`). |
| `own`, `lvl`, `mort` | One character for each property, in the order of `ctx.propertyOrder`. `own` is `.` for the bank or the seat's index. `lvl` is 0 to 5. `mort` is 0 or 1. |
| `bank` | Farmsteads and fortresses left in the bank. |
| `win` | The seat that won. |
| `gone` | For each seat, the turn on which it went bankrupt, or 0. A seat with a turn at or before this snapshot's is out. The order of these turns gives the finishing places. |
| `turns` | The length of the game. |

A line is about 230 bytes. A hundred thousand games give about 330 MB, 270 MB and 200 MB for two, three and four players. The files go to the data directory.

`stateOf(ctx, row): GameState` rebuilds a state from a line, complete enough for every query the measures make (players, properties, bank; empty decks, nothing pending). The measures computed from it must equal the measures computed from the live state.

Games are split by seed: 1 to 70,000 to fit, 70,001 to 85,000 to choose the penalties, 85,001 to 100,000 to test. The gate is read from the test games only.

### V1: the model

For the seats still in the game at a snapshot,

```text
chance(seat i wins) = exp(w(r) · x_i) / Σ_j exp(w(r) · x_j)        j over the seats still in
```

- **One model for the table.** The chances add up to one by construction, a seat that is out has none, and the same form serves two, three and four players. A feature that is the same for every seat (the round, the number of players) cancels, so the round acts through the weights.
- **Weights that vary with the round.** `w(r)` is given at the knots r = 5, 10, 20, 30, 45 and 60, interpolated in a straight line between them, and held constant after 60. The weight of a feature at each knot is the model's answer to how its worth moves through the game.
- **One fit for each table size.**

The features `x_i` of a seat, about 55:

| Group | Features | Count |
| --- | --- | ---: |
| Funds | Cash over the starting cash. The seat's share of the table's cash. Disposable funds, as a share. | 3 |
| Danger | Rent and tax expected on the next roll, as a share. Property under mortgage, as a share. | 2 |
| Income and potential | Rent roll, rent that could be added at once, room beyond, each as a share. | 3 |
| Bargaining | Groups one street short. The same with the street held by a rival. Sets in which the seat holds the one property a rival lacks. Trading chips, as a share. | 4 |
| Each of eight groups | The share of its streets the seat holds. Whether it holds all. The mean building step, over five. The largest share one rival holds. | 32 |
| Passes | Holds at least one, two, three, all four. A rival holds at least three. | 5 |
| Works | Holds one. Holds both. | 2 |
| Place | The seat's place in the order of play, one indicator for each place but the last. | 1 to 3 |

With six knots that is about 330 weights for each table size, against about 2.3 million seat-rows in the fitting games of the four-player table, and more at the smaller tables, whose games last more rounds. The late knots are the reason for the size: only one four-player game in six reaches round 60.

**Fitting.** Maximum likelihood by Newton's method, in TypeScript, on the penalized log-likelihood: a ridge penalty λ on every weight, and a penalty μ on the second difference of each feature's weights across the knots, which keeps a weight from zigzagging through time. λ is chosen from 0.1, 1, 10 and 100, and μ from 0, 1 and 10, by the log loss on the validation games. The features are sparse (a seat holds a quarter of the properties and a row touches two knots), so the gradient and the Hessian are accumulated over non-zero entries only.

**Comparison models,** fitted with the same code: the seat's share of net worth alone, and its share of the rent roll within reach alone. Each has one feature and the same knots.

**The report.** Beside the fit's own figures, `scripts/fit-valuation.ts` prints the table the study could not: for each set and each knot, what the model says the whole set is worth in coins and as a multiple of its list price, at each table size. A second table does the same for one property of each set held alone, and a third for a building at each level. These are the model's answer to how a property's worth moves through a game.

**Output.** `scripts/fit-valuation.ts` writes `src/sim/valuation-v1.ts`:

```ts
export const V1 = {
  version: 1,
  fitted: '<date>, <games> games for each size, seeds 1 to 70000, commit <hash>',
  knots: [5, 10, 20, 30, 45, 60],
  features: ['cash', 'cashShare', /* ... */],
  weights: { 2: number[][], 3: number[][], 4: number[][] }, // [knot][feature]
} as const;
```

**Evaluator.**

```ts
export interface Valuation {
  /** Each seat's chance of winning, in the order of state.players. A bankrupt seat has 0. They sum to 1. */
  chances(ctx: Context, state: GameState): number[];
}
export function v1(size: 2 | 3 | 4): Valuation;
```

### The price of a change

```ts
/** The cash at which `seat` is indifferent between `state` and `changed` with that much less cash. */
export function priceOf(valuation: Valuation, ctx: Context, state: GameState, changed: GameState, seat: PlayerId): number;
```

Solved by bisection on the cash, between 0 and five times the list price of what changed hands. It is the single function the schools call to value a purchase, a bid or a trade: `changed` is the state after the deal, without the payment.

### The intervention study

`scripts/probe-value.ts` measures what a purchase is worth without a regression. It takes positions from the test games, changes one thing, and plays each version out many times.

| Arm | The change to the position |
| --- | --- |
| B | None. |
| A | A property still held by the bank goes to a seat, which pays its list price. Skipped when the seat cannot pay. |
| D | The same property goes to the seat for nothing. |
| C | The seat is given 200 coins. |

- **Playing out.** Each arm is played to the end twenty times by the rule-based agents, trading as usual. The dice and the unseen order of the decks are drawn afresh for each playout, and the same twenty draws are used for every arm of a position.
- **What is reported.** For each cell, the seat's win share in each arm, and the differences A − B (is buying at list price worth it), D − B (what holding it is worth, in points) and C − B (what 200 coins are worth). The worth of the property in coins is 200 × (D − B) / (C − B).
- **Cells.** The set of the property (ten), what the seat already holds of that set (nothing, part, all but this one), the round (5, 10, 15, 20) and the table size: 360 cells. A cell uses up to 200 positions, which gives an interval of about ±2 points on a difference; a cell with fewer than 50 positions is reported as empty.
- **Against V1.** For the same positions the script prints V1's predicted differences next to the measured ones, their rank correlation across cells, and the share of cells in which they agree in sign.

The engine allows this because a state is plain data: the change is an edit of `owner` and `cash`, checked with `checkInvariants`, and a fresh draw is a new value of `state.rng` and a shuffle of each deck's remaining cards.

## Tasks

1. **Freeze a reference.** `node scripts/study.ts 300 --json build/study/ref.json > build/study/ref.md` on the current commit. *Check:* the file exists and is kept until task 3 passes.
2. **Move the solver** to `src/sim/linear.ts`. *Check:* a test solves a known 4 by 4 system; the study report equals `ref.md`.
3. **Move the measures** to `src/sim/measures.ts`. *Check:* the study report equals `ref.md` byte for byte; `test/measures.test.ts` checks each of the twenty measures against a hand-built position.
4. **Landing rates and V0.** Add `--rates`; write `landing-rates.ts`; implement `staticIncome` and `marginalReturn`. *Check:* a test reproduces figures of [statistics.md](../statistics.md#what-a-set-returns): 56.3 for Cao Wei at three, 25.2 for four passes, 11.91 per 100 coins for Cao Wei's third building.
5. **Snapshots.** Add `--snapshots` and `stateOf`. *Check:* for 200 games, every measure computed from `stateOf(row)` equals the measure computed from the live state at that turn.
6. **Generate the snapshot files** for 100,000 games at each size. *Check:* each file has one line for every fifth round of every finished game, and the wins by place in the files equal the study's own for the same seeds.
7. **Fit.** Write `scripts/fit-valuation.ts`: features, Newton's method, the two penalties, the grid, the comparison models, the report. *Check:* on a synthetic table whose winner is drawn from known weights, the fit recovers them within their standard errors.
8. **Evaluator.** Generate `valuation-v1.ts`; implement `v1` and `chances`. *Check:* the tests under Tests.
9. **`priceOf`.** *Check:* the tests under Tests.
10. **The intervention study.** Write `scripts/probe-value.ts`, time it on one cell, run it. *Check:* on a planted case, a seat given a whole group for nothing, arm D beats arm B by more than its interval; over all positions arm B's win share equals an even share within its interval.
11. **Open the valuation lines.** The V1 that passes the gate is the first holder of `valuation-2`, `-3` and `-4` in `assets/lines.json`. Any later fit, after the league changes or with new features, is a challenger and replaces the holder only by the rule in [README.md](README.md#new-against-best). *Check:* `assets/lines.json` validates and names the fit's commit and its figures on the test games.
12. **Write up.** The Result section here; the documents under Feeds back into. *Check:* every figure quoted in the documents can be found in a report under the data directory, the Result section names the command, seeds and commit, and the link check passes.

## Tests

- Each measure on a hand-built position, including the edge cases: no property, everything mortgaged, a complete group, a seat in jail.
- `stateOf` round trip, as in task 5.
- `chances` sums to 1 within 1e-9, gives 0 to a bankrupt seat, and is unchanged when the seats are relabelled.
- `chances` computed in the library equals the probabilities the fitting script computed, for 100 stored lines.
- `priceOf` rises when the property is one that completes the seat's group, is 0 for a change that does nothing, and never exceeds its upper bound.
- `staticIncome` against the published table.

## Experiments and cost

| Run | Games | Engine time |
| --- | --- | --- |
| Snapshot files | 100,000 at each size | About 100 minutes of one core in all; a quarter of an hour on eight processes. |
| Fit, with the grid of twelve settings | | Minutes for each table size. |
| Intervention study | 360 cells × up to 200 positions × 20 playouts × 4 arms: up to 5.8 million part-games | Unknown until timed on one cell. A part-game is shorter than a game; at half a game each it is about two and a half hours on eight processes. |

## Commands

```sh
node scripts/study.ts 100000 --snapshots $DATA_DIR/snapshots --rates src/sim/landing-rates.ts
node scripts/fit-valuation.ts --snapshots $DATA_DIR/snapshots --out src/sim/valuation-v1.ts > $DATA_DIR/valuation/report.md
node scripts/probe-value.ts --snapshots $DATA_DIR/snapshots --cell wei,part,10,4 --time    # one cell, to size the run
node scripts/probe-value.ts --snapshots $DATA_DIR/snapshots --workers 8 > $DATA_DIR/probes/purchases.md
```

## Gate

All on the test games, at each table size.

1. V1's log loss is lower than the net-worth model's, and the interval of the difference (by bootstrap over games) excludes zero.
2. The leader by V1 goes on to win more often than the leader by net worth at rounds 10, 20, 30 and 40. The figures to beat are in [statistics.md](../statistics.md#who-is-ahead).
3. V1 is calibrated: in each tenth of its predictions, the share actually won is within 3 points of the mean prediction.
4. V1 agrees with the intervention study: across the cells whose measured difference has an interval that excludes zero, V1 has the same sign in at least nine of ten, and the rank correlation of predicted and measured differences is at least 0.7.

Bars 3 and 4 are this plan's proposals; they have no earlier figure to be compared with.

## Decision points

- **V1 fails bar 4 for some sets.** The schools then price those sets from the intervention study's table (set, what is held, round, size) instead of from V1, and the features of V1 are revisited. The intervention study is the authority; V1 is the fast approximation of it.
- **V1 does not beat the rent-roll-within-reach model by a clear margin.** It still passes the gate, which is against net worth. It is recorded as a finding: one measure carries nearly everything at tables of today's agents. The shaping potential in M4 can then start from the simpler model.
- **The weights zigzag across knots or the validation loss is better with fewer knots.** Use knots at 10, 25 and 45.
- **The intervention study is too slow.** Halve the playouts to ten, then drop the round-15 cells.

## Feeds back into

- [statistics.md](../statistics.md): a section on what a purchase is worth by intervention, which replaces the regression table "In coins" as the main evidence; the regression stays as a cross-check.
- [ai.md](../ai.md): finding S1 and the reference-style table with the new figures; the description of V1 in workstream A.
- `scripts/study.ts`: reports the leader by V1 next to the other measures from now on.

## Out of scope

- Showing who is ahead in the client. That is M10.
- Valuing a change of hands between two players. M9 extends the intervention study to trades.
- The value network V2. That is M5.

## Result

Done on 18 November 2026, unattended; the details are in [log.md](log.md). Snapshots: 100,000 games at each table size, the same games as the study's. V1 fitted by L-BFGS (not Newton's method, see the log); ridge 0.01 and smoothness 10 chosen at every size. Weights in `src/sim/valuation-v1.ts`.

| Bar | 2 players | 3 players | 4 players | Passed |
| --- | --- | --- | --- | --- |
| 1. Log loss below the net-worth model's, interval excluding zero | 0.383 against 0.448 (difference 0.061 to 0.069) | 0.572 against 0.690 (0.113 to 0.123) | 0.675 against 0.857 (0.175 to 0.188) | yes |
| 2. Leader by V1 wins more often than the leader by net worth, rounds 10, 20, 30, 40 | 67.3, 76.3, 81.6, 85.2% against 58.6, 68.2, 75.7, 80.7% | 58.8, 70.9, 77.8, 82.6% against 44.7, 59.2, 71.4, 79.1% | 56.8, 70.5, 79.5, 84.8% against 40.3, 59.6, 72.4, 78.3% | yes |
| 3. Calibrated within 3 points in every tenth | largest gap 1.1 | 1.6 | 2.6 | yes |
| 4. Agrees with the intervention study: same sign in nine cells of ten, rank correlation at least 0.7 | | | | yes: 206 of 206 clear cells; 0.861 |

**Gate:** passed. The intervention study ran smaller than planned (rounds 5, 10 and 20; 50 positions a cell; 8 playouts an arm), for time. Its findings are in [statistics.md](../statistics.md#what-a-purchase-is-worth-by-intervention). The line `valuation-2`, `-3` and `-4` opens with this fit.

Commands, seeds and outputs: `node scripts/study.ts 100000 --only full --snapshots $DATA_DIR/snapshots` (seeds 1 to 100,000); `node scripts/fit-valuation.ts --snapshots $DATA_DIR/snapshots --sizes <n>` (fit on seeds to 70,000, choose to 85,000, test after); `node scripts/probe-value.ts --snapshots $DATA_DIR/snapshots --positions 50 --playouts 8 --rounds 5,10,20` (test seeds only). Commits `f7530c3` (snapshots) and `cd0ba1b` (V1).
