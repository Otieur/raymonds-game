# M3. Style search and the league

## Purpose

To find strong styles of many kinds, and to build the yardstick everything later is measured with. M2 produced schools that differ; this stage finds the best style of each kind for each table size, and stands up the league: the set of opponents, the standard tables, and a report that rates every member against every other.

It answers requirements R2, R3 and R8 of [ai.md](../ai.md), and it is what supplies supervised learning with teachers and reinforcement learning with opponents.

## Deliverables

| File | Contents |
| --- | --- |
| `src/sim/league.ts` | The registry of members: a name, a description, and how to build its agent. |
| `src/sim/rating.ts` | The Plackett-Luce fit. |
| `scripts/search-styles.ts` | The search. |
| `scripts/league.ts` | Plays the standard tables and prints the league report. |
| `scripts/promote.ts` | Plays a challenger against the holder of a line, applies the rule, records the result in `assets/lines.json`, and rewrites the line's ladder. |
| `src/sim/styles-found.ts` | Generated. The styles the search admitted to the league, with their records. |
| `test/league.test.ts`, `test/rating.test.ts` | Tests. |

## Specification

### Members

```ts
export interface Member {
  name: string;                 // unique; 'baseline', 'refuser', 'found-4-a07', ...
  kind: 'fixed' | 'school' | 'found' | 'learned';
  sizes: (2 | 3 | 4)[];         // the table sizes it is meant for
  describe: string;
  /** A fresh agent for one seat of one game. */
  create(): { choose(engine, state, actor, random): Action | null; observe(events): void };
}
export const LEAGUE: readonly Member[];
```

A member carries its own memory, created fresh for each game. At the end of this stage the league of a table size holds three fixed members, `random`, `baseline` and `refuser`, and up to twenty-one admitted styles. An admitted style may be one of M2's presets, a style the search found, or a playbook: the presets are the search's starting population, so they compete for the archive's cells like any other candidate. Every preset is also measured on its own as the one among baselines, in M2.

### The search space

A candidate is a `Style` without `blockMode` and without `bySize`: the search runs once for each table size, so a candidate is already for one size. The mood switch is searched only as two numbers (`moodWindow`, `moodFloor`) with the reference style's block mode attached; a full second set of parameters would double the space for a behaviour only some styles use.

| Kind of field | How it is encoded | How it is perturbed |
| --- | --- | --- |
| A number with a range | Scaled to 0 to 1 over its range | Gaussian noise, clipped |
| A number for each of ten sets (`buy`, `bidCap`) | Ten scaled numbers | With equal chance: noise on all ten together, or on one |
| Yes or no; one of two | 0 or 1 | Flipped with chance 0.1 |
| `buildTarget` | 1 to 5 | Moved by one with chance 0.2 |

The ranges are those of the table in ai.md. A style is about sixty numbers.

### The score

A candidate's score is its win share as one seat among opponents, over a fixed list of seeds.

- **Opponents.** For each game the other seats are drawn from the pool with a draw fixed by the seed, so every candidate meets the same opponents in the same game. The pool starts as baseline, refuser and reference, in equal parts; the best style of each generation's archive is added to it, up to twelve.
- **Seeds.** 600 games from 2,000,000 on. The list changes every generation, and survivors are scored again on the new list, so a style cannot survive on one lucky draw.
- **Noise.** At 600 games the interval on a win share is about ±4 points at two players and ±3.5 at four. Selection works on that; admission to the league does not (see below).

### Searching for strength

An evolution strategy with elites, run separately for two, three and four players.

| Setting | Value |
| --- | --- |
| Population | 48 |
| Kept each generation | The best 12, scored again on the next list |
| New each generation | 36: a kept style, perturbed; one in four also takes each field from a second kept style with chance one half |
| Noise | Standard deviation 0.15 of a field's range, falling to 0.05 by the last generation |
| Generations | 40 |
| Start | The presets of M2 that are plain styles and meant for that size, and random perturbations of them to fill the population. The playbooks start the second search, below. |

### Searching for difference

Every candidate ever scored is also offered to an archive, in the manner of MAP-Elites. The archive is a grid over four of the behaviour descriptors of M2, measured in the candidate's own scoring games:

| Descriptor | Cells |
| --- | --- |
| Building share | Under 0.3; 0.3 to 0.5; 0.5 to 0.7; over 0.7 |
| Trades accepted per game, either side | None; up to 1; 1 to 3; over 3 |
| Passes at round 20 | Under 0.75; 0.75 to 1.5; over 1.5 |
| Cash at round 20 | Under 200; 200 to 500; over 500 |

That is 144 cells. A cell keeps the candidate with the best score that fell in it. One in four of each generation's new candidates is bred from a style drawn from the archive instead of from the kept twelve, which is what pushes the search into kinds of play that are not the strongest.

### Searching for playbooks

A fixed style plays one way from the first roll to the last. The second search asks whether changing with the position is better, and looks for the rules worth changing by. It runs after the first, for each table size, and builds its candidates out of the first search's results.

A candidate is a playbook of M2:

| Piece | Encoded as | Changed by |
| --- | --- | --- |
| The base | One of the styles in this size's archive | Replaced by another with chance 0.1 |
| Up to eight rules, in order | For each: one or two conditions (a signal, `<` or `>=`, a threshold scaled to the signal's range); one or two parts, each with the archive style it is taken from; a hold of 0 to 6 turns | With equal chance: a threshold moved by Gaussian noise of 0.1 of its range; a source style replaced; a part replaced; a signal replaced; the hold moved by one |
| The number of rules | 0 to 8 | A rule added with chance 0.15, removed with chance 0.15, two neighbours exchanged with chance 0.1 |

A child is bred from one kept playbook by these changes; one in four also takes each of its rules, by position, from a second kept playbook with chance one half.

| Setting | Value |
| --- | --- |
| Population | 48 |
| Kept each generation | The best 12, scored again on the next list |
| Generations | 30 |
| Start | The Opportunist, the Reference and Two-stage of M2; every admitted style of this size as a playbook with no rules; random playbooks of one to three rules to fill the population |
| Score, seeds, opponents | As for styles |

**What it reports,** beyond the best playbook: for every signal, how often it appears in the kept playbooks of the last generation, and with what threshold; for every part, how often it is switched. That is the search's answer to which changes in a position are worth reacting to.

**Whether changing helps.** The best playbook and the best fixed style of a size are compared directly: each as the one among baselines on the same 5,000 seeds, and head to head by the promotion match of [README.md](README.md#new-against-best). The result is recorded whichever way it falls. If the playbook wins it takes the style line. If it does not, changing by written rule does not pay at this table, and the learned conductor of M8 is the next test of the idea.

### Admission to the league

A style enters the league only after it has been scored again on seeds the search never used: 5,000 games from 2,100,000 on, as the one among baselines. From each table size's archive the search admits the best overall, and the best of every cell whose score on these games is at least an even share with the interval's lower end no more than 2 points below it, to a limit of twenty-one for each size. Each is written to `styles-found.ts` with its parameters, its descriptors, its scores and the commit.

### Standard tables

| Table | Seats | Games |
| --- | --- | --- |
| One among copies | One seat for member X, the rest for copies of member Y, for every ordered pair of members meant for that size | 2,000 for each pair and size |
| Mixed | Every seat drawn from the members meant for that size, the draw fixed by the seed | 20,000 for each size |

Seeds from 2,100,000 for the report during development, and from 1,000,000 when a report backs a gate.

### Rating

A member's strength is fitted from finishing orders with a Plackett-Luce model: each member has a strength `s`, and the chance that a seat finishes first among those not yet placed is its member's `s` over the sum of theirs. The finishing order of a full game is the winner, then the others by how long they lasted. The fit is maximum likelihood by the minorization-maximization iteration (Hunter, 2004), which needs no step size and converges to the one maximum; intervals come from refitting on games drawn again with replacement, 200 times.

The fit uses the mixed tables. It is chosen over an online rating because every game is available at once, so nothing is gained by updating game by game, and because it takes forty lines and one page to check. Ratings are printed on a scale where the baseline is 0 and 100 points is a doubling of strength.

A single rating hides cycles, so it is never printed alone.

### The league report

`node scripts/league.ts [--sizes 2,3,4] [--games 2000] > $DATA_DIR/league/report.md`, with `league.json` beside it. For each table size:

1. The members, with kind, description and descriptors.
2. The matrix: the win share of X as the one among copies of Y, with intervals.
3. For each member: its mean over the matrix, and its worst row, with the opponent's name.
4. The ratings, with intervals.
5. Cycles: every triple A, B, C in which A beats B, B beats C and C beats A as the one among copies, each by more than its interval.
6. The mixed tables: win share by member, game length, the share of games not finished.

## Tasks

1. **`league.ts`** with the fixed members and the presets. *Check:* every member plays 100 games at each of its sizes without a refused action.
2. **`rating.ts`.** *Check:* on orders drawn from known strengths, the fit recovers them within the bootstrap intervals; a member that always wins gets a finite rating through a small prior.
3. **`scripts/league.ts`,** first with the fixed members and presets only. *Check:* the refuser's row among baselines reproduces 58.2%, 41.0% and 30.4% within its intervals; no member is played against itself.
4. **The search:** encoding, perturbation, scoring with a fixed opponent draw, the elite loop. *Check:* started from the baseline with only `acceptMargin` free, it finds a value that scores above the baseline, as finding S5 says it must.
5. **The archive.** *Check:* a candidate replaces a cell's holder only with a higher score; the archive is saved after every generation and a run can resume from it.
6. **Run the search** for each table size. *Check:* the log gives each generation's best score both on the list it was chosen on and on the next list. A best that rises on the first and not on the second is noise and is reported as such.
7. **The playbook search:** the encoding of rules, the changes, the report on signals. *Check:* started from the reference style's base with its one rule removed, it finds a rule on `mood` again if that rule was worth having; if it does not, that is recorded.
8. **Run the playbook search** for each table size, and compare the best playbook with the best fixed style. *Check:* for each size, a table of the best playbook against the best fixed style with intervals, and the report on which signals the kept playbooks use.
9. **Admission,** on fresh seeds; generate `styles-found.ts`. *Check:* every admitted entry has its admission score recorded; `styles-found.ts` type-checks and every entry validates as a style or a playbook.
10. **Promotion.** Put the best of each size forward for its style line. *Check:* `assets/lines.json` and each line's ladder are updated, and a failed challenger is recorded with its figures.
11. **The league report** with the found styles and playbooks in. *Check:* gate 3: the baseline rows reproduce the figures of ai.md within their intervals.
12. **Rerun the study** with the holder of each style line as the odd player. *Check:* the study completes with the holder as the odd player and prints its descriptors.
13. **Write up.** *Check:* every figure quoted in the documents can be found in a report under the data directory, the Result section names the command, seeds and commit, and the link check passes.

## Tests

- The rating fit, as in task 2.
- The opponent draw for a seed is the same for every candidate.
- A search run of two generations with a population of four is reproducible from its seed.
- The matrix's diagonal is not played, and a member plays only at its sizes.

## Experiments and cost

| Run | Games | Engine time |
| --- | --- | --- |
| One generation | 48 candidates × 600 games | About 8, 10 and 11 core-minutes with two, three and four players |
| The search, 40 generations, three sizes | 3.5 million | About 19 core-hours; two and a half hours on eight processes |
| The playbook search, 30 generations, three sizes | 2.6 million | About 14 core-hours of rules, and more for the valuation that the signals read at every decision; timed on the first generation |
| Admission | Up to 63 candidates × 5,000 games | About 1.8 core-hours |
| A promotion match and its ladder | 8,000 games, and 2,000 for each earlier holder | Minutes |
| League report, 24 members at a size | 552 ordered pairs × 2,000 games, and 20,000 mixed, for each size | About 19 core-hours in all; two and a half hours on eight processes. With `--games 500` for a draft, under an hour. |

The league report is the largest cost of the stage and grows with the square of the members. It is the reason admission is capped at twenty-one for each size.

## Commands

```sh
node scripts/search-styles.ts --size 4 --generations 40 --out $DATA_DIR/search/styles-4     # resumes if the directory exists
node scripts/search-styles.ts --size 4 --playbooks --generations 30 --out $DATA_DIR/search/playbooks-4
node scripts/league.ts --sizes 2,3,4 --games 2000 > $DATA_DIR/league/report.md
node scripts/promote.ts --line style-4 --challenger found-4-a07
```

## Gate

1. At each table size the archive holds at least twelve admitted styles in different cells, each with at least an even share against baselines on the admission seeds.
2. At each table size the best style found wins more than the refuser does as the one among baselines, over 5,000 paired games on evaluation seeds, with the interval of the difference above zero. The refuser's figures are 58.2%, 41.0% and 30.4%.
3. The league report runs for all three sizes, and its baseline rows reproduce the figures of ai.md within their intervals.
4. At each table size the best playbook has been compared with the best fixed style, as the one among baselines and head to head, and the result is recorded.
5. Each style line has a holder that won its promotion match, and the ladder of that line is written.

Bar 2 is stricter than the gate in ai.md, which asked only for more than an even share. The study has since shown that a one-line change already clears that.

## Decision points

- **The best style found does not beat the refuser.** The space is too narrow where it matters. Look at which fields ended at the edge of their range and widen those; add the selling side of trading (offers of a property for cash) to the agent; search again.
- **Fewer than twelve cells are filled with styles that hold an even share.** Lower the bar for admission to within 3 points of an even share, and record it. Variety matters more to the league than every member being strong.
- **The found styles are all one kind.** Raise the share bred from the archive from one in four to one in two.
- **A found style wins by a flaw in the baseline that a person would never allow** (for example it wins only because the baseline sells cheaply). Admit it, and note in its record what it exploits. The league needs it for exactly that reason; and the next search runs against a pool that no longer sells cheaply.

## Feeds back into

- [ai.md](../ai.md): the baselines table gains the best found style of each size; findings S5, S8, S10 and S11 are restated with what the search found (which sets the best styles buy, how far they build, what they sell for, how that differs by size).
- [statistics.md](../statistics.md): the study rerun, with the best found style as the odd player.
- This is the first point at which the plan has opponents stronger than today's agent, so the "figures can and cannot say" caution in statistics.md is revised: which findings held up when the agents changed, and which did not.

## Out of scope

- Learned members. They join in M6 and after.
- Training anything. The search has no gradients and no network.

## Result

Run on 18 November 2026, unattended, at a reduced size; the details and every decision are in [log.md](log.md). The style search ran 15 generations of 24 candidates, the best 6 kept, 400 games a score, and was stopped by the clock: after 9 generations at two players, 7 at three and 3 at four. Admission scored the 12 best cells of each size over 2,000 games; the league report played 400 games a pair and 4,000 mixed games with the fixed members and up to 9 admitted styles.

| Bar | 2 players | 3 players | 4 players |
| --- | --- | --- | --- |
| 1. At least twelve admitted styles in different cells, each at least an even share | 12 (two styles each fill two cells) | 11 in the first round; 12 after the search ran 6 more generations (one style fills two cells) | 7 in the first round, 8 in the second (6 distinct styles); not met |
| 2. The best style beats the refuser as the one among baselines, 5,000 paired games on evaluation seeds | 87.3% against 58.1%: +29.2 (27.5 to 30.8) | 56.4% against 40.9%: +15.5 (13.6 to 17.5) | 39.3% against 31.2%: +8.1 (6.2 to 9.9) |
| 3. The league report runs, and its baseline rows reproduce ai.md | yes | yes, except random among baselines (1.0% against 2.5%, 400 games) | yes, except the refuser among baselines (24.9% against 30.4%, 400 games; 31.2% over 5,000 paired games) |
| 4. The best playbook compared with the best fixed style | recorded: the playbook search's best was a fixed style; the Opportunist wins 62.3% among baselines against the holder's 87.1% | not run | not run |
| 5. Each style line has a holder that won its match, with its ladder | `style-2`: found-2-b1t2p2c1 (edge 75.1 points over the baseline); a second challenger was refused | `style-3`: found-3-b2t2p1c1 (edge 39.2 points) | `style-4`: found-4-b2t1p1c2, the Sky rush preset (edge 25.7 points) |

**Gate:** not met in full. Bar 2 holds at every size. Bar 1 holds at two and three players (counting cells, as the bar is written; some styles fill two cells) and fails at four; bar 4 was run at two players only. The ladders are only one step long (the baseline, then one found style), so each line's ladder is its promotion match; `scripts/promote.ts` does not yet write a separate ladder file.

**What the search found.** The best styles at two and three players buy the cheap side outright and the dear groups only to complete them, keep little cash, offer well above list for a missing street, sell idle property to collectors, and ask a high price for a street that completes the proposer's group. At four players the search was too short and its best is the Sky rush preset. The leagues at three and four players show cycles, as tables of more than two allow; at two players there are none. At four players the found styles rate only 0 to 30 against the baseline's 0 in mixed tables, and one of them loses even to random players when it fills three seats: styles bred against refusers can starve one another at a table of copies.

Commands: `node scripts/search-styles.ts --size <n> --out $DATA_DIR/search/styles-<n> --generations 15 --population 24 --keep 6 --games 400`; `--admit --sizes <n> --games 2000 --candidates 12`; `node scripts/league.ts --sizes <n> --games 400 --mixed 4000 --members ...`; `node scripts/promote.ts --line style-<n> --challenger ...`; `node scripts/paired.ts --size <n> --a ... --b refuser --games 5000 --seeds 1000000`. Outputs in `$DATA_DIR/search/` and `$DATA_DIR/league/`.
