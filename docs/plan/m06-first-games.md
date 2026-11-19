# M6. Reinforcement learning: the first games

## Purpose

To get a learner that improves on its teachers by playing, on the three easiest games in turn: two players, then four players in the short game, then three players. These are steps G1 to G3 of [ai.md](../ai.md). The stage is as much about making the training loop trustworthy as about the result: it starts with checks that can only fail for a plain reason, and it fixes in advance what counts as progress, what a run may cost, and what is done when a run stalls.

## Deliverables

| File | Contents |
| --- | --- |
| `train/rollout.py` | Collects decisions from the environments into one sequence for each learner seat. |
| `train/ppo.py` | The losses and the update. |
| `train/opponents.py` | Chooses each game's table from the league. |
| `train/run.py` | The training loop: schedules, checkpoints, metrics, checks. |
| `train/configs/g1.json`, `g2.json`, `g3.json` | The runs. JSON, since no YAML reader is installed and none is to be added. |
| `scripts/evaluate.ts` | Scores an exported model against league members, in TypeScript, without the bridge. Keeps a replay of every game it plays. |
| `scripts/replay.ts` | Turns a kept game (a seed, the seats and the list of actions) into a saved game the client opens, so that any game of a check, a gate or a match can be watched. |
| `train/tests/` | Tests of the return calculation and of the loop on toy problems. |

## Specification

### Sequences and returns

A learner seat's experience in one game is a sequence of its own decisions. Between two of them other seats act and the game moves on; what the seat receives for that stretch is credited to the earlier decision.

For decision `t` of a seat, with potentials `phi_k` reported by the environment and weights `w_k`:

```text
r_t = Σ_k w_k · (γ · phi_k(t+1) − phi_k(t))                 between two decisions
r_T = Σ_k w_k · (0 − phi_k(T)) + R                          at the seat's last decision of a finished game
R   = +1 for the winner; −1 / (players − 1) for each of the others
```

- **Advantages** by generalized advantage estimation over the seat's sequence, with γ = 0.999 and λ = 0.95, counted in the seat's decisions.
- **A game cut off** at the turn limit has no `R`. The sequence is closed with the critic's value of the seat's last observation.
- **A sequence still open** when an update is taken is closed, for that update, with the critic's value of its latest observation; its last decision, whose successor has not arrived, is held over to the next update.
- **The critic** predicts the return as defined here, shaping included, for the seat that decides.

### The update

Proximal policy optimization with a clipped objective, started from the starting policy of M5 and the value network's trunk. By the decision of 18 November 2026 the stage may start before M5's gate is met, from the best clone of the baseline to hand and, where no value network exists yet, a critic trained from nothing for the first million decisions with the policy frozen. Step 0d below then reproduces that clone's figure, whatever it is.

| Setting | Start |
| --- | --- |
| Environments | 8 workers × 64 |
| Decisions in an update | 131,072 |
| Epochs, minibatch | 4; 4,096 |
| Clip range | 0.2 |
| Learning rate | 3e-4, falling in a straight line to zero over the budget |
| Value loss weight; gradient clip | 0.5; 0.5 |
| Entropy bonus | 0.01 falling to 0.001; halved for the roll and the end of a turn, doubled for bids |
| Advantages | Normalized within the batch, separately for each kind of decision that has at least 64 decisions in it |
| Loss weight by kind | As in M5: 1, 2 and 4 |
| Side predictions | The M5 targets, at 0.1 times their loss |

**Staying near the teachers.** The loss also carries `κ · KL(starting policy ‖ policy)` on every decision, with κ falling in a straight line from 1 to 0 over the first fifth of the budget.

**Shaping schedule.** The weight of `value` starts at 1 and falls to 0 by 70% of the budget. The milestone potentials (`groups`, `built3`, `passes`, `rentRoll`, `denial`, `safety`) start at 0.2 each and fall to 0 by 30%. The last 30% of every run is trained on the result alone.

### Opponents

For each game, by the environment's configuration, which `train/opponents.py` rewrites every twenty updates:

| Share of games | Table |
| --- | --- |
| 20% | The learner among baselines. |
| 20% | The learner among copies of itself (every seat a learner). |
| 10% | The learner among copies of the holder of its own line: the best version so far. |
| 50% | The learner among league members meant for the size, each seat drawn by a weight. Every earlier holder is among them. |

The weight of member `m` is `(1 − s_m)² + 0.02`, where `s_m` is the learner's win share over its last 500 games at a table with `m` in it, divided by an even share and capped at 1. A member the learner seldom beats is met often; one it always beats is still met a little.

Until M9, drafting is off and a school proposes on the learner's behalf: the baseline at first. The proposer is a setting. Once [M3b](m03b-table-politics.md) has measured its schools, the one that proposes best there (asking early, by value) is tried in the baseline's place, in task 6a.

### Checks during training

`scripts/evaluate.ts --model <weight file> --against <member> --size <n> --games <g> --seeds <start> [--pair <member>]` plays the model as one seat among copies of a member and prints the win share with its interval; with `--pair` it plays a second agent on the same seeds and seats and prints the difference. It runs the TypeScript forward pass, so it needs neither Python nor the bridge.

| When | What | Seeds |
| --- | --- | --- |
| Every 20 updates | 500 games against baselines at each size in training. The progress curve. | From 2,500,000 |
| Every 100 updates | 1,000 games against baselines and 1,000 against each of the three members the learner does worst against. A checkpoint is kept. | From 2,500,000 |
| When a check puts the learner 2 points above the figure recorded for the holder, and at the end of every budget | A promotion match against the holder, by the rule in [README.md](README.md#new-against-best). | From 1,500,000, each seed used once |
| When a holder is put forward for a gate | The gate's games. | From 1,000,000, each seed used for one gate attempt only |

A checkpoint is chosen on the checks, must then take the title from the holder in a promotion match, and only as holder is tested once on evaluation seeds. If it fails the gate, the next attempt uses fresh evaluation seeds. The first holder of each `main` line is the starting policy of M5, so the first match of this stage is the learner against the clone it started from.

**Logged at every update:** the win share against baselines from the latest check; the mean result and each potential's contribution to the return; the policy's entropy, the value loss and the policy loss, by kind of decision; the share of clipped updates; the KL from the starting policy; game length and the share of games cut off; buildings bought by level; offers answered and the share accepted; and, from the checks, complete groups held at round 20 and positions worth an offer per game by the rule-based agent's test, the two figures that M5's clone fell short on.

### A run on disk

Every run has a directory under `$DATA_DIR/runs/`, and everything about it is there.

```text
runs/g1-s1/
  config.yaml          the configuration as it ran
  commit.txt           the commit, and whether the working tree was clean
  metrics.jsonl        one line for each update
  checks.jsonl         one line for each check, with the seeds it used
  checkpoints/         00020.pt, 00040.pt, ...: weights, optimizer, schedules, the opponents' books
  exports/             the weight files written for the checks
  chosen.txt           the checkpoint put forward, once one is
```

`python train/run.py --resume $DATA_DIR/runs/g1-s1` continues from the latest checkpoint: the update count, the schedules, the environments' seed positions and the opponents' books are all in it, so a resumed run and an uninterrupted one see the same games.

A line of `metrics.jsonl`: `update`, `decisions`, `seconds`; `return` and its parts (`result`, and one for each potential); for each kind of decision `entropy`, `policyLoss`, `valueLoss`, `clipped`, `count`; `klFromStart`; `turns`, `cutOff`; `builtByLevel`; `offersAnswered`, `offersAccepted`; the weights in force for every scheduled quantity.

The configuration of G1, in full. Every later run is this file with changes.

```yaml
name: g1-s1
seed: 1
start: runs/start-s1/chosen            # the starting policy of M5
budget: 50_000_000                     # learner decisions
env:
  players: 2
  rules: full
  turnLimit: { 2: 310, 3: 360, 4: 410 }
  potentials: [value, groups, built3, passes, rentRoll, denial, safety]
  drafting: false
  proposer: baseline
  maxProposals: 2
  workers: 8
  envsPerWorker: 64
  seeds: { start: 10_000_000 }
opponents:
  baselines: 0.2
  copies: 0.2
  holder: 0.1
  league: 0.5
  weight: { power: 2, floor: 0.02, window: 500 }
  refreshEvery: 20                     # updates
ppo:
  decisionsPerUpdate: 131072
  epochs: 4
  minibatch: 4096
  clip: 0.2
  learningRate: { start: 3.0e-4, end: 0 }
  gamma: 0.999
  lambda: 0.95
  valueWeight: 0.5
  gradClip: 0.5
  entropy: { start: 0.01, end: 0.001, byKind: { roll: 0.5, endTurn: 0.5, bid: 2.0 } }
  kindWeights: { freeTurn: 1, buy: 2, bid: 2, debt: 2, offer: 4 }
  sideWeight: 0.1
shaping:
  value: { start: 1.0, zeroAt: 0.7 }       # fractions of the budget
  milestones: { each: 0.2, zeroAt: 0.3 }
pull: { start: 1.0, zeroAt: 0.2 }          # toward the starting policy
checks:
  quick: { every: 20, games: 500 }
  full: { every: 100, games: 1000, hardest: 3 }
  seeds: 2_500_000
promotion: { margin: 0.02 }                # call a match when a check is this far above the holder's figure
```

**The machine.** The network is small. A run uses the processor unless the machine's graphics backend is measured to be faster over the first hundred updates; the choice is recorded in `metrics.jsonl`.

### The order of work

Each step must pass before the next starts.

| Step | Run | Passes when |
| --- | --- | --- |
| 0a | **A toy.** The update on a one-decision problem where one of four legal actions pays 1. | The policy puts over 95% on that action within 50 updates. |
| 0b | **Returns by hand.** A sequence of five decisions with known potentials and a known result. | The code's returns and advantages equal the ones worked out on paper. |
| 0c | **From nothing, against random play.** Two players, no starting policy, no shaping, opponents all random. | Over 80% against random players within 10 million decisions. The rule-based agent wins 91%. |
| 0d | **From the clone, against baselines, no learning.** Learning rate zero. | The check reproduces the clone's figure from M5 within its interval. This catches a mismatch between training and scoring. |
| G1 | Two players, full game. | The gate below. |
| G2 | Four players, short game, with one game in five still at two players. | The gate below; G1's figure has not fallen below its bar. |
| G3 | Three players, full game, with one game in five at each of the earlier sizes. | The gate below; the earlier figures have not fallen below their bars. |

### Budgets

The decisions a run may use before it is judged. They are first guesses.

| Run | Budget | At 5,000 decisions a second |
| --- | --- | --- |
| 0c | 10 million | 35 minutes |
| G1, first run | 50 million | 2.8 hours |
| G2, G3 | 50 million each | 2.8 hours each |
| A sweep setting | 20 million | 1.1 hours |

**Tuning,** once a run has shown any improvement over the clone: one setting at a time around the start, each for 20 million decisions, judged on the checks: learning rate 1e-4 and 1e-3; entropy 0.003 and 0.03; γ 0.995; λ 0.9; the value potential's weight 0.5 and 2; no milestone potentials. The chosen configuration is then run with three seeds, and the gate is read from the median run.

## Tasks

1. **`rollout.py`.** *Check:* step 0b.
2. **`ppo.py`.** *Check:* step 0a.
3. **`scripts/evaluate.ts`.** *Check:* it reproduces M5's figure for the clone.
4. **`run.py`:** schedules, checkpoints, logging, the checks run in the background. *Check:* steps 0c and 0d.
5. **`opponents.py`.** *Check:* over 1,000 sampled games the shares of the four kinds of table are within 3 points of 20, 20, 10 and 50.
6. **Measure the refuser in the four-player short game:** 20,000 games as the one among baselines, by the study. It is G2's second bar. *Check:* the figure and its interval are written into this file's gate.
6a. **Choose the proposer,** once M3b's schools are measured: the first 20 million decisions of G2 run twice, with the baseline and with M3b's best proposer making the learner's offers. *Check:* the two progress curves and the complete groups held at round 20 under each; the choice is recorded with both figures.
7. **G1:** the first run; the tuning; three seeds. *Check:* the gate for G1, read from the median of three seeds.
8. **G2,** then **G3.** *Check:* the gates for G2 and G3; G1's figure, checked again, has not fallen below its bar.
9. **Promotion.** After each of G1, G2 and G3 the chosen checkpoint plays the holder of its line. The ladder of each line is written. *Check:* `assets/lines.json` and the ladders are updated after each.
10. **Add the learner to the league** as a member; rerun the league report for the sizes it plays. *Check:* the league report's rows for the learner agree with the gate's figures within their intervals.
11. **Write up,** with the progress curves and the ladders. *Check:* every figure quoted in the documents can be found in a report under the data directory, the Result section names the command, seeds and commit, and the link check passes.

## Tests

- Returns and advantages on hand-worked sequences, including a cut-off game and a sequence left open at an update.
- The result sums to zero over the seats of a finished game.
- A sequence's shaping terms sum to minus its first potential when the game finishes, whatever happened in between.
- The toy problem of step 0a, as a test that runs in seconds.
- A checkpoint saved and loaded gives the same actions.

## Experiments and cost

In learner decisions, and in time at the planning rate of 5,000 a second, which M4 replaces with a measured one.

| Run | Decisions | Time |
| --- | ---: | --- |
| Steps 0a to 0d | 10 million, nearly all in 0c | 35 minutes |
| G1: a first run, eight tuning settings, then two more seeds of the chosen one | 50 + 160 + 100 = 310 million | 17 hours |
| G2 and G3, three seeds each | 300 million | 17 hours |
| Checks: 500 games every 20 updates, 4,000 every 100 | About 15% on top of a run's own games, in engine time | Run on spare processes while training continues |
| A promotion match | 8,000 games with the network at every decision of a learned seat | Minutes |
| The gates | 6,000 games each | Minutes |

About 620 million decisions in all, a day and a half at the planning rate. The first run of G1 is the one that says whether the rest is worth starting.

## Commands

```sh
python train/run.py --config train/configs/g1.json --run $DATA_DIR/runs/g1-s1
python train/run.py --resume $DATA_DIR/runs/g1-s1
node scripts/evaluate.ts --model $DATA_DIR/runs/g1-s1/exports/00100.ts --against baseline --size 2 --games 500 --seeds 2500000
node scripts/evaluate.ts --model <weights> --against baseline --pair refuser --size 2 --games 5000 --seeds 1000000
node scripts/promote.ts --line main-2 --challenger $DATA_DIR/runs/g1-s1/exports/00380.ts
node scripts/replay.ts --file $DATA_DIR/replays/main-2/1500017.json          # opens a kept game in the client
```

## Gate

For each of G1, G2 and G3, on evaluation seeds, as one learner among baselines with seats rotated:

1. Over 1,000 games, a win share whose interval lies above an even share.
2. Over 5,000 paired games, a win share above the refuser's in the same seats, with the interval of the difference above zero. In the full game the refuser wins 58.2% with two players and 41.0% with three; its figure in the four-player short game comes from task 6.
3. The share of games cut off at the turn limit is under 2%.
4. The agent that passes is the holder of its line: it won its promotion match against the version before it, and no earlier holder beats it on the ladder by more than the interval.

## Decision points

- **Step 0c fails.** The loop is wrong, not the game. Check in order: the mask reaches the loss; rewards are credited to the right seat; a won game returns +1 at the end; the advantages are not all near zero.
- **A run does not improve on the clone within its budget.** In order: read the curves for a collapse of entropy (raise the bonus) or a policy that has left the clone and not come back (hold κ longer); run without shaping to see whether shaping is the cause; run against baselines only, to see whether the opponents are; double the budget once. If none of these moves the curve, the stage stops and the finding is written up: the next lever is the network (treating the properties as a set) or looking ahead (workstream I), and that is a decision for a person.
- **The learner starts below an even share and stays there** (it began from a clone that had not met M5's bar). Read the two figures logged from the checks. If positions worth an offer stay near the clone's 1.3 a game while the rules reach 3.1, the learner is still not building toward groups: hold the `groups` and `reach` potentials at 0.2 for the first half of the budget instead of 30%, and seat a proposer that asks early (task 6a). If they recover and the win share does not, the gap is elsewhere, and the hybrids of M5 (`evaluate.ts --rules-for`) say where.
- **The learner clears an even share and not the refuser.** It has probably learned to refuse. Look at the share of offers it accepts. Raise the share of games against members that trade well and against copies of itself, where refusing wins nothing.
- **The share of games cut off rises.** Lengthening the limit hides the problem. Look for a table of learners that neither trade nor build, and add the `eliminations` and `rentRoll` potentials back for longer.
- **A later step undoes an earlier one.** Raise the earlier sizes' share of games from one in five to one in three.
- **A challenger passes the gate's bars and loses its promotion match.** It is good enough and not better. The holder stays, the challenger joins the league as a member, and the run continues or is tuned. A gate is never read from an agent that is not the holder.
- **The ladder shows an earlier holder beating the new one.** Double that holder's share among the opponents for the next run, as the rule says, and report the cycle if it persists after one run.

## Feeds back into

- [ai.md](../ai.md): the baselines table gains the learner at each size; the open question on how much compute reinforcement learning needs gets its first real figure.
- [statistics.md](../statistics.md): the study run with the learner as the odd player, and what it does differently by the behaviour descriptors.
- M7's budgets, which are scaled from what these runs needed.

## Out of scope

- The full four-player game, and separate agents for each size. That is M7.
- Learners that make their own offers. That is M9.
- Style learners, exploiters and the reward search. That is M8.

## Result

Not yet run.

**Written,** on 18 November 2026 with the data disk away: tasks 1 to 5, as code and tests.

| Task | State |
| --- | --- |
| 1. `rollout.py` | Rewards, advantages and the collector of sequences. Step 0b passes as a test: a finished game, a cut-off game and a sequence open at an update, each worked by hand. |
| 2. `ppo.py` | The clipped update with advantages normalized by kind, entropy and loss weights by kind, and the pull toward a starting policy. Step 0a passes as a test: the policy puts over 95% on the one action of four that pays within 50 updates. |
| 3. `scripts/evaluate.ts` | Existed from M5; gained `--proposer`, which is how a learner plays in this stage. |
| 4. `run.py` | Schedules, checkpoints, resuming, metrics, checks in the background. A trial of four updates of 600 decisions on 16 environments ran through the bridge, redrew its tables, saved, and resumed. Steps 0c and 0d are runs and wait for the disk. |
| 5. `opponents.py` | The four kinds of table and the weights by the learner's latest results. Over 1,000 draws the shares are within 3 points of 20, 20, 10 and 50. |

21 tests in `train/tests/`, run with `train/.venv/bin/python -m unittest discover -s train/tests -t train`.

**What differs from the specification above:**

- The runs' configurations are JSON, and a game (table size and rules) is drawn for each worker by its share, which is how one game in five is kept at an earlier size.
- A kind of table is drawn for each worker and drawn again every twenty updates, since a worker's environments share one configuration. Over a run the shares are the specification's.
- The seat of the holder of the learner's own line is filled by the baseline until a learned member can be seated by name in the environment. That is needed before the first promotion match, not before G1's first run.
- While a critic is warmed up under a frozen policy (`critic_warmup`), only the value loss moves the network.
- The side predictions are not in the update yet: their targets are not collected. They are behind the plan's own switch and are added before G1's tuning.

The first run starts from a clone of layout version 3 (see [m05](m05-supervised.md)), not from the clones of 18 November.

**Run on 19 November with the disk** ([log.md](log.md#18-to-19-november-overnight-with-the-disk)):

| Step | Result |
| --- | --- |
| 0a, 0b | Pass as tests (and a test now pins where the table size sits in the observation, after the model read it one place off). |
| 0c | Not passed, and the step's assumption does not hold: a learner initialised at random picks evenly among legal actions, mortgages and lifts mortgages over and over, and is bankrupt in 34 turns on average, where the random agent is weighted to keep games moving. It lost every game in 1.44 million decisions, so the result alone gave no signal. The rerun with the value potential on (`train/configs/step0c-shaped.json`) won 0% of its training games for the first million decisions, 32% at 4.5 million and 51% at 5.1 million (update 39), when the runs stopped with the session; it resumes from update 20, and the bar is read from its checks. |
| 0d | Passed: with the two-player clone and learning rate zero, 50.0% over 8,699 training games against baselines, inside the evaluated 47.5% (42.6 to 52.4). |
| G1, first run | Started at 03:21 from the two-player clone, the critic alone for two million decisions. At 8.5 million decisions its training games against baselines and the league stood at 54% against the clone's 47.5%; that is not a check and not a gate. Its checks every 20 updates (500 games against the baseline with the baseline proposing, seeds from 2,500,000, `runs/g1-s1/checks.jsonl`): 48.6% (44.2 to 53.0) at update 20, 51.2% at 40, 56.2% (51.9 to 60.5) at 60, 66.8% (62.7 to 70.9) at 80, 77.4% (73.7 to 81.1) at 100, 86.6% (83.6 to 89.6) at 120 and at 140, 87.4% at 160, **90.6% (88.0 to 93.2) at 180**, then between 88.0% and 90.0% at every check to the end (update 383, 50.0 million decisions, at 13:12 on 19 November, 9 hours 51 minutes), with no refused action and at most 2 fallbacks in about 180,000 decisions. These are training checks on seeds the checkpoint is chosen on, not the stage's evaluation; the gate is read on evaluation seeds once the run ends. Whether the gain is more than an exploit of the baseline, the export of update 120 against the holder of the two-player style line, found-2-b1t2p2c1 (87.1% among baselines at its admission), on check seeds: **70.9% (65.7 to 76.1)** of 292 finished games of 300 (`gate/g1/u120-against-style-2-check.txt`); against the refuser, which beats the baseline by not selling, **84.9% (80.7 to 89.0)** of 284 finished games of 300 (`u120-against-refuser-check.txt`). The share cut off, 2.7% and 5.3%, is above bar 3's 2% in both. |
| G1's gate, first seed | Read from the export with the best training check (update 180), on evaluation seeds, as the one learner among baselines with the baseline proposing (`queue/g1-gate.sh`, `gate/g1/`). **Bar 1 passed:** 89.5% (87.6 to 91.4) over 1,000 games, seeds 1,000,000 to 1,000,999. **Bar 2 passed:** 89.3% over 5,000 games (seeds 1,000,000 to 1,004,999; 89.5%, 91.5%, 88.6%, 88.3% and 88.4% by thousand) against 58.1% for the refuser on the same seeds, +31.2 points (29.6 to 32.8, treating the two as independent; `evaluate.ts` has no paired mode). **Bar 3 passed** against the baseline: no game of 5,000 was cut off. **Bar 4 not read:** league members can now be named `model:<path>` (`src/sim/league.ts`, `scripts/model-loader.ts`, 2 tests), so `promote.ts` can play a learner; `main-2` was opened with the two-player clone as holder and G1's match against it started, and stopped with the session before it wrote anything. The plan reads the gate from the median of three seeds; seeds 2 and 3, the match and the scores against other opponents on evaluation seeds wait in `$DATA_DIR/queue/resume.sh`. |
