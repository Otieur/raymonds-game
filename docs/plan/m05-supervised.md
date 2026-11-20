# M5. Supervised learning

## Purpose

To prove the whole pipeline with the cheapest kind of learning, and to give reinforcement learning somewhere to start. The league's schools are free teachers: this stage trains a network to play as they play and another to say who is winning, runs the first of them in the client, and so tests the encoder, the action codec, the bridge and the browser path before any reinforcement-learning run depends on them.

It answers requirement R7 of [ai.md](../ai.md) in a first form, and R1: the starting policy imitates several teachers, weighted by how well they do, not one.

## Deliverables

| File | Contents |
| --- | --- |
| `scripts/make-dataset.ts` | Plays league games and writes their decisions to the data directory: the training sets and the held-out sets. |
| `train/data.py` | Reads the stored sets in shuffled order. Can also stream decisions from the environment, for corrections. |
| `train/model.py` | The network. |
| `train/bc.py` | Behaviour cloning. |
| `train/value.py` | The value network. |
| `train/export.py` | Writes a checkpoint as ONNX and as the client's weight file. |
| `train/configs/*.yaml` | One file for each run. |
| `train/tests/` | Tests. |
| `src/env/mlp.ts` | The forward pass in TypeScript. |
| `src/env/learned-agent.ts` | An agent built from the encoder, the codec and a model. |
| `assets/models/` | The first exported models and their records. |

## Specification

### Teachers

The teachers of a table size are the league members meant for that size whose rating in M3's report is above the baseline's. A teacher's weight is proportional to its Plackett-Luce strength, capped so that no teacher has more than 30% of the weight. A game for training seats teachers at every seat, each drawn by weight.

The schools of [M3b](m03b-table-politics.md) that pass its gate join the teachers whatever their rating: they are the only members that ask for a street before a group lacks one, buy to deny, or buy from a failing player, and a learner cannot imitate a kind of offer no teacher makes. Their weight together is at least a fifth. The full sets are written after M3b, in layout version 3.

One game in five is perturbed: at each decision, with chance 0.05, a random legal action is played instead of the teacher's, and the decision is recorded with what the teacher would have done. This puts positions in the data that good players do not reach, labelled with what a good player would do there.

### Data

**Training data is written once and read many times.** `scripts/make-dataset.ts` plays league games in TypeScript, with a teacher in every seat, and writes every decision that was not forced: the observation, the mask, the index of the action the teacher took, and the rest of the table below. It does not use the bridge. Storing has three uses that streaming does not: every run and every seed of a run sees the same data, so runs can be compared; a pass over data on disk is faster than playing the games again; and a surprising result can be traced to the decisions that taught it.

| Set, for each table size | Seats | Decisions |
| --- | --- | ---: |
| `teachers-<n>` | Teachers drawn by weight, as above | 20 million |
| `schools-<n>` | Every school and playbook of the league in equal parts; each decision carries the style in force when it was made | 20 million |
| `held-out-<n>` | As `teachers-<n>`, 600 games: 300 to validate and 300 to test | About 0.4 million |

The held-out sets use seeds from 2,200,000. The training sets use seeds from 3,000,000, a block of 500,000 for each set. A set is a directory of files of 250,000 decisions each, `part-00000.npz` onward, written under a temporary name and renamed when complete, with an `index.json` that lists the files, the seeds, the layout version and the commit.

A decision is about 2 KB before compression, so the six training sets are 240 GB as raw numbers. One-hot blocks compress several times over, but the ratio is not assumed: the first file of the first set is written and measured, and the decisions in a set are scaled so that all the sets together stay under 100 GB.

`train/data.py` reads a set in a new order every pass: the order of the files is shuffled, four files are held in memory at a time (a million decisions, about 2 GB), and batches are drawn at random from those.

**The environment can still stream.** A `teach` mode, in which a learner seat is driven by a named member and the member's action is reported in the step, stays in the plan for one purpose: labelling the positions a clone reaches by itself with what a teacher would do there, when correction is needed (see Decision points).

A teacher's action must have an index. Three cases need care:

| Teacher's action | Index recorded |
| --- | --- |
| A bid | The highest bid level whose amount does not exceed the teacher's bid. |
| An offer | The three draft steps that compose it, recorded as three decisions. An offer that the draft cannot express (several properties, a sale for cash) is recorded as no offer. |
| A whole-group sale of buildings | Not a decision; the environment rules it. |

Each file is a compressed NumPy archive of arrays, one row for each decision:

| Array | Type | Meaning |
| --- | --- | --- |
| `obs` | float16 `[N, 985]` | The observation. |
| `legal` | uint8 `[N, 24]` | The mask, 188 bits packed. |
| `action` | int16 | The teacher's index. |
| `kind` | int8 | The kind of decision. |
| `teacher` | int16 | The member's number in the league registry. |
| `game`, `step` | int32 | The game's seed and the decision's number in it. |
| `won`, `place` | int8 | Whether this seat won, and its finishing place. |
| `aux` | float16 `[N, A]` | The side targets below. |

`style` is one more array in the `schools` sets: float16 `[N, 60]`, the style in force at that decision, scaled to 0 to 1. For a playbook it changes within a game, which is what teaches the conditioned policy to change plan when its style input changes.

**Side targets,** computed from the rest of the game when it is over: the finishing place of each seat (4); the rent this seat collects over the next ten rounds, over 5,000; whether this seat completes each group before the end (8); whether it is bankrupt within twenty rounds.

### The network

```text
observation (985) [+ style vector (about 60) for the conditioned policy]
  -> Linear 512 -> ReLU -> Linear 512 -> ReLU -> Linear 512 -> ReLU
  -> policy head: Linear 188, illegal actions set to minus infinity before the softmax
  -> value head:  Linear 3, one logit for each table size, read at the game's size
  -> side heads:  Linear 14
```

About 1.1 million weights, 4.5 MB as 32-bit floats. The value head here is a single number for this seat's chance of winning; the table-wide form is the value network below.

### Behaviour cloning

| Setting | Start |
| --- | --- |
| Loss | Cross-entropy on the masked policy, each decision weighted by its kind; plus 0.1 times the side losses |
| Weights by kind of decision | 1 for a free turn; 2 for buy, bid and debt; 4 for an offer or its answer. The rare kinds would otherwise be drowned. |
| Optimizer | Adam, learning rate 1e-3 falling by a cosine to 1e-5 |
| Batch | 4,096 decisions |
| Length | Until the validation loss has not improved for five checks, one check every 2 million decisions; at most 60 million |
| Seeds | Three runs for each model; the gate is read from the median |

Two models:

- **The starting policy,** one for all three table sizes, trained on the three `teachers` sets.
- **The style-conditioned policy.** The same network with a style's parameters, scaled to 0 to 1, as about 60 more inputs: one for each number or switch of a style, ten for each field that has a value for each set. It is trained on every school in the league, in equal parts, with each decision carrying the style of the seat that made it.

**Measured on the validation set:** agreement with the teacher (the top action is the teacher's), overall, by kind of decision and by teacher; the cross-entropy; and, for bids, how far the chosen level is from the teacher's.

### The value network (V2)

A separate network of the same trunk whose output is one logit for each of the four relative seats; seats that are absent or out are masked, and a softmax gives the chances. It is trained on the same stream with the cross-entropy against the seat that won, plus the side losses. A table-wide output keeps the chances adding to one, as V1's do.

**Measured on the test set:** log loss against V1's on the same positions; calibration in tenths; the leader's win rate at rounds 10, 20, 30 and 40.

### Export, and running in the client

The desktop app opens a build from disk, as one script with no other files, because a page loaded from `file://` cannot fetch its own neighbours or load module scripts. A runtime that fetches a WebAssembly binary and a model file would not start there without special handling. For a network that is three matrix products, a runtime is also unnecessary.

- **`src/env/mlp.ts`.** `createMlp(weights): (input: Float32Array) => { policy: Float32Array; value: Float32Array }`. Plain loops over `Float32Array`; about 1.1 million multiply-adds a call.
- **The weight file.** `train/export.py` writes `assets/models/<name>.ts`: the layer shapes, the layout version, and the weights as 16-bit floats in one base64 string, about 3 MB. It is imported like any module, so the app build carries it inside the script and the dev server serves it as its own chunk.
- **ONNX** is written by the same export, as the interchange format and for checking. If the network later stops being a stack of dense layers, ONNX Runtime Web becomes the client's runtime and the `file://` handling becomes that stage's first task.
- **The record.** `assets/models/<name>.json`: the commit, the configuration, the layout and action versions, the training length, the gate's figures, the date.

`src/env/learned-agent.ts`:

```ts
export function createLearnedAgent(model: Model, options?: { greedy?: boolean }): {
  choose(engine: Engine, state: GameState, actor: PlayerId, random: () => number): Action | null;
  observe(events: GameEvent[]): void;      // keeps the ledger
};
```

It encodes the state for the acting seat, runs the network, masks, and takes the most likely legal action (or samples, when `greedy` is off), then decodes. It runs the draft steps internally until an action for the engine comes out. If anything throws, it returns the rule-based agent's choice and logs once.

## Tasks

1. **Action indices for teachers,** with the three cases of the table above, in `scripts/make-dataset.ts`. *Check:* over 500 games, replaying the recorded indices through the environment reproduces the teachers' games except where an offer could not be expressed, and the share of such offers is reported.
2. **Write the first file,** measure its size and the rate of writing, size the sets, then write them all. *Check:* the arrays have the stated shapes; the mask always includes the recorded action; `index.json` accounts for every file.
3. **`train/data.py`:** the shuffled reader. *Check:* one pass yields every decision of a set exactly once; two passes come in different orders.
4. **`train/model.py`.** *Check:* an illegal action never has non-zero probability.
5. **Overfit one batch.** Train on 4,096 fixed decisions until the agreement is above 99%. *Check:* it gets there; if not, the encoder or the labels are wrong.
6. **Clone the baseline alone.** One teacher, one table size. *Check:* agreement above 95% on held-out decisions. The baseline is nearly deterministic, so anything less points at missing information in the observation.
6a. **Score the clone as M6 will use it:** drafting off, the baseline proposing on its behalf (`evaluate.ts --proposer baseline`). In M6 a school starts the learner's offers, so the part of the clone's fault that lies in choosing to offer drops out. By the tally that is the smaller part (the clone already takes 74% of the positions the rules would offer in), so the gain should be modest; the task says how modest, and gives M6's step 0d the figure it must reproduce. *Check:* its win share over the same 400 seeds as the figures in Result, beside 24.0% for the rules; and offers sent per game.
6b. **More perturbed games.** Write the corrected baseline set again with one game in two perturbed (`--perturb 0.5`), train as before, score on the same 400 seeds. *Check:* the win share, offers started per game and positions worth an offer per game (`evaluate.ts --tally`), beside the figures in Result for the clones trained with one game in five perturbed: 6.3% to 6.8%, about one offer started a game and 1.3 positions worth one.
6c. **Three more rounds of correction,** each with the latest clone driving one seat of about a million decisions, trained on every set so far. *Check:* the same three figures after each round; the task stops early if two rounds in a row move the win share by less than its interval.
7. **The starting policy** and **the style-conditioned policy.** *Check:* three seeds of each; the validation loss curves and the table of agreement by kind and by teacher are in the runs' directories.
8. **The value network.** *Check:* the calibration table and the log loss beside V1's, on the validation set, for each table size.
9. **`train/export.py`, `src/env/mlp.ts`.** *Check:* the parity test.
10. **`learned-agent.ts`.** *Check:* a clone plays 1,000 games at each size in `simulateGame` with no refused action.
11. **Score the clones** on evaluation seeds. *Check:* a win share with its interval at each size, against an even share and paired against the refuser; a replay is kept of every game.
12. **Open the main lines.** The starting policy is the first holder of `main-2`, `-3` and `-4` in `assets/lines.json`. *Check:* `assets/lines.json` has the three main lines, each held by the starting policy, with its figures.
13. **A clone in the client,** behind a development switch. *Check:* it plays a full game in the dev server and in the installed desktop app; the time for one decision is recorded.
14. **Write up.** *Check:* every figure quoted in the documents can be found in a report under the data directory, the Result section names the command, seeds and commit, and the link check passes.

## Tests

- **Parity.** For 1,000 stored observations, the policy and value from `mlp.ts` match PyTorch's within 1e-3 (the weights are 16-bit), and the most likely action is the same in at least 999.
- **Mask.** The model's distribution is zero outside the mask, in Python and in TypeScript.
- **Round trip.** A weight file written by the export loads in `mlp.ts` with the shapes the record states.
- **Layout.** A model whose record names another layout version is refused.
- **Fallback.** A model that throws makes the agent return the rule-based choice.

## Experiments and cost

All of these depend on the bridge's rate from M4. At the planning figure of 5,000 decisions a second:

| Run | Decisions | Time |
| --- | --- | --- |
| Writing the sets | 120 million decisions, in TypeScript on eight processes | Set by the encoder's rate, which M4 measures in process. At 20,000 decisions a second for a process it is under an hour. |
| A cloning run | Up to three passes over a 60 million decision set | Set by the trainer and the disk, not by the game. Timed on the first pass. Nine runs: three seeds each of two policies and the value network. |
| Scoring a clone | 5,000 games at each size, twice (against an even share, and paired against the refuser) | About ten core-minutes |

## Commands

```sh
node scripts/make-dataset.ts --set teachers-4 --decisions 250000 --out $DATA_DIR/datasets   # the first file, to measure
node scripts/make-dataset.ts --all --workers 8 --out $DATA_DIR/datasets
python train/bc.py --config train/configs/start.yaml --data $DATA_DIR/datasets --run $DATA_DIR/runs/start-s1
python train/export.py --run $DATA_DIR/runs/start-s1 --out assets/models/start
node scripts/evaluate.ts --model assets/models/start.ts --against baseline --size 4 --games 1000 --seeds 1000000
```

## Gate

1. **The style-conditioned policy** agrees with each school on at least 90% of that school's held-out decisions, and on at least 80% of its decisions of each kind.
2. **The starting policy,** as one seat among baselines over 1,000 games on evaluation seeds, wins a share whose interval lies at or above an even share, at each table size. *Read since 20 November, by the author's decision:* against the teacher in the same seat on the same seeds, the bar is met when the paired difference (clone less teacher) has a 95% interval whose lower end is above −3 points, that is, the clone is with that confidence no more than 3 points worse than its teacher. By the author's decision of 19 November it is played as M6 plays it: a school (the baseline) makes its offers and the network every other decision. Drafting its own offers is M9's work, and the clone's weakness there (7% at four players with its own drafting) is recorded for M9, not held against this bar.
3. **The value network** is calibrated within 3 points in every tenth, and its log loss is lower than V1's on the test set at each table size, with the interval of the difference excluding zero.
4. **In the client,** a clone plays a full game in the dev server and in the desktop app, and a decision takes less than 50 ms.

## Decision points

- **Task 5 fails.** Stop. A network that cannot memorise 4,096 decisions means a bug: labels shifted by one step, a mask applied to the wrong row, an observation that does not match its decision.
- **Task 6 falls short of 95%.** List the decisions it gets wrong by kind. A kind with low agreement is one whose observation lacks what the agent used: the usual suspects are the random part of a bid and of an offer's cash, which no observation can supply, and those are judged by level, not by exact match.
- **The clone agrees with its teachers but plays below an even share.** Small errors compound in positions the teachers never visit. Raise the perturbed share of games from one in five to one in two, then add correction in the manner of DAgger: let the clone play, label its positions with the teachers' choices, and train on those.
- **Still below an even share after those** (the state on 18 November 2026, after one round of correction). Decided by the author that day: run tasks 6a to 6c, which are cheap; write M6 meanwhile; and start M6 from the best clone to hand whatever they show. The bar is not lowered. It is reported as unmet until a clone or a learner meets it. The reasoning: a reward reaches positions that imitation does not, and in M6 a school makes the learner's offers, which is the part this clone does worst.
- **The value network does not beat V1.** Check the split first: positions from one game must not sit on both sides. Then train longer. V1 has a few hundred weights and millions of rows; a network needs more data to pass it than to match it.
- **A decision takes too long in the client.** Run the forward pass in a web worker so that the page does not stall; the 850 ms the client already waits before a computer player acts is the budget.

## Feeds back into

- [ai.md](../ai.md): the baselines table gains the starting policy; workstream J is rewritten around the TypeScript forward pass.
- [frontend.md](../frontend.md): how a model is loaded and what happens when it fails.
- M6's settings: the kinds of decision the clone handles worst are the ones to weight in reinforcement learning.

## Out of scope

- Letting a player choose a learned opponent. The switch here is for development; M10 builds the setting.
- Any learning from results. The clones only imitate.

## Result

Run in part on 18 November 2026, unattended; the details are in [log.md](log.md). Only the pipeline and the baseline's clone were built. The plan's teachers are M3's admitted styles; their decision sets were not written, because the clone of the one simple teacher still plays far below it, and that has to be understood first.

| Task | State |
| --- | --- |
| 1. Action indices for teachers | Done. Offers the drafting cannot express (more than one property asked for, or more than one given) are not recorded. |
| 2. Decision sets | Sets of the baseline at four players, not the full sets. The first three recorded every decision with two offers left in the turn, a flaw fixed at 08:28; the corrected pair is `baseline-4-train-2m-v2` (2,286,484 decisions from 2,900 games) and `baseline-4-val-v2` (192,700 from 250). Before the fix: 429,060 decisions from 550 games (`baseline-4-train`, seeds from 3,000,000), 2,125,687 from 2,700 games (`baseline-4-train-2m`, seeds from 3,500,000), and a validation set of 115,898 decisions from 150 games (`baseline-4-val`, seeds from 2,200,000). 2,016 bytes a decision. |
| 3 to 5. Reader, network, overfitting one batch | Done; one batch of 4,096 decisions reaches 99.1% agreement after 1,100 steps. |
| 6. The baseline's clone | Not passed: at best 93.2% agreement on held-out decisions (corrected sets, best epoch; free turn 97.0%) against the bar of 95%. Before the fix, 92.5%, by kind: free turn 95.9%, buy 98.9%, debt 96.4%, received mortgage 98.3%, answering an offer 84.4%, property auction 75.2%, building auction 83.3%. The auctions are held down by the random part of the baseline's bids. |
| 7, 8. Starting policy, style-conditioned policy, value network | Not run (they need M3's teachers). |
| 9. Export and parity | Done: largest difference from PyTorch 6.1e-5; the same most likely legal action in 1,000 of 1,000 positions; 2.1 ms a decision. |
| 10. Learned agent | Done: no refused action over 400 games; 2 fallbacks in 70,064 decisions. |
| 11. Scoring | The clone wins 8.5% (5.8 to 11.2) as the one among three baselines over 400 games, against an even share of 25%. Remedies tried, each scored on the same 400 seeds: one round of correction in the manner of DAgger (1,058,231 decisions with the clone driving one seat), 6.8%; its best epoch, 6.8%; decision sets rebuilt after a flaw was fixed (they had recorded every decision with two offers left in the turn), 6.3% (3.9 to 8.6). Diagnosis with `evaluate.ts --rules-for`: with its free turns made by the rule-based agent the clone wins 23.8%, level with the rules alone (24.0%); with its offers switched off, 5.5%; with the rules making only the decisions where an offer can be started (after the roll), 23.8%, but where building is legal, 8.0%, and where a mortgage can be lifted, 6.8%. Over 100 games the clone starts 0.9 offers a game and builds 7.6 times, against 3.1 and 14.8 for the rules in the same seat: it completes fewer groups because it proposes too rarely, and so has less to build on. Weighting the decisions that start an offer four times (94.7% matched on held-out decisions) leaves it at 6.8% and 1.1 offers a game: in its own games the rules would start an offer only 1.33 times a game, and it takes 74% of those. The clone's games drift away from positions worth an offer. One correction round on the corrected sets (1,132,262 decisions with that clone driving, offers weighted 4; 94.1% agreement) gives 7.5% (4.9 to 10.1), and the same 1.4 positions worth an offer a game. |
| 12 to 14 | Not run. |

**Next,** by the decision of 18 November 2026: tasks 6a, 6b and 6c on the baseline's clone, in that order, since 6a costs minutes and gives M6 its reference figure. Nothing of them has been run.

**Run on 18 and 19 November with the disk** ([log.md](log.md#18-to-19-november-overnight-with-the-disk)).

| Task | Result |
| --- | --- |
| 2 and 6 again, layout version 3 | The sets written again on the same games (2,286,484 and 192,700 decisions, the same counts). The clone: 93.1% agreement. |
| 6a, the baseline proposing for it | 24.8% (26.5% and 23.0% in the halves) on the 400 seeds, against 7.0% with its own drafting and 24.0% for the rules in the same seat. With the baseline proposing, positions worth an offer come up 7.3 times a game against 1.5, and it builds 17.3 times against 7.0. |
| 6b, one game in two perturbed | 93.1% agreement; 7.3% and 23.3%. No change. |
| 6c, correction | Round 1: 94.7%, 6.5% and 22.3%. Round 2: 94.9%, 6.3% and 22.8%. Stopped by the task's rule after two rounds that moved the share by less than its interval. |
| 8, the value network | Three attempts, none meets bar 3. The best (12,000 games a size, a sample of each game's decisions, weight decay): log loss 0.390, 0.402, 0.307 against V1's 0.396, 0.406, 0.554 at two, three and four players, no interval clear of zero; calibration gaps 7.9, 3.8 and 8.8 points. The first overfitted 3,000 games a size. |
| The starting policy, for M6 | A clone over all three sizes wins 40.3%, 21.8% and 15.0% with the baseline proposing; a two-player clone 47.8% (sampling, 47.5%). One size at a time matches the teacher; three together do not, and why is not found. |

So the clone's fault is its own offers, and in M6, where a school makes the learner's offers, a clone of one size starts level with its teacher. Bar 2 is not read: it asks for 1,000 games on evaluation seeds with the clone drafting for itself, which the plan wrote before drafting was split from the rest of play; with the baseline proposing the figure is level with the rules, and with its own drafting far below. Which of the two the bar means is the author's to say. **Decided on 19 November:** the bar is read with the baseline proposing, as M6 plays the learner. On that reading two and four players are level with the rules on 400 seeds (47.8%, 24.8%) and are to be scored again over the bar's 1,000 games on evaluation seeds; three players needs a clone of its own, since one size at a time matches its teacher and the clone of three sizes does not (21.8%). Both wait for the disk, before G3.

**Bar 2 scored, 19 and 20 November** (1,000 games on seeds 1,000,000 to 1,000,999, the baseline making the clone's offers; `--compare baseline` plays the baseline in the clone's seat on the same seeds, and the difference is paired by seed). The three-player clone, `clone-baseline-3-v3`, was trained on the three-player sets written for `clone-baseline-234-v3` (12 epochs, best epoch 11, 92.9% agreement on held-out decisions; auctions 78.4%).

| Players | Clone | Even share | Baseline in the clone's seat | Clone less baseline, paired |
| ---: | --- | ---: | ---: | --- |
| 2 | 50.9% (47.8 to 54.0) | 50.0% | 50.7% | +0.2 (−2.7 to 3.1) |
| 3 | 29.6% (26.8 to 32.4) | 33.3% | 28.9% | +0.7 (−1.9 to 3.3) |
| 4 | 27.5% (24.7 to 30.3) | 25.0% | 25.8% | +1.7 (−0.8 to 4.2) |

At every size the clone is level with its teacher in the same seat. Against the bar's words, "an interval that lies at or above an even share": at two and four players the interval holds the even share but does not lie wholly above it, and at three players it lies wholly below. The three-player figure is held down by the seeds: in `evaluate.ts`'s own game loop with the baseline in every seat, seat 1 wins 28.9% on these 1,000 seeds, 32.6% on the next 1,000 and 34.5% on the 1,000 after (32.0% over the 3,000, within chance of an even share; `$DATA_DIR/checks/evaluate-loop-baseline-seats-3.txt`). So on these seeds no copy of the teacher would meet the bar at three players either. Read wholly above an even share, the bar asks the clone to beat its teacher, which a clone is not trained to do. How the bar is read is the author's to say: against an even share as written, against the teacher in the same seat on the same seeds, or over more seeds.

**Decided on 20 November:** the bar is read against the teacher in the same seat on the same seeds: met when the lower end of the paired difference's interval is above −3 points. The reasons: the clone's task is to imitate its teacher, so that M6 starts from the teacher's level, and a clone is not trained to beat it; a comparison on the same seeds takes out the luck of the seeds, as at three players here; and pairing narrows the interval (about ±2.5 points against ±4 over 1,000 games). A gap of 3 points is small beside what M6's training changes. **Bar 2 is met** at every size: lower ends −2.7, −1.9 and −0.8 points at two, three and four players. (With a margin of 2 points, two players would miss by 0.7.)

**Gate:** not met. Bar 2 is met (20 November, read against the teacher; see above). Bars 1 and 3 need the teachers and the value network. *Decided on 20 November:* V1 stays the valuation in use; the value network gets one more attempt with more data when the machine is free, and bar 3 stays as written. Bar 1 (the style-conditioned policy) is done before M8, which is the first stage to need it. Bar 4's timing part is met in the engine (2.1 to 4.3 ms a decision against 50 ms); the client was not tried.

Commands: `node scripts/make-dataset.ts --out $DATA_DIR/datasets --set <name> --size 4 --decisions <n> --seeds <start> [--learner <model.ts>]`; `train/.venv/bin/python train/bc.py --data <set>[,<set>] --val <set> --run $DATA_DIR/runs/<name> --epochs 12`; `train/.venv/bin/python train/export.py --run $DATA_DIR/runs/<name> --out $DATA_DIR/models/<name>`; `node scripts/evaluate.ts --model $DATA_DIR/models/<name>.ts --size 4 --games 400`.
