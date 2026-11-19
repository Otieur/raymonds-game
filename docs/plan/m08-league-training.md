# M8. League training and the reward search

## Purpose

To make the agents hard to beat by any kind of opponent, to produce learned opponents that play in different ways, to learn when it pays to change from one way of playing to another, and to find out which reward signals earn their place. It is step G5 of [ai.md](../ai.md), and it is where requirements R1, R2 and R4 are settled: the final agent holds up against every school and every style it was started from; several learned schools exist beside it; and every reward term is kept or dropped by an ablation, not by taste.

## Deliverables

| File | Contents |
| --- | --- |
| `train/league_run.py` | Runs main agents, style learners and exploiters together and keeps the league's books. |
| `train/conductor.py`, `train/configs/conductor-*.yaml` | The conductor: a learner that chooses which school plays its seat, turn by turn. |
| `scripts/conductor-report.ts` | When the conductor plays which school, by position. |
| `train/reward_search.py` | The search over reward weights. |
| `train/ablate.py` | Runs the final recipe with one part removed. |
| `train/configs/style-*.yaml`, `exploiter.yaml`, `league.yaml` | The runs. |
| `assets/models/` | The style learners that are admitted, and the final main agents. |

## Specification

### Three kinds of learner

| Learner | Starts from | Plays against | Rewarded by | Joins the league |
| --- | --- | --- | --- | --- |
| **Main agent,** one for each shipped size | The holder of `main-<n>` from M7 | The whole league, by the weights of M6, with exploiters weighted double and one seat in ten for the holder of its own line | The result alone | Its checkpoints, as past selves; each new holder, by a promotion match |
| **Style learner** | The starting policy of M5 | Baselines and schools, in equal parts | The result, plus its style's potentials at fixed weights for the whole run | When it passes admission |
| **Exploiter** | The starting policy of M5 | The frozen main agent only: one learner among copies of it | The result alone | When it passes admission |

### Style learners

A style learner is a school that is learned instead of written. Its character comes from potentials that are never switched off. Six to start, each for one table size at first (four players, where the kinds differ most) and repeated at the others if it is admitted:

| Style | Potentials kept on, with weights |
| --- | --- |
| Landlord | `built3` 0.5, `rentRoll` 0.5 |
| Pass baron | `passes` 1.0 |
| Blocker | `denial` 1.0 |
| Hoarder | `funds` 0.5, `safety` 0.5 |
| Raider | `eliminations` 1.0 |
| Warden | `threatDenial` 1.0, the thirteenth potential, from [M3b](m03b-table-politics.md) |

A seventh uses the by-place result (from +1 for first to −1 for last, evenly spaced) and no potentials: the survivor, which would rather come second than last.

Each trains for 50 million decisions. **Admission:** over 2,000 games as the one among baselines on seeds from 2,500,000, at least an even share; and its behaviour, by the descriptors of M2, lies outside the range of every other member on at least one descriptor by more than the interval. A style learner that plays like the main agent adds nothing and is not admitted.

### Exploiters

After every 50 million decisions of a main agent, a fresh exploiter is trained against that agent's frozen checkpoint for 20 million decisions. Its win share as the one among copies of the main agent is the **exploitability figure** for that checkpoint.

**Admission:** over 2,000 games on seeds from 2,500,000, a win share at least 5 points above an even share. An admitted exploiter joins the league, the main agent meets it at double weight, and its record states what it does, by the descriptors and by watching replays: the point is to learn what the hole was.

### The conductor

A school is a fixed way of playing, and M3 searched for written rules that switch between schools. The conductor learns the switching. It makes no moves itself. At the start of each of its own turns it looks at the position and chooses which school will play its seat until its next turn; a rule-based agent with that school's style then makes every move, answer and bid.

| | |
| --- | --- |
| **Its choices** | Twelve schools for a table size: the holder of the style line, and the best admitted style of eleven other cells of M3's archive, chosen to be as unlike each other as the descriptors allow. At three and four players at least three of the twelve are schools of M3b that passed its gate (one that asks early, one that denies, one that answers by the deal sheet), so that the conductor can choose to play the table and its report can say when it does. A second version chooses a school for each of the seven parts of a style in turn, seven choices of twelve. |
| **What it sees, from M3b** | Layout version 3, and so what has passed between each pair of seats and every seat's risk. The four new signals (`threat`, `gap`, `failing`, `shunned`) are in the report's table beside the twenty-one. |
| **What it sees** | The observation of M4, and which school is in force now (twelve more numbers). The signals of M2 are already in the observation under other names. |
| **The environment** | `mode: 'conduct'`. A learner step is a choice among twelve; the environment plays the turn with that school and returns at the seat's next turn, or at once if an offer or an auction needs an answer that the school gives. About 47 decisions a game for a seat with four players, and 73 with two. |
| **The network** | Two layers of 256 on the observation; a policy over the twelve; a value. |
| **Reward** | The result alone. |
| **Training** | The update of M6 with 16,384 decisions in an update. Opponents by the weights of M6. Five million decisions to start, which is about 100,000 four-player games: under an hour of engine time on eight processes, since no network runs at the moves. |

It is the cheapest learner in the plan, because the schools carry the moves, and the most readable, because every choice has a name.

**What it reports.** `scripts/conductor-report.ts` plays the trained conductor for 20,000 games and prints: the share of its turns under each school; how often it changes, and from which school to which; and for each of the twenty-one signals, split at its median over the conductor's turns, which schools are chosen more above the split than below. That last table is the learned answer to the question a player asks: when the position looks like this, how should I be playing?

**What it is compared with,** at each table size, as the one among baselines on the same 5,000 seeds and head to head by the promotion match:

| Against | The question |
| --- | --- |
| The best single school among its twelve | Does changing schools beat staying with the best one? If not, the conductor has learned to pick that school and stay, and that is the finding. |
| The best playbook of M3 | Does learned switching beat written rules? |
| The holder of the main line | How far is a player made of rule-based schools from one that learned every move? |

The best conductor of a size opens `conductor-<n>`. It joins the league as a member, and M10 offers it as an opponent that visibly changes its plan.

**The main agent, read the same way.** The main agent has no school at all; every move comes from the position. To see whether it has nevertheless learned to change its way of playing, its games are cut into the opening (before round 10), the middle (rounds 10 to 30) and the endgame, the behaviour descriptors of M2 are taken for each stretch, and the nearest school by those descriptors is named for each. The report gives that table for each table size, and for games it is winning and games it is losing.

### The league run

One process keeps the books; the learners take turns on the workers.

1. The main agent of a size trains for 50 million decisions.
2. An exploiter is trained against it.
3. The league report of M3 is run for that size, at 500 games a pair, with every learned member in. With it, at three and four players, M3b's named tables: two seats of the main agent with the holder of the style line and a baseline, against the same table with two baselines in their place, 2,000 games each on the same seeds. The report gives the two seats' share, the leader's conversion, and the share of offers the main agent accepts by the proposer's rank.
4. Steps 1 to 3 repeat until the gate is met or four rounds pass without the exploitability figure falling.

The style learners and the conductor are trained once, before the first round, so that the main agent meets them from the start. After each round the main agent's best checkpoint by the checks plays the holder of its line, and takes the line if it wins.

### The reward search

Which potentials help a main agent learn, and at what weight, is searched, not chosen. The search runs before the league run, from M7's checkpoint for the four-player game, where learning is slowest.

| Setting | Value |
| --- | --- |
| Population | 8 runs from the same checkpoint |
| What differs | The weight of each of the thirteen potentials (drawn from 0, 0.1, 0.3, 1 at the start), and the fraction of the run by which the weights fall to zero (0.3, 0.5, 0.7) |
| A round | 10 million decisions for each run |
| Judged by | Win share over 1,000 games against baselines and 1,000 against the three hardest league members, on seeds from 2,500,000. Never by a run's own shaped return. |
| After each round | The two lowest runs take the weights and the network of the two highest, with each weight multiplied by 0.8 or 1.25 at random |
| Rounds | 6 |

Whatever the weights, the last 30% of the league run that follows is trained on the result alone.

### The ablation

The final recipe is run again with one part removed, three seeds each, 30 million decisions from the same checkpoint, at four players:

| Removed | What it tests |
| --- | --- |
| Nothing | The reference. |
| The `value` potential | Whether shaping by the valuation helps. |
| All milestone potentials | Whether the named signals help beyond the valuation. |
| Each potential the search kept, one at a time | Whether that signal earns its place. |
| The side predictions | Whether they help. |
| Weighted opponents (uniform over the league instead) | Whether meeting hard opponents more often helps. |
| Normalizing advantages by kind of decision | Whether it helps. |

Each is judged as the search judges. A part stays in the recipe only if removing it lowers the win share by more than the interval, in the median of three seeds. The table goes into ai.md as it comes out, including the rows that show a part made no difference.

## Tasks

1. **`train/league_run.py`:** the books (who has played whom, with what result), the turn-taking, admission. *Check:* the restart test; a trial round of one million decisions with one exploiter completes and leaves the books consistent.
2. **The style learners.** Train, test for admission, export those admitted, add them to the league. *Check:* the admission table: each style learner's win share and the descriptor by which it differs from every other member, or the reason it was not admitted.
3. **The conductor:** `conduct` mode in the environment; the twelve schools for each size; training; the report; the three comparisons. *Check:* a conductor allowed only one school reproduces that school's win share within its interval.
4. **`train/reward_search.py`** and the search. *Check:* the table of the six rounds: every run's weights and its score, and which runs were replaced.
5. **The league run** for each shipped size, with a promotion match after each round. *Check:* the exploitability figure is recorded after every round, and a promotion match after every round.
6. **`train/ablate.py`** and the ablation. *Check:* every row has three seeds and an interval.
7. **The league report** at full size, on evaluation seeds, with every member. *Check:* the bars of G5.
8. **The main agent by stretch of the game:** the table of nearest schools. *Check:* the table names a nearest school for each stretch of the game at each table size.
9. **Rerun the study** with the final agents, the style learners and the conductor. *Check:* the study completes with each as the odd player and prints its descriptors.
10. **Write up:** the ablation table, what each exploiter found, when the conductor changes school, the ladders, the final league report. *Check:* every figure quoted in the documents can be found in a report under the data directory, the Result section names the command, seeds and commit, and the link check passes.

## Tests

- The books survive a restart: a run stopped and resumed gives the same opponent weights.
- An exploiter's environment contains only the frozen agent besides itself.
- A style learner's potentials keep their weights to the last update; a main agent's are zero for the last 30%.
- The by-place result sums to zero over a table.

## Experiments and cost

At the planning rate of 5,000 decisions a second.

| Run | Decisions | Time |
| --- | --- | --- |
| Seven style learners | 350 million | 19 hours |
| The conductor, three sizes, both versions | About 30 million conductor decisions | No network at the moves: about two hours of engine time on one core, and the cost of encoding an observation at each choice |
| Reward search | 8 × 6 × 10 million = 480 million | 27 hours |
| League run, one size, four rounds | 4 × (50 + 20) million = 280 million | 16 hours, and the league reports |
| Ablation, about ten rows | 10 × 3 × 30 million = 900 million | 50 hours |

This is the most expensive stage by far. If M4's rate is well below the planning figure, the ablation is cut first to one seed for each row and marked as indicative; then the reward search to four runs.

## Commands

```sh
python train/run.py --config train/configs/style-landlord.yaml --run $DATA_DIR/runs/style-landlord-4
python train/conductor.py --config train/configs/conductor-4.yaml --run $DATA_DIR/runs/conductor-4
node scripts/conductor-report.ts --model $DATA_DIR/runs/conductor-4/exports/chosen.ts --size 4 --games 20000
python train/reward_search.py --from $DATA_DIR/runs/g4-s1 --rounds 6 --run $DATA_DIR/runs/rewards-4
python train/league_run.py --config train/configs/league.yaml --size 4 --run $DATA_DIR/runs/league-4
python train/ablate.py --from $DATA_DIR/runs/league-4 --row no-value --seeds 3
```

## Gate

**G5,** at each shipped size, on evaluation seeds, 2,000 games for each pair:

1. As the one among copies of each league member (fixed, school, found, style learner, exploiter and past self), the main agent wins more than an even share. Its worst row is recorded.
2. No league member wins more than an even share as the one among copies of the main agent, by more than the interval.
3. The latest exploiter's win share is within 5 points of an even share.
4. The ablation table is complete.
5. At least three style learners are in the league.
6. The conductor has been trained at each size, its three comparisons are recorded whichever way they fell, and its report is written.
7. The main agent that meets bars 1 to 3 is the holder of its line, and its ladder shows no earlier holder beating it by more than the interval.
8. At three and four players the named tables of the league run are recorded for the final agent, with the leader's conversion; and its answers do not depend on who proposes: among proposers of the same rank, the share it accepts from its own copies and from other members differ by no more than the interval.

## Decision points

- **An exploiter keeps winning round after round.** Read what it does. If it is one trick (never trading, cornering the buildings), add a written school that does the same thing to the league so the main agent meets it from every start. If it is different each round, the main agent is chasing its own tail: lower its learning rate and raise the share of games against past selves.
- **The main agent beats everything but loses to one school.** That school's row is the worst row. Raise its weight by hand for a round. A cycle (A beats B beats C beats A) cannot be trained away; it is reported.
- **The main agents work against whoever leads, and a person who plays well always leads.** That is the behaviour R11 asks for, by standing and not by name, and it is not trained away. By the author's decision of 18 November 2026 there is no setting for it: an opponent goes as far as serves its own winning. A player who wants a gentler table picks opponents that do not play this layer.
- **The main agent favours its own copies** (bar 8 fails). The measure of M9 for dealing between copies applies here to answers; the remedies are M9's.
- **No style learner is admitted.** Raise the potentials' weights until the behaviour shows, accepting a lower win share; the bar for strength is an even share, not the main agent's level.
- **The search drives every weight to zero.** Then shaping does not help from a trained start. Record it, and run the ablation's first two rows from M5's starting policy instead, where shaping has more to do.
- **The ablation shows a part hurts.** Remove it and rerun the reference.
- **The conductor never changes school.** Check first that it can: a conductor rewarded for a visible change must change. If it can and does not, staying is its answer for these twelve schools; give it schools that differ more, by part, and try the second version.
- **The conductor changes school every turn.** Charge nothing for a change, but add the school in force to what it sees (it is there already) and lengthen the turn count a choice lasts to three, as a setting.

## Feeds back into

- [ai.md](../ai.md): the ablation table in workstream E; the rewards section rewritten around what survived; the risks table (strength without variety, shaping that changes what is learned) with what happened.
- [statistics.md](../statistics.md): the study with the final league.
- The open question on winner-takes-all against by-place rewards, which the survivor answers in part.

## Out of scope

- Offers made by the learner. Until M9 a school proposes on its behalf, for main agents and style learners alike.

## Result

Not yet run.
