# Stage plans

[ai.md](../ai.md) says what the learned opponents are for, what the simulations show and how the work is divided. The files here say how each stage is built: the files it adds, the formats it fixes, its tasks in order, its tests, its experiments and what they cost, the number that closes it, and what to do when that number is not reached.

M0, M1 and M4 are done, M2 is built, M3 was run at reduced size. M3b, table politics, was added on 18 November 2026 and run on 18 to 19 November; M5's remedies and value network and M6's first steps and G1 ran at the same time. [log.md](log.md) records the unattended work step by step. The runs stopped on 19 November at about 15:31; what was left is listed in log.md under "Where the runs stopped", and `$DATA_DIR/queue/resume.sh` starts it all again.

| | Stage | Workstream in ai.md | Needs | Status |
| --- | --- | --- | --- | --- |
| M0 | The simulation study: [statistics.md](../statistics.md) | | | Done |
| M1 | [Valuation](m01-valuation.md) | A | M0 | Done 18 November 2026: gate passed |
| M2 | [Schools of play](m02-schools.md) | B | M1 for the presets that price by the valuation; nothing for the baseline preset | Built 18 November 2026; gate met in full on 21 November (all 36 bars, after a fifth round of retuning) |
| M3 | [Style search and the league](m03-search-and-league.md) | B, C | M2 | Run 18 November 2026 at reduced size; gate not met in full (bar 2 passed at every size; bar 1 failed at four players) |
| M3b | [Table politics](m03b-table-politics.md) | K | M1, M2, M3 | Run 18 to 19 November 2026, in part. Bars 1 and 6 passed; bar 2 passed by means; bar 3 met by Early bird with the last street at today's price; bar 7 met at three players and not at four (an Envoy beside a False friend wins 2.3 points less than a Balancer; met narrowly with a smaller gift); bars 4 and 8 wait on runs; bar 5, as rewritten on 19 November (test opponents that stall are exempt), met by every school but Balancer. Corrected forms of the value-pricing schools adopted as presets |
| M4 | [The environment](m04-environment.md) | D, E | M1; can run alongside M2 and M3 | Done 18 November 2026: gate passed |
| M5 | [Supervised learning](m05-supervised.md) | F, J | M3, M4; M3b for the full sets of decisions | Remedies run 19 November 2026: none lifts the clone's own drafting (7%); with the baseline proposing it plays level with its teacher (24.8% against 24.0%). The value network is not yet better than V1 by its interval (bar 3 unmet). Bar 2 met on 20 November at two, three and four players, read against the teacher in the same seat (the clone at most 3 points worse, by the paired interval; author's decision) |
| M6 | [Reinforcement learning: the first games](m06-first-games.md) | G | M5; by the decision of 18 November it may start from the best clone to hand; G2 and G3 after M9's parts A and B (decided 20 November) | G1 passed on 20 November: three seeds, each 89.5% to 90.2% against the baseline over 1,000 games and 31.1 to 31.2 points above the refuser over 5,000 paired games, at most one game in 5,000 cut off; seed 1 holds `main-2` (an edge of 77.3 points over the clone). Step 0c passed (author's reading); 0d passed. G2 and G3 wait for M9's parts A and B, and train with the learner's own offers |
| M7 | [The full game and the specialists](m07-full-game.md) | G | M6 | Code for tasks 1 and 6 written and checked (19 November 2026): `train/branch.py`, past selves, checks at every size, the configurations, `study.ts --members`. No run made |
| M8 | [League training and the reward search](m08-league-training.md) | E, G | M7 | Not started |
| M9 | [Trading](m09-trading.md) | H | Moved forward on 20 November: parts A and B after G1 and before G2; part C inside G2 and G3; part D in M7 and M8 | Next: part A (action version 3, layout version 4, the drafting schedule, the offer suite, gate 7's remedy, Balancer's fix) |
| M10 | [In the client](m10-in-the-client.md) | J | M5 for a first model; M9 for the last | First version's tasks 1 to 4 and 5a built; the person's checks open |

```text
M0 ── M1 ──┬── M2 ── M3 ── M3b ──┐
           │                     ├── M5 ── M6 (G1) ── M9 (A, B) ── M6 (G2, G3, with M9's C) ── M7 ── M8 ── M10
           └── M4 ───────────────┘
```

## How a stage file is laid out

| Section | What it holds |
| --- | --- |
| Purpose | What the stage is for, in a paragraph, and which requirements and findings of ai.md it answers. |
| Deliverables | Every file added or changed. |
| Specification | Interfaces, file formats, algorithms and settings, precise enough to implement from. |
| Tasks | The work in order. Every task ends in a check that can pass or fail; there are 146 across the eleven stages. |
| Tests | What goes into `test/` (or `train/tests/`) and stays there. |
| Experiments and cost | What is run, on which seeds, how many games, and what that costs in engine time. |
| Commands | The command lines the stage adds, as they will be typed. |
| Gate | The numbers that close the stage. |
| Decision points | What is done when a number comes out the other way. |
| Feeds back into | Which documents and figures are revised when the stage closes (requirement R9). |
| Out of scope | What the stage deliberately leaves alone. |
| Result | Empty until the stage closes. Then: the gate's figures, the command and seeds that produced them, the commit. |

## Conventions shared by every stage

**Seeds.** A game is fixed by its table and its seed. The ranges of the evaluation protocol in ai.md, subdivided so that no stage reuses another's games:

| Seeds | Used for |
| --- | --- |
| 1 to 999,999 | The study and the benchmark. Snapshot files and valuation fits (M1). |
| 1,000,000 to 1,499,999 | Evaluation: gates only. Never used to train, search, tune or choose a checkpoint. |
| 1,500,000 to 1,999,999 | Promotion matches: a new version against the best so far. Each seed is used for one match and never again. |
| 2,000,000 to 2,099,999 | Style search: the score of a candidate (M3). |
| 2,100,000 to 2,199,999 | Style search: scoring a candidate again before it enters the league. League reports (M3). |
| 2,200,000 to 2,499,999 | The held-out sets of supervised learning: validation and test (M5). |
| 2,500,000 to 2,999,999 | Checks during training: progress curves, choosing a checkpoint, the reward search (M6 to M9). |
| 3,000,000 to 9,999,999 | The stored training sets of supervised learning, a block of 500,000 for each set (M5). |
| 10,000,000 and up | Games a learner trains on. |

Within the evaluation range, M3 read its gate from seeds 1,000,000 on, and M3b is given 1,100,000 to 1,199,999. Its search continues the style search's range from 2,050,000, with admission from 2,150,000.

**Table sizes.** Every result is given for two, three and four players. An even share is 50%, 33.3% and 25%.

**Seats.** Every agent under test takes every place in the order of play equally often. In a table of one odd player among others, the odd player's place follows from the seed's opening roll, and a run uses enough seeds that the places even out; a paired comparison uses the same seeds and the same seats for both agents.

**Sample sizes.** 1,000 games for a bar against an even share (a 95% interval of about ±3 points near one half). 5,000 paired games for a bar against another agent. 10,000 or more for a difference of a point or two. Every share is printed with its Wilson interval.

**Where things go.**

| What | Where |
| --- | --- |
| Library code that the client may also use | `src/sim/`, `src/env/` |
| Programs that are run from the command line | `scripts/` |
| Python | `train/` |
| Output of runs: reports, snapshots, datasets, checkpoints, replays | The data directory, below. Not committed. |
| Figures worth keeping | The stage's Result section, and the documents named under Feeds back into |
| Models the client loads | `assets/models/`, each with a record of how it was made |
| Who holds each line of succession, and every holder before | `assets/lines.json` |

**Done means.** The gate's figures are recorded with the command, the seeds and the commit that produced them. `npm run typecheck` and `npm test` pass. If the stage changed how any agent plays, the study has been run again with it. The documents named under Feeds back into have been revised.

**Cost of games.** The engine plays about 34,000 actions a second on one core with the rule-based agents choosing. From the mean actions in a game, 1,000 games cost about 16, 21 and 23 seconds of one core with two, three and four players. The costs in the stage files are worked from these and are the engine's share only.

**The data directory.** Every program that writes run output takes its root from the environment variable `DATA_DIR`, and from `build/` when that is not set. Small reports can stay in `build/`. Snapshot files, datasets, checkpoints and replays are meant for a large external disk: the plans assume about 150 GB there, and nothing of the kind on the system disk.

| Under the data directory | Written by | Size to expect |
| --- | --- | --- |
| `snapshots/` | M1 | Under 1 GB for 100,000 games at each size |
| `probes/` | M1, M9 | Megabytes |
| `league/`, `ladder/`, `search/` | M3 and after | Megabytes for a report; the search's archive under 1 GB |
| `datasets/` | M5 | The largest item. 240 GB before compression for 120 million decisions; the ratio is measured on the first file and the sets are sized to stay under 100 GB |
| `runs/<name>/` | M5 and after | A checkpoint is about 18 MB with the optimizer's state. One every 20 updates is about 1 GB for a run of 150 million decisions |
| `replays/` | M6 and after | About 1.5 KB a game as a seed and a list of actions. Every game of a check, a gate or a match is kept; one training game in a hundred |

A file system without links or permissions (exFAT, as external disks often are) is enough: every file is plain data written once. Programs write to a temporary name and rename, so that a disk unplugged mid-write leaves no half file under a real name.

**When runs are made.** Set by the author on 18 November 2026. A run that plays games for data (a study, a probe, a search, a league report, decision sets, training, scoring) is made only while the data directory's disk is attached. When it is attached, the runs waiting in [log.md](log.md#runs-waiting-for-the-disk) are made in full, in order, without asking again. When it is not, no such run is made, at any size and to any other disk: the work is code, tests and documents. `npm test` and `npm run typecheck` are not runs in this sense and are always made.

## New against best

A gate against fixed opponents says that a version is good enough. It does not say that it is better than the one before. Reinforcement learning can go backwards, a search can drift, and a version chosen as the best of many checks is partly the luckiest. So every kind of thing the plan produces has a **line of succession**: a holder, which is the best version so far, and every holder before it. A new version takes the title only by beating the holder at the table.

| Line | Opens with | Opened in |
| --- | --- | --- |
| `valuation-2`, `-3`, `-4` | The first V1 that passes M1's gate | M1 |
| `style-2`, `-3`, `-4`: written schools, playbooks and found styles together | The baseline | M2 |
| `main-2`, `-3`, `-4`: the learned agent | The starting policy cloned from the teachers | M5 |
| `conductor-2`, `-3`, `-4` | The holder of the style line | M8 |
| `trader-2`, `-3`, `-4` | The holder of the main line | M9 |

**The match.** `node scripts/promote.ts --line main-4 --challenger <id>` plays, on seeds from the promotion range that no match has used:

| Table | Seats | Games |
| --- | --- | ---: |
| A | The challenger as the one among copies of the holder | 4,000 |
| B | The holder as the one among copies of the challenger, on the same seeds | 4,000 |
| C, four players only | Two of each, in alternate places. Reported, not judged. | 2,000 |

With two players A and B are the same pairing with the seats exchanged, so each seed is simply played both ways round.

The challenger's **edge** is its win share in A above an even share, plus an even share above the holder's win share in B. It is promoted when all three hold:

1. The edge's 95% interval, by bootstrap over seeds, lies above zero.
2. As the one among baselines over 2,000 paired games, it is not worse than the holder: the interval of the difference does not lie wholly below zero.
3. Its worst row against the league is not below the holder's by more than the interval.

For a valuation there is no table. The challenger is promoted when its log loss on the same test games is lower with the interval of the difference excluding zero, and its agreement with the intervention study is not lower.

**What is kept.** `assets/lines.json` lists, for every line, every holder in order: its id, date and commit, whom it beat, the seeds of the match, both win shares, the edge and its interval. A challenger that fails is recorded too, with its figures, and may still join the league as an ordinary member.

**The ladder.** After each promotion the new holder plays every earlier holder of its line, tables A and B at 1,000 games each, and `ladder/<line>.md` is rewritten: the matrix of every holder against every other, and a strength for each by the Plackett-Luce fit of M3. Strength should rise with the version. An earlier holder that beats the new one by more than its interval is reported as forgetting or as a cycle, and that earlier holder's weight among the next run's opponents is doubled.

**In training.** The holder of a learner's own line fills one opponent seat in ten at all times, on top of the weighted draw. Every earlier holder is a league member.

**What ships.** Only holders. The client never carries a version that has not won its match.

**When a match is called.** At the end of every run's budget; and during a run whenever the check every 100 updates puts the learner's figure against baselines 2 points above the figure recorded for the holder. A style or a playbook is put forward at the end of a search.

## What the plans do not pretend to know

- **How fast the bridge to Python is.** M4 measures it. Every figure for training time before then is a guess and is marked as one.
- **How many decisions reinforcement learning needs.** M6 fixes a first budget and a rule for what to do when it runs out.
- **Whether shaping, the milestone potentials or the side predictions help.** Each is behind a switch, and M8 reports the ablation.
- **Whether a learned agent that wins is also good company.** M10 ends with a person playing it.
- **Whether table politics pays among these agents.** One behaviour of M3b has evidence behind it and is held to a result. The rest are measured and recorded whichever way they fall.
- **How long M3b's runs take.** Its schools read the valuation for every candidate deal. Each run is timed on its first 200 games before it is sized.

## Decisions made while writing these plans

Detailing the stages changed eight things in ai.md. Each is argued in the stage file named.

| Decision | Instead of | Stage |
| --- | --- | --- |
| The valuation V1 is one model over the seats of a table whose chances add up to one, with weights that vary with the round. | A separate yes-or-no model for each seat, with fixed weights. | M1 |
| What a purchase is worth is also measured directly, by changing a position and playing it out many times. | Reading it off a regression alone. | M1 |
| The measures of standing move from the study script into `src/sim/`. | Staying in `scripts/study.ts`. | M1 |
| League members are rated by a Plackett-Luce model fitted to finishing orders. | TrueSkill. | M3 |
| The client runs a small network with a forward pass written in TypeScript, the weights carried inside the script. ONNX stays as the interchange format and as the fallback for a larger network. | ONNX Runtime Web for everything. | M5, M10 |
| A school is made of parts that can be taken from different schools, two schools can be blended, and a playbook of rules changes the parts with the position at every decision. A learned conductor chooses among schools turn by turn. | One fixed style for a whole game. | M2, M3, M8 |
| A new version replaces the best so far only by beating it at the table, and every best-so-far is kept and played against. | Gates against fixed opponents only. | This file; every stage from M1 |
| Training decisions are written to a large disk once and read many times. | Streaming them from the environment and keeping nothing. | M5 |

Two more were made on 18 November 2026, by the author, after the first unattended run.

| Decision | Instead of | Stage |
| --- | --- | --- |
| Whom a seat deals with, refuses and stops is designed in as its own stage, with a deal sheet that prices a deal for every seat. | Trading as a matter between two seats, left to M9. | M3b |
| M6 may be written and started from the best clone to hand while M5's bar for the starting policy is unmet. The bar stays as written. | Nothing from M6 on before M5's gate. | M5, M6 |
| A seat works against a leader, a person included, as far as serves its own winning. The level is set by its own win share. | A setting for how political opponents are. | M3b, M10 |
| An alliance is asked for and answered with offers. Nothing is added to the game to talk with. Sending and reading are both designed. | A few fixed phrases between players. | M3b, M10 |
| Agents may offer for a debtor's property at the moment of a debt, as the rules allow. | Agents that act only on their own turn. | M3b |
| Runs that play games for data are made only while the data disk is attached, and then in full without asking. | Asking before each run; small runs to the system disk. | This file |
