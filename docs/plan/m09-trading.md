# M9. Trading

## Purpose

To let a learner make its own offers, and to measure whether it trades well. Trading is where a person most easily exploits an agent, where the choice is widest, and, by finding S7 of [ai.md](../ai.md), what decides whether games end. Until now the learner has answered offers and a school has proposed for it. The study shows how much rides on this (S5 and S6): today's agent gives its last streets away at twice their price, a player who refuses beats it, and a player who never proposes loses badly.

The stage has to produce something the study could not: a measure of what a deal is really worth to each side, so that "trades well" is a number.

**Moved forward on 20 November, by the author's decision.** The plan first put this stage after M7 and M8, on the grounds that the space of offers is wide, that the clone's own offers were poor (7% at four players), and that deals were to be priced by playouts of a strong main agent. None of these needs to wait that long: G1 gives a strong two-player agent now, the best found styles and the corrected Statesman are strong at three and four players, and the environment already lets a learner draft. Waiting would train G2, G3, M7 and M8 to play without proposing, which findings S5 to S7 say is the habit that matters most (a player who never proposes wins 42.3%, 14.2% and 5.9% at two, three and four players), and all of it would be trained again. So the stage now runs in two parts: its foundation and the two-player game right after G1, and its remaining sizes inside G2 and G3, which train with the learner's own offers from the start. "The main agent" below means the holder of `main-<n>` at the time, not M8's agent.

## Deliverables

| File | Contents |
| --- | --- |
| `scripts/probe-value.ts` | Extended from M1: changes of hands between two players. |
| `scripts/make-offer-suite.ts` | Builds the suite of offers with measured answers. |
| `test/fixtures/offers-*.json` | The suite. |
| `scripts/trade-report.ts` | The three trading measures for a model. |
| `src/env/actions.ts` | Selling for cash and second properties in a draft, if the decision below goes that way. |
| `train/configs/trade-*.yaml` | The runs. |

## Specification

### What a deal is worth

M1 measured what a purchase from the bank is worth by changing a position and playing it out. The same method prices a deal: take a position, apply the deal, play both versions out, and compare each side's win share. [M3b](m03b-table-politics.md) builds this first, for three kinds of deal among today's agent (a second street, a denying purchase, a purchase from a failing player), with the deal sheet that predicts the same figures from the valuation. This stage reuses both and plays the versions out with the league's best members.

| Read | Meaning |
| --- | --- |
| The proposer's change | Whether the deal helps the one who offers. |
| The receiver's change | Whether accepting is right. |
| The largest change among the others | What the deal costs the rest of the table. With two players this is nothing; with more, a deal can help both sides and hurt everyone else. |

Positions come from league games on seeds from 2,500,000, at rounds 10, 15, 20 and 30. Each version is played out forty times by the league's best fixed members, since the worth of a deal depends on how well the group it completes is then developed.

### The offer suite

Templates are filled from positions where they apply. Each case is then priced by the method above, and kept only if the receiver's change is clear: at least 5 points either way with the interval excluding zero. The label is the measured answer, not the template's intent.

| Template | Intent |
| --- | --- |
| A street that completes the proposer's group, for cash at 0.5, 1, 2, 4 and 8 times its list price | Find the price at which accepting turns right. |
| The same street, in exchange for a street that completes the receiver's group | A swap that completes both. |
| The same swap, with the receiver left too short of cash to build | The reference style's question. |
| A street the proposer has no use for, at 1.5 times list | An ordinary sale. |
| A pass, to a proposer who holds none, one, two and three | What a pass is worth by how many it makes. |
| A street for one coin, and a large sum for a street of no use | Offers nobody should refuse. The rules require both sides to hand something over, so nothing is given for nothing. |
| The receiver's only blocking street, for cash, when the proposer has cash to build at once and when it has none | Whether the answer reads the proposer's funds. |
| A second street of a group, to a proposer who holds one, at rounds 5, 10 and 20, with the third street in the bank and in a rival's hands | What a street is worth before a group lacks one (finding S16), and how fast that falls. |
| A street the strongest rival lacks, asked for by a third seat, by that seat's rank | Whether the answer, and the price, read who is being stopped. |
| A failing seat's best street, for cash that does and does not cover its largest due | Whether a failing seat should sell, and to whom. |
| One swap that completes a group for each side, offered between two trailing seats and between a trailing seat and the leader | Whether the answer reads the partner's standing. |
| An invitation as M3b defines it: a street the receiver needs, at its list price, from a trailing seat while a third seat leads | Whether accepting is right, and whether the offer that follows returns the favour. |

Two hundred kept cases for each table size, half to accept and half to refuse. The suite is fixed once built and versioned; an agent is scored by the share it answers as labelled.

### Switching drafting on

Three steps, each from the last one's checkpoint, for the main agent of each size.

| Step | Proposals | Run |
| --- | --- | --- |
| T1 | Made by the school, as before. The learner trains on answering with the suite in view. | The check every 100 updates adds the suite's score. No change to training. |
| T2 | Half the learner's turns are proposed for by the school and half by its own draft actions. | 30 million decisions. The starting policy's pull is switched back on for the draft decisions only, toward the cloned offers of M5, falling to zero by half the run. |
| T3 | All by the learner. | 50 million decisions. |

The entropy bonus for the draft decisions starts at twice the general figure: an offer is cheap to try and the choice is wide.

Through all three steps the opponents include, at double weight, the members that trade most by the descriptors of M2, and tables of the learner with copies of itself, where a deal that is good only because the other side is foolish does not exist.

### What the learner sees of an offer

Already in the observation of M4: what it would give and receive, the cash each way, the other party, each seat's chance of winning by the valuation, and each seat's funds. From M3b's version 3: what the deal does to each seat's chance by the deal sheet, what has passed between each pair of seats, and every seat's risk. This stage adds four numbers to the table block, which makes it layout version 4: whether the deal completes a set for the proposer; whether it does for the receiver; and how many buildings each side could pay for on that set afterwards, over 15. Models trained on version 3 are retrained from T1; the weights of the unchanged inputs carry over.

### Whether to widen what an offer can be

Version 2 of the actions asks for one property and gives at most one. Two things are missing: selling a property for cash, and deals of several properties.

Before T2, count them: the share of accepted offers in league games that a draft could not have expressed (from M5's `teach` mode). The reference style's own account uses swaps with cash, which a draft can express, and says nothing of plain sales. If more than one accepted deal in ten is out of reach, add a draft that starts from "give" (a sale) before training; several properties a side are added only if that count, taken again, still exceeds one in ten.

Decided on 18 November 2026, ahead of the count: the draft that starts from "give" is added. An invitation (M3b) is most often a sale at a favourable price, and a learner that cannot draft one could read signals and never send them. One more action, "ask for nothing", makes 189 and action version 3; a draft must still end with both sides handing something over, as the rules require. The count is still taken, for deals of several properties.

### The three measures

`scripts/trade-report.ts --model <weights> --size <n>` prints:

| Measure | How | Bar |
| --- | --- | --- |
| **The suite** | The share of cases answered as labelled, by template. | At most 2% of the cases labelled "refuse" are accepted; at most 10% of those labelled "accept" are refused. |
| **Dealing between copies** | 5,000 games at tables with two copies of the agent and league members in the other seats. For every accepted deal, the proposer's and receiver's change by the valuation. Compared between deals among the copies and deals with others. | Deals between copies are no more one-sided than deals with others: the mean of the larger side's gain minus the smaller's does not differ by more than its interval. |
| **Trading against ruled trading** | The agent against a copy of itself whose offers and answers are replaced by the best fixed school's, as the one among copies, both ways round, 5,000 games each. | The learned trader wins more than an even share among the ruled copies, and the ruled copy wins no more than an even share among the learned. |

It also prints offers made and accepted per game, the price over list of what it buys and sells, how often it completes a rival's group, and M3b's measures for a seat: early, denying and estate deals per game, asks per purchase, and the share of its deals made with the seat ranked first and with the seat ranked last. A learner that has found the table shows it there; one whose offers all come when it lacks one street has learned today's agent's habit and no more.

## Tasks

In order, from 20 November. Tasks marked *disk* play games for data and wait for the data disk; the rest are code and tests.

**Part A: the foundation** (before any trading run)

1. **Action version 3:** a draft may start from "give" (a sale for cash); a draft still ends with both sides handing something over, as the rules require. The client's encoder and the trainer agree on the version. *As built on 20 November:* the text above first said one action, "ask for nothing", making 189, but a sale must also name its partner, which an ask takes from the owner of the property asked for; so a sale goes give, partner (three new actions, the seats after the proposer), price (the cash indices, as multiples of the property's list price paid by the partner), 191 in all. Done: `src/env/actions.ts`, `env.ts`, `test/env/drafting.test.ts`. *Check:* M4's mask tests pass with drafting on; every draft the mask allows is an offer the engine accepts; a learner cannot send the same refused offer twice in a turn.
2. **Layout version 4:** the four numbers of "What the learner sees of an offer". A converter carries a version-3 model to version 4 with zero weights on the new inputs. *As built on 20 November:* six numbers, appended at the end rather than inside the table block (the four, and two marks of the draft that the table block's stage marks cannot carry: naming a sale's partner, and a sale), so that widening a model is a matter of zero columns at the end; the converter is in the loaders (`mlp.ts`; `widen_state_dict` and `widen_optimizer_state` in `train/model.py`), so that every model on the disk, G1's among them, loads as it is. Done, with tests in `test/env/drafting.test.ts` and `train/tests/test_widen.py`. *Check:* M4's tests pass at the new size; a converted model gives the same outputs as before on positions where the new inputs are zero.
3. **The drafting schedule in `run.py`:** for each table, the share of the learner's turns proposed for by a school and by its own drafts; the starting policy's pull for draft decisions only, toward the cloned offers of M5, with its own schedule; the entropy bonus for draft decisions at twice the general figure. *Check:* unit tests of the schedule; a trial of four updates with half the turns drafted runs and logs offers made and accepted. *Done on 20 November:* `drafting` (`{"share": 0.5}`, or `{"share": 0.5, "then": 1.0, "at": 0.3}` for G2 and G3), `pull` and `kappa_draft`, `draft_entropy` in `run.py`; the environment's `draftShare`, drawn at each turn from a stream of its own, so that a share of 0 plays exactly as drafting off (tested); a draft decision is one where any drafting action is legal (`ppo.py`); each game's report counts the learner's drafted offers and its school's, with acceptances, and `metrics.jsonl` logs them a game. The four-update trial, from random weights, logged 2.5 to 11 drafted offers a game, 29% to 80% accepted.
4. **The suite's score in the checks** (`run.py` and `evaluate.ts --suite`). *Check:* scoring a fixed agent twice on the same suite gives the same figure.
5. **Deals priced by playout for every template** (`probe-value.ts --deals`), extending M3b's three kinds. Playouts by today's best members: at two players the holder of `main-2` (G1) and of `style-2`; at three and four, `statesman-book-2` and the holders of `style-3` and `style-4`. *Check:* where one side plainly gains (a property for nothing) it says so; on M3b's cells it reproduces M3b's signs. *Disk.*
6. **Build the suite** (`make-offer-suite.ts`), at two players in the full game, three players in the full game and four players in the short game (the rules of G1, G3 and G2); four players in the full game is added for M7. *Check:* 200 kept cases a size, half to accept and half to refuse; every template has cases on both sides or is reported as one-sided. *Disk.*
7. **Score today's agents on the suite:** the baseline, the refuser, the best found style, `statesman-book-2` and the holder of `main-2`. This is the picture before any trading run. *Check:* a table of the suite's score by template for each. *Disk.*
8. **Count the accepted offers a draft cannot express** (deals of several properties), from league games. *Check:* the share is recorded, with the decision it led to. *Disk.*
9. **Gate 7's remedy** (M3b's decision point): a favour a seat took and did not return within `allyTurns` rounds counts against its goodwill with the giver, and the bound on goodwill in the score falls from 5 points to 2. Built on 20 November as two style fields that change nothing at their defaults (`unreturned`, `goodwillBound`), so the remedy is the variant `envoy+completeBy=list+goodwillBound=2+unreturned=1`. *Check:* unit tests (done: `test/relations.test.ts`); then the four-player gate 7 table with the remedied Envoy, compared with the Balancer's on the same seeds, paired by seed. *Disk for the tables.*
10. **Balancer's stalling** (M3b's bar 5): once the table goes cold (under 0.15 of its latest eight offers accepted), its answers by the sheet accept a deal whose cost to it by the sheet is under one point, instead of refusing all that do not pay it. Built on 20 November as `coldMood` and `coldEdge`; the fix is the variant `balancer+completeBy=list+coldMood=0.15+coldEdge=-1`. *Check:* unit tests (done: `test/style-agent.test.ts`); its tables reach 98% finished, and its paired results are played again. *Disk for the tables.*

**Part B: the two-player game** (the learner's own offers, from G1's holder)

11. **T1:** G1's holder converted to version 4, 10 million decisions with the school proposing, the suite in every check. *Check:* the checks hold G1's level against the baseline (within the interval) and log the suite's score. *Disk.*
12. **T2:** 30 million decisions, half the learner's turns drafted by itself; the pull toward the cloned offers falls to zero by half the run. *Check:* the checks log offers made and accepted a game and the suite's score; the share against the baseline does not fall below G1's bar. *Disk.*
13. **T3:** 50 million decisions, all offers drafted by the learner, three seeds. *Check:* after T3 the learner makes offers in most games and some are accepted. *Disk.*
14. **The two-player gate,** read from the median seed: M6's bars for G1 with the learner drafting (an even share over 1,000 games; above the refuser in the same seat over 5,000 paired games; under 2% cut off), the three bars of the measures table, a table of copies of the trading agent finishing at least 98% of its games, and the promotion match: the trading agent takes `main-2` from G1. *Disk.*

**Part C: inside G2 and G3** ([m06-first-games.md](m06-first-games.md))

15. G2 and G3 start from the trading holder with drafting on: half of the learner's turns drafted by itself for the first 30% of the budget, all of them after; members that trade most at double weight; tables of the learner with copies of itself. Their gates add the suite's bars at their size and a table of copies finishing at least 98%.

**Part D: carried into M7 and M8**

16. The trade report and the study's trading tables (former tasks 7 and 9) are read at each of M7's and M8's gates instead of once at the end; a four-player full-game suite is built for M7. *Check:* the report and the tables appear in each of those stages' results.
17. **Write up.** *Check:* every figure quoted in the documents can be found in a report under the data directory, the Result section names the command, seeds and commit, and the link check passes.

## Tests

- A deal applied to a position by the study passes `checkInvariants` and leaves the table's total of cash and property unchanged.
- Every case in the suite is an offer the engine accepts as valid in its position.
- The suite is deterministic from its seed.
- With drafting on, the mask tests of M4 pass, and a learner cannot send the same refused offer twice in a turn.

## Experiments and cost

| Run | Size | Cost |
| --- | --- | --- |
| Pricing candidate cases for the suite | About 1,000 candidates a size × 2 versions × 40 playouts | 240,000 part-games; about an hour of one core |
| T1, T2 and T3 at two players | 10 + 30 million, then 50 million × 3 seeds | About 13 hours at the rate measured on 20 November with the machine to itself (about 4,000 decisions a second) |
| The trade report | 15,000 games a size, with the network at every decision of a learned seat | Sized from M7's measurement of a learned game |

## Commands

```sh
node scripts/probe-value.ts --deals --snapshots $DATA_DIR/snapshots > $DATA_DIR/probes/deals.md
node scripts/make-offer-suite.ts --size 4 --cases 200 --out test/fixtures/offers-4.json
node scripts/trade-report.ts --model assets/models/main-4.ts --size 4
python train/branch.py --from $DATA_DIR/runs/league-4 --config train/configs/trade-t2.yaml --run $DATA_DIR/runs/trade-t2-4
node scripts/promote.ts --line trader-4 --challenger $DATA_DIR/runs/trade-t3-4/exports/chosen.ts
```

## Gate

At each shipped size:

1. The three bars of the measures table.
2. The gate of M8 still holds with the trading agent in place of the main agent.
3. A table of the trading agent alone finishes at least 98% of its games within the turn limit.
4. The trading agent holds `trader-<n>`: it won its promotion match against the holder of `main-<n>`, which is the same agent with a school making its offers.

## Decision points

- **The learner proposes nothing.** Proposing has a cost in steps and no reward until a deal lands. Hold the pull toward the cloned offers for the whole of T2, and add the school's own offers to the learner's experience as demonstrations.
- **The learner floods the table with offers that are refused.** Lower `maxProposals` to one a turn, and mask an ask that the same partner has refused in the last three turns.
- **Copies favour each other.** Train with at most one copy of the learner at a table for a while, then return to self-play with the measure in the checks. If it persists, give each copy's observation no way to tell a copy from another member: the habits and relations blocks are the only places it could, and they can be zeroed for a test. Favouring a partner for its standing is not this fault (requirement R11); the measure compares partners of the same rank.
- **The learner's offers all come when it lacks one street.** It has copied the rule-based proposer. Double the weight of the M3b schools among the cloned offers that the pull of T2 points toward, and add the suite's second-street cases to the training games' starts.
- **It fails the suite on one template.** Add positions of that template to the training games' starts, by setting up the position and playing on from it.
- **Trading well costs strength elsewhere** (task 8 fails). Keep both: the M8 agent ships, and the trading agent ships as a second opponent, with the difference stated.

## Feeds back into

- [ai.md](../ai.md): workstream H rewritten around the measured worth of deals; findings S5 and S6 restated for agents that bargain; the open question on what holding a rival's missing street is worth, answered by the intervention study.
- [statistics.md](../statistics.md): the trading tables for the new agents; the measures of bargaining position (wanted, chips) reported again, since their worth was expected to change.
- [m04-environment.md](m04-environment.md): layout version 4, and any widened draft.

## Out of scope

- Free-form negotiation: counter-offers, conditions, promises. The rules have none.
- Offers made out of turn, other than at a rival's debt. There M3b's window asks the school that proposes on the learner's behalf; whether the learner itself is asked is decided once M3b has measured what the window is worth.

## Result

Not yet run.
