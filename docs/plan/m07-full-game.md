# M7. The full game and the specialists

## Purpose

To carry the learner from the three first games to the full game at every table size (step G4 of [ai.md](../ai.md)), and then to answer requirement R3 with a measurement: whether an agent trained for one table size beats the shared one at that size. The study says the sizes differ in what is worth holding (findings S2, S10 and S11); this stage finds out whether one network can hold all three answers or whether three are needed.

## Deliverables

| File | Contents |
| --- | --- |
| `train/configs/g4.yaml` | The shared agent on the full game at all three sizes. |
| `train/configs/specialist-2.yaml`, `-3.yaml`, `-4.yaml` | The three specialists. |
| `train/branch.py` | Starts a run from another run's checkpoint with a new configuration. |
| `scripts/study.ts` | Any league member, learned ones included, can be the odd player or fill a table. |
| `assets/models/` | The shared agent, and each specialist that ships. |

## Specification

### G4: the shared agent on the full game

The run continues from G3's checkpoint. Nothing in the update changes.

| Setting | Value |
| --- | --- |
| Table sizes | Two, three and four players in equal parts, all in the full game |
| Opponents | As in M6, with the M6 learner's checkpoints among the league members as past selves |
| Shaping | The `value` potential restarts at 0.5 and falls to 0 by half the budget. No milestone potentials. |
| Starting-policy pull | Off. The run starts from a learner, not from the clone. |
| Budget | 150 million decisions to start: 8.3 hours at 5,000 a second. Scaled by what G1 to G3 needed. |

**Past selves.** Every 200 updates the current checkpoint is added to the league as a member. At most eight are kept: the newest four, and four spread evenly over the run's history. Every holder of the line is kept besides, however many there are.

### The specialists

After G4 passes, its checkpoint is branched three times. Each branch trains on one table size only, against the league members meant for that size, for 50 million decisions, with the learning rate restarted at 1e-4.

Two things could make a specialist better than the shared agent: time spent only on its size, and freedom from the other sizes' demands. To tell them apart the shared agent is also continued, on all sizes, for the same 150 million decisions in total. The comparison below is between a specialist and that continued shared agent, not the checkpoint they both started from.

### The test for shipping a specialist

On evaluation seeds, at the specialist's size, with seats rotated:

| Table | Games | Read |
| --- | --- | --- |
| Each as the one among baselines, on the same seeds | 10,000 paired | The difference in win share |
| The specialist as the one among copies of the shared agent, and the reverse | 5,000 each | Each one's share against an even share |
| Each as the one among copies of each of its three worst league opponents | 2,000 paired for each opponent | The difference in the worst row |

The specialist ships at its size if the first difference is above zero with its interval, it wins more than an even share among copies of the shared agent, and its worst row is no worse than the shared agent's. Otherwise the shared agent is used at that size.

**Shipping is by succession.** At each size the continued shared agent is put forward for `main-<n>` first. The specialist is then its challenger, and the three tables above are played in addition to the promotion match of [README.md](README.md#new-against-best). The specialist takes the line only if both say so. Whatever holds `main-<n>` at the end of the stage is what ships at that size.

### Why the sizes differ, as behaviour

Whichever way the test falls, the stage reports how the agents play each size, by the study's descriptors and by direct questions the study raised:

| Question | Read from |
| --- | --- |
| Does it buy passes more readily with two players? | The share of passes it buys when it lands on one, by size. |
| Does it decline less with two players, where a declined property goes cheap to the rival? | The share it buys of what it lands on, and what it bids for what it declined, by size. |
| Does it leave Conquest of Shu alone with three and four players, and bid low on it with two? | The same, for that group. |
| How far does it build? | The share of its built groups that peak at three, four and a fortress, by size. |
| Does it keep more cash late? | Mean cash at rounds 10, 20 and 40, against the largest rent it could owe. |
| Does it accept what completes a rival's group? | The share of such offers it accepts, and at what price over list. |

### If the learner stalls

A stack of dense layers reads 28 properties as 28 unrelated slots. If G4 stalls below its gate with the levers of M6 exhausted, the next network treats the properties and the seats as two sets of tokens (the same numbers as the observation's property and seat blocks, one row each), passes them through two layers of attention so that a street can look at the other streets of its group and at their owners, and pools the result for the heads. The observation, the actions and the environment do not change. The client then needs a forward pass for attention or ONNX Runtime Web, which is the cost that makes this the second choice.

## Tasks

1. **`train/branch.py`.** *Check:* a branched run's first check reproduces its parent's last.
2. **G4.** Run, check, choose a checkpoint, test it. *Check:* gate 1.
3. **Continue the shared agent** for the comparison. *Check:* its checks are logged at the same decision counts as the specialists', so that the two can be compared at equal training.
4. **The three specialists.** *Check:* each specialist's checks at its size are logged against the continued shared agent's.
5. **The shipping test** for each size. *Check:* the three tables of the test are recorded for each size, with intervals, whichever way they fell.
6. **Members in the study.** `--members name,name` fills tables from the league registry. *Check:* `--members baseline` reproduces the main tables' figures within their intervals.
7. **Rerun the study** with the shipped agent of each size as the odd player, and with a table made only of the shipped agent. *Check:* the study completes; a table of the shipped agent alone finishes at least 98% of its games.
8. **The report on behaviour by size.** *Check:* every question in the table has a figure for each table size.
9. **Export** the shipped agents with their records. *Check:* the parity test passes for every shipped model, and each record names the sizes the model is for.
10. **Write up.** *Check:* every figure quoted in the documents can be found in a report under the data directory, the Result section names the command, seeds and commit, and the link check passes.

## Tests

- A branch keeps the parent's weights and resets only what the new configuration names.
- A model's record names the sizes it is for, and the client refuses to seat it at another.

## Experiments and cost

At the planning rate of 5,000 decisions a second; replaced by M4's measured rate and M6's experience.

| Run | Decisions | Time |
| --- | --- | --- |
| G4 | 150 million | 8.3 hours |
| The shared agent, continued | 150 million | 8.3 hours |
| Three specialists | 50 million each | 2.8 hours each |
| The shipping tests | About 100,000 games | About half an hour of one core |
| The study with learned members | The network runs at every decision of a learned seat, so a learned game costs several times a rule-based one. Measured on 1,000 games before the full run is sized. | |

## Commands

```sh
python train/branch.py --from $DATA_DIR/runs/g3-s1 --config train/configs/g4.yaml --run $DATA_DIR/runs/g4-s1
python train/branch.py --from $DATA_DIR/runs/g4-s1 --config train/configs/specialist-4.yaml --run $DATA_DIR/runs/spec4-s1
node scripts/promote.ts --line main-4 --challenger $DATA_DIR/runs/spec4-s1/exports/00380.ts
node scripts/study.ts 20000 --members main-4,baseline --sizes 4
```

## Gate

1. **G4.** The three gates of M6, in the full game at every size, by one agent: above an even share over 1,000 games; above the refuser (58.2%, 41.0%, 30.4%) over 5,000 paired games; under 2% of games cut off.
2. **The shipping test has been run** at every size and its result recorded, whichever way it fell.
3. Each `main` line has a holder that won its match, and its ladder shows no earlier holder beating it by more than the interval.

## Decision points

- **G4 passes at two sizes and fails at the third.** Train a specialist for the third size straight away, from G4's checkpoint, and judge it by G4's gate at that size. Requirement R3 allows exactly this.
- **No specialist beats the shared agent.** Ship one agent. Record it as a finding: one network holds all three answers.
- **Every specialist beats it.** Ship three, and keep the shared agent as the starting point for anything new.
- **The learners are strong and all alike.** That is expected of main agents trained on the same reward. Variety is M8's job.
- **A table of the shipped agent alone does not finish its games.** The share cut off is over 2% only at that table. Raise the share of self-play, and look at offers: learners that all refuse cannot complete groups.

## Feeds back into

- [ai.md](../ai.md): the baselines table; the section on one agent for each size, rewritten around what the test found; the open question on whether the short game carries over, which G2 and G4 together answer.
- [statistics.md](../statistics.md): the study with learned members. For the first time it describes games among agents that are not the rule-based one, so the findings S1 to S15 are each marked as holding, changed or reversed.

## Out of scope

- Opponents with characters. That is M8.
- Learned offers. That is M9.

## Result

Not yet run.
