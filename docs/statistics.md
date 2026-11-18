# What the simulations show

This document reports a simulation study of the game: 706,000 games on the Three Kingdoms board, with two, three and four players, played by the computer agents in `src/sim/`. It is the evidence behind the plan in [ai.md](ai.md). Every figure in it is printed by `scripts/study.ts`, from a run made on 17 November 2026.

## In brief

- **Length.** A full game takes 146, 168 and 188 turns on average with two, three and four players, and 546, 704 and 782 actions. One game in a hundred runs to about 305, 355 and 405 turns or more.
- **Order of play.** Going first is worth 1.2 points of win share over going last with two players, 3.2 with three and 5.2 with four.
- **Landings.** The second and third sides of the board take 28.1% of landings each in a four-player game, against 23.8% and 23.9% for the first and fourth. ChiBi takes 7.0%. Zhuge Liang is the street landed on most.
- **Building.** In seven of the eight groups the third building adds the most rent for its cost. Built to three, Cao Wei pays back its whole outlay in 26 turns of one opponent, and Han Court in 67.
- **List price misstates value.** Restated in cash by a model of who wins, a whole Chain Stratagem held after ten rounds of a four-player game is worth 5.0 times its list price, and a whole Conquest of Shu 0.85 times.
- **The table size changes the answer.** One pass is worth 1.6 to 2.0 times its list price with two players and 0.5 to 0.8 times with four.
- **Who is ahead.** The player whose properties charge the most rent, counting what the cash in hand could build at once, goes on to win more often than the player with the highest net worth. That holds at every table size and at every round up to 40. After 20 rounds of a four-player game it is 67.0% against 59.5%.
- **Cash.** The player with the most cash after ten rounds of a four-player game wins 21.6% of the time, less than a player picked at random. With the rent roll held equal, funds count for more than any other measure.
- **Trading.** Without trades, 61% of four-player games do not finish within 40,000 actions, and about half never see a group completed. A player who refuses every offer wins 30.4% of four-player games, against an even share of 25%. A player who never makes an offer wins 5.9%.

## How the study was run

### Tables

| Table | Players | Games at each size | Seats |
| --- | --- | ---: | --- |
| Full game | 2, 3, 4 | 100,000 | All rule-based. These are the main tables and most of this document. |
| Short game | 2, 3, 4 | 20,000 | All rule-based, under [the short-game rules](rules.md#the-short-game). |
| No trading | 2, 3, 4 | 2,000 | All rule-based, except that nobody proposes or accepts a trade. |
| One odd player | 2, 3, 4 | 20,000 | One seat plays differently from the rest. Seventeen tables, listed [below](#one-odd-player-among-ordinary-ones). |

Each table plays the seeds from 1 to its number of games. The opening roll sets the order of play, so the place the odd player takes varies with the seed. The run took 2 hours 18 minutes on eight processes.

### Players

| Player | How it plays |
| --- | --- |
| Rule-based | `chooseHeuristicAction`, described in [ai.md](ai.md#the-rule-based-agent). |
| Random | `chooseRandomAction`: a weighted random choice among legal actions. |
| No works | Rule-based, but never buys or bids on a works. |
| No Conquest | Rule-based, but never buys or bids on a street of Conquest of Shu. |
| Refuser | Rule-based, but rejects every offer made to it. It still makes offers. |
| Quiet | Rule-based, but never makes an offer. It still answers them. |
| No trading | Rule-based, but neither makes nor accepts an offer. |

### Terms

- **Turn.** One player's turn, with any further rolls after doubles.
- **Round.** As many turns as the table had seats at the start. "After round 10" is the moment the turn numbered ten times the seats, plus one, begins. Once a player is out, a round is more than one lap for those left.
- **Finished.** A game that has a winner within 40,000 actions. Games that do not finish are counted where a table says so, and are left out of win shares.
- **Even share.** One over the number of players: what a seat wins if nothing sets it apart.
- **Interval.** A share is followed in brackets by its 95% Wilson interval.
- **Set.** A group of streets, the four passes, or the two works.

### What the figures can and cannot say

1. **They describe today's agents.** The rule-based agent does not look ahead, builds without stopping, never offers property in a trade, and sells the last street of a group for about twice its list price. Figures about trading and bargaining above all are facts about that agent, not about the game. The study is run again whenever the agents change.
2. **They are associations.** A holding that goes with winning may be a result of winning: late in a game the leader collects property from rivals who go bankrupt. What players hold after ten rounds is still mostly the luck of the dice, so the early snapshots are the ones to trust for what a holding is worth.
3. **The models are a first cut.** They are fitted by least squares to an outcome that is one or zero, and they are linear. They are good enough to rank holdings and to show where list price is wrong. The fitted valuation the plan calls for is workstream A of [ai.md](ai.md#a-valuation-what-things-are-really-worth).

## How long games last

| Measure | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Games played | 100000 | 100000 | 100000 |
| Finished within the action limit | 100.00% | 100.00% | 100.00% |
| Turns in a finished game, mean | 145.9 | 167.6 | 187.6 |
| Rounds in a finished game, mean | 72.9 | 55.9 | 46.9 |
| Turns, 10th percentile | 85 | 105 | 115 |
| Turns, median | 135 | 165 | 175 |
| Turns, 90th percentile | 215 | 235 | 265 |
| Turns, 99th percentile | 305 | 355 | 405 |
| Actions per game, mean | 546 | 704 | 782 |

All but one of the 300,000 full games finished. One three-player game was still running after 40,000 actions, which the table rounds away.

| When things first happen | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Every property owned: share of games | 61.3% | 73.6% | 80.8% |
| Every property owned: mean round | 55.3 | 37.7 | 29.0 |
| First group completed: share of games | 100.0% | 100.0% | 100.0% |
| First group completed: mean round | 15.1 | 11.1 | 9.0 |
| First building: share of games | 100.0% | 100.0% | 100.0% |
| First building: mean round | 17.3 | 12.0 | 9.7 |
| First bankruptcy: share of games | 100.0% | 100.0% | 100.0% |
| First bankruptcy: mean round | 72.9 | 44.7 | 34.2 |

The percentiles of turns are read from a histogram in steps of ten, so each is the middle of its step.

**Decisions.** The number of decisions of each kind in a game, with the mean number of legal actions at such a decision and the most ever seen:

| Decision | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Free turn: roll, build, mortgage, propose, end the turn | 362.7 (14.4, most 41) | 428.7 (12.1, most 47) | 486.0 (10.9, most 51) |
| Property auction: bid or pass | 105.8 (11.0, most 26) | 132.4 (8.9, most 30) | 106.0 (7.8, most 32) |
| Building auction: bid or pass | 16.6 (2.0, most 2) | 63.2 (2.0, most 2) | 98.9 (2.0, most 2) |
| Raising money for a debt | 23.1 (8.9, most 29) | 31.6 (7.5, most 30) | 36.1 (7.1, most 33) |
| Buy or decline | 27.3 (8.2, most 26) | 27.6 (6.2, most 29) | 27.7 (5.2, most 31) |
| Answering an offer | 7.0 (2.0, most 2) | 10.9 (2.0, most 2) | 13.2 (2.0, most 2) |
| Receiving a mortgaged property |  | 5.4 (16.1, most 29) | 7.5 (16.1, most 33) |
| Opening roll | 2.3 (1.0, most 1) | 3.7 (1.0, most 1) | 5.4 (1.0, most 1) |
| Leaving jail | 0.7 (13.8, most 28) | 0.8 (11.8, most 33) | 0.9 (11.2, most 34) |

A seat makes about 273, 235 and 195 decisions in a game with two, three and four players. Most are routine: more than three in five come on the player's own free turn, the opening roll has one legal action, and a building auction or an offer has two. The widest choice is on a free turn, where up to 51 actions are legal at once.

## The order of play

The opening roll ranks the players, and the whole order follows it. Share of games won, by place in that order:

| Place | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| 1 | 50.6% (50.3 to 50.9) | 35.0% (34.7 to 35.3) | 27.7% (27.4 to 28.0) |
| 2 | 49.4% (49.1 to 49.7) | 33.2% (32.9 to 33.5) | 25.7% (25.4 to 25.9) |
| 3 |  | 31.8% (31.5 to 32.0) | 24.1% (23.8 to 24.4) |
| 4 |  |  | 22.5% (22.3 to 22.8) |

The advantage of moving early grows with the table: 1.2 points between first and last with two players, 3.2 with three, 5.2 with four. A comparison of two agents that does not give each of them every place equally often is measuring the seating as well.

## Where players land

How often a token comes to rest on each square, per player turn. A turn can have several landings, through doubles and through cards that move the token, so the column adds up to about 120%.

| Square | Kind | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: | ---: |
| 0 LuoYang | start | 3.38% | 3.36% | 3.33% |
| 1 Dong Zhuo | Han Court | 2.30% | 2.27% | 2.24% |
| 2 Imperial Edict | card | 2.35% | 2.33% | 2.32% |
| 3 Emperor Xian | Han Court | 2.40% | 2.40% | 2.38% |
| 4 Poll Tax | tax | 2.62% | 2.62% | 2.62% |
| 5 Hulao Pass | pass | 3.37% | 3.38% | 3.38% |
| 6 Wang Yun | Chain Stratagem | 2.61% | 2.64% | 2.65% |
| 7 Silk Pouch | card | 2.72% | 2.76% | 2.79% |
| 8 Diaochan | Chain Stratagem | 2.71% | 2.74% | 2.76% |
| 9 Lü Bu | Chain Stratagem | 2.67% | 2.70% | 2.71% |
| 10 ChiBi | jail | 6.97% | 6.96% | 6.96% |
| 11 Yuan Shao | House of Yuan | 3.10% | 3.13% | 3.13% |
| 12 Ironworks | works | 3.12% | 3.13% | 3.14% |
| 13 Xu You | House of Yuan | 2.61% | 2.62% | 2.62% |
| 14 Yan Liang & Wen Chou | House of Yuan | 2.87% | 2.89% | 2.89% |
| 15 Guandu Ford | pass | 3.20% | 3.22% | 3.23% |
| 16 Cao Cao | Cao Wei | 3.19% | 3.20% | 3.21% |
| 17 Imperial Edict | card | 3.17% | 3.18% | 3.17% |
| 18 Cao Pi | Cao Wei | 3.34% | 3.35% | 3.35% |
| 19 Xun Yu | Cao Wei | 3.36% | 3.37% | 3.37% |
| 20 HanZhong | rest | 3.33% | 3.32% | 3.33% |
| 21 Liu Bei | Shu Han | 3.11% | 3.11% | 3.10% |
| 22 Silk Pouch | card | 3.26% | 3.25% | 3.26% |
| 23 Guan Yu | Shu Han | 3.03% | 3.02% | 3.02% |
| 24 Zhuge Liang | Shu Han | 3.54% | 3.53% | 3.52% |
| 25 Changban Bridge | pass | 3.40% | 3.39% | 3.38% |
| 26 Sun Quan | Eastern Wu | 2.99% | 2.97% | 2.96% |
| 27 Zhou Yu | Eastern Wu | 2.96% | 2.94% | 2.93% |
| 28 Salt Works | works | 3.10% | 3.09% | 3.08% |
| 29 Lu Xun | Eastern Wu | 2.84% | 2.83% | 2.82% |
| 30 YiLing | go to jail | 2.90% | 2.88% | 2.86% |
| 31 Jiang Wei | Conquest of Shu | 2.93% | 2.92% | 2.90% |
| 32 Deng Ai | Conquest of Shu | 2.88% | 2.86% | 2.84% |
| 33 Imperial Edict | card | 2.95% | 2.94% | 2.91% |
| 34 Zhong Hui | Conquest of Shu | 2.74% | 2.71% | 2.69% |
| 35 Jiange Pass | pass | 2.64% | 2.64% | 2.62% |
| 36 Silk Pouch | card | 2.51% | 2.50% | 2.47% |
| 37 Sima Yi | House of Sima | 2.37% | 2.35% | 2.34% |
| 38 War Levy | tax | 2.37% | 2.34% | 2.32% |
| 39 Sima Zhao | House of Sima | 2.88% | 2.85% | 2.84% |

By side of the board, the nine squares between two corners:

| Squares | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Side 1 (nine squares) | 23.7% | 23.8% | 23.8% |
| Side 2 (nine squares) | 27.9% | 28.1% | 28.1% |
| Side 3 (nine squares) | 28.2% | 28.1% | 28.1% |
| Side 4 (nine squares) | 24.3% | 24.1% | 23.9% |
| All squares | 120.8% | 120.7% | 120.4% |

- The pattern does not depend on the table size. No square differs by more than 0.1 point between two players and four.
- ChiBi takes 7.0% of landings, about twice any other square. A token leaving ChiBi lands on the second side or the start of the third, which is much of why those two sides are the busy ones.
- The street landed on most is Zhuge Liang (3.5%), which a card also sends players to, then Xun Yu and Cao Pi (3.4%). The streets landed on least are Dong Zhuo (2.2%) and Sima Yi (2.3%).
- Of the passes, Changban Bridge and Hulao Pass are landed on most (3.4%) and Jiange Pass least (2.6%).

## What a set returns

### By the landing rates

The rent a complete group can expect from one turn of one opponent: for each street, its landing rate in the four-player game times its rent at that level, added up over the group. "Bare" is the group without buildings, at double rent.

| Group | Landings per street | Bare | 1 | 2 | 3 | 4 | Fortress |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Han Court | 2.31% | 0.3 | 0.7 | 2.1 | 6.3 | 11.2 | 16.3 |
| Chain Stratagem | 2.71% | 1.1 | 2.7 | 7.6 | 22.7 | 33.8 | 46.0 |
| House of Yuan | 2.88% | 1.8 | 4.6 | 13.8 | 40.4 | 56.2 | 69.2 |
| Cao Wei | 3.31% | 2.9 | 7.3 | 20.5 | 56.3 | 76.1 | 96.0 |
| Shu Han | 3.21% | 3.6 | 9.0 | 25.9 | 69.2 | 86.1 | 103.0 |
| Eastern Wu | 2.90% | 3.9 | 9.9 | 29.6 | 71.1 | 86.3 | 101.6 |
| Conquest of Shu | 2.81% | 4.5 | 11.5 | 34.5 | 78.6 | 95.5 | 110.9 |
| House of Sima | 2.59% | 4.5 | 9.8 | 28.7 | 65.4 | 78.6 | 91.8 |

The same income, as the gain from each further level per 100 coins spent on reaching it:

| Group | 1 | 2 | 3 | 4 | Fortress |
| --- | ---: | ---: | ---: | ---: | ---: |
| Han Court | 0.42 | 1.40 | 4.19 | 4.89 | 5.10 |
| Chain Stratagem | 1.08 | 3.25 | 10.11 | 7.40 | 8.12 |
| House of Yuan | 0.92 | 3.08 | 8.84 | 5.29 | 4.33 |
| Cao Wei | 1.46 | 4.41 | 11.91 | 6.62 | 6.62 |
| Shu Han | 1.20 | 3.74 | 9.64 | 3.75 | 3.75 |
| Eastern Wu | 1.32 | 4.38 | 9.22 | 3.39 | 3.39 |
| Conquest of Shu | 1.17 | 3.83 | 7.35 | 2.81 | 2.57 |
| House of Sima | 1.32 | 4.74 | 9.18 | 3.30 | 3.30 |

The whole outlay at list prices, streets and buildings together, and the number of opponent turns that pay it back:

| Group | Streets | Bare | 1 | 2 | 3 | 4 | Fortress |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Han Court | 120 | 120 / 429 | 220 / 315 | 320 / 153 | 420 / 67 | 520 / 46 | 620 / 38 |
| Chain Stratagem | 320 | 320 / 296 | 470 / 174 | 620 / 82 | 770 / 34 | 920 / 27 | 1070 / 23 |
| House of Yuan | 440 | 440 / 238 | 740 / 160 | 1040 / 75 | 1340 / 33 | 1640 / 29 | 1940 / 28 |
| Cao Wei | 560 | 560 / 192 | 860 / 118 | 1160 / 57 | 1460 / 26 | 1760 / 23 | 2060 / 21 |
| Shu Han | 680 | 680 / 188 | 1130 / 125 | 1580 / 61 | 2030 / 29 | 2480 / 29 | 2930 / 28 |
| Eastern Wu | 800 | 800 / 203 | 1250 / 127 | 1700 / 57 | 2150 / 30 | 2600 / 30 | 3050 / 30 |
| Conquest of Shu | 920 | 920 / 205 | 1520 / 132 | 2120 / 61 | 2720 / 35 | 3320 / 35 | 3920 / 35 |
| House of Sima | 750 | 750 / 168 | 1150 / 118 | 1550 / 54 | 1950 / 30 | 2350 / 30 | 2750 / 30 |

Passes and works, counted the same way (a works at the mean roll of 7):

| Holding | Outlay | Income per opponent turn | Turns to pay back |
| --- | ---: | ---: | ---: |
| 1 of 4 passes | 200 | 0.8 | 254 |
| 2 of 4 passes | 400 | 3.2 | 127 |
| 3 of 4 passes | 600 | 9.5 | 63 |
| 4 of 4 passes | 800 | 25.2 | 32 |
| 1 of 2 works | 150 | 0.9 | 172 |
| 2 of 2 works | 300 | 4.4 | 69 |

- **The third building is the best coin spent** in seven of the eight groups. Only in Han Court does each further level keep paying more than the last.
- **Cao Wei returns most.** Built to three it pays back in 26 opponent turns, ahead of Shu Han (29), Eastern Wu and House of Sima (30), House of Yuan (33), Chain Stratagem (34), Conquest of Shu (35) and Han Court (67).
- **Chain Stratagem is cheap, not rich.** It reaches three buildings for 770 coins, which is less than the bare streets of Eastern Wu cost.
- **Conquest of Shu earns the most rent of any group at three buildings and, Han Court aside, is the slowest to repay its outlay,** because that outlay is 2,720 coins.
- **Passes are worth having as a set.** Four pay back in 32 opponent turns, as fast as a group built to three and for the price of Chain Stratagem at that level. One pass alone takes 254.
- **Works are weak.** One takes 172 opponent turns to pay back, and both together take 69.

These figures are per opponent. With three opponents a set pays back three times as fast as with one, which is one reason the table size changes what is worth buying.

### In play

Rent actually collected in the full games. The first figure is the rent a set collects in a game as a multiple of its list price; the second is its share of all rent paid.

| Set | List price | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: | ---: |
| Han Court | 120 | 3.64 (10.6%) | 6.09 (11.5%) | 8.73 (12.0%) |
| Passes | 800 | 0.68 (13.1%) | 0.81 (10.3%) | 0.92 (8.5%) |
| Chain Stratagem | 320 | 1.79 (13.9%) | 2.72 (13.8%) | 3.36 (12.4%) |
| House of Yuan | 440 | 1.11 (11.8%) | 1.81 (12.6%) | 2.39 (12.1%) |
| Works | 300 | 0.46 (3.4%) | 0.65 (3.1%) | 0.81 (2.8%) |
| Cao Wei | 560 | 0.93 (12.6%) | 1.51 (13.4%) | 2.11 (13.6%) |
| Shu Han | 680 | 0.53 (8.7%) | 0.90 (9.7%) | 1.28 (10.0%) |
| Eastern Wu | 800 | 0.41 (8.0%) | 0.65 (8.2%) | 0.97 (8.9%) |
| Conquest of Shu | 920 | 0.30 (6.7%) | 0.45 (6.6%) | 0.67 (7.1%) |
| House of Sima | 750 | 0.61 (11.2%) | 0.92 (10.9%) | 1.48 (12.8%) |

In play the order differs from the order by return. The dear groups collect the least, because they are completed late and seldom built on: Conquest of Shu takes 7.1% of the rent in a four-player game and Eastern Wu 8.9%, against 13.6% for Cao Wei and 12.4% for Chain Stratagem. Han Court collects 12.0% of all rent from two streets that cost 120 coins, because it is completed early and, at four players, is built to the top in 88% of the games where it is completed. Part of this is the agent's own habit of building wherever each coin adds most rent, with no thought for landing rates.

## How property changes hands

### From the bank

The share of a set's first sales that were auctions, and the mean winning bid as a share of list price:

| Set | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Han Court | 0.1% at 76% | 0.6% at 81% | 0.8% at 90% |
| Passes | 32.0% at 43% | 18.8% at 74% | 11.3% at 87% |
| Chain Stratagem | 7.2% at 59% | 4.9% at 86% | 3.2% at 94% |
| House of Yuan | 18.8% at 49% | 11.2% at 79% | 6.8% at 90% |
| Works | 28.0% at 47% | 16.0% at 74% | 9.2% at 82% |
| Cao Wei | 26.2% at 43% | 14.7% at 76% | 8.6% at 89% |
| Shu Han | 33.0% at 38% | 19.3% at 71% | 11.5% at 86% |
| Eastern Wu | 42.6% at 33% | 26.2% at 66% | 16.2% at 83% |
| Conquest of Shu | 50.4% at 29% | 32.3% at 61% | 20.1% at 81% |
| House of Sima | 57.2% at 26% | 36.5% at 57% | 22.0% at 85% |

With two players between a quarter and more than a half of the dearer property is first sold at auction, and it goes for a quarter to a half of its list price: the rule-based agent declines when a purchase would leave it short of cash, and only one rival is there to bid. With four players auctions are rarer and close at 81% to 94% of list price. Declining a property therefore hands a rival a bargain at a small table and costs little at a large one.

### Groups

The share of games in which each group is completed by somebody, and the mean round in which that happens:

| Group | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Han Court | 90.0%, round 32.6 | 93.4%, round 22.2 | 95.1%, round 16.8 |
| Chain Stratagem | 90.7%, round 51.4 | 94.6%, round 38.2 | 96.5%, round 32.9 |
| House of Yuan | 91.5%, round 54.3 | 95.2%, round 39.1 | 97.0%, round 32.8 |
| Cao Wei | 94.0%, round 57.5 | 96.8%, round 41.5 | 98.1%, round 34.4 |
| Shu Han | 93.0%, round 59.5 | 95.9%, round 43.2 | 97.6%, round 35.4 |
| Eastern Wu | 91.1%, round 62.1 | 94.6%, round 45.8 | 96.5%, round 37.0 |
| Conquest of Shu | 90.1%, round 63.1 | 93.8%, round 47.4 | 95.8%, round 38.5 |
| House of Sima | 92.2%, round 48.7 | 95.3%, round 35.8 | 97.2%, round 26.2 |

How the first player to complete the group came by its last street: bought on landing, won at auction, received in a trade, or taken over from a bankrupt player.

| Group (bought / auction / trade / bankruptcy) | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Han Court | 47% / 0% / 41% / 12% | 31% / 0% / 58% / 11% | 23% / 0% / 70% / 7% |
| Chain Stratagem | 20% / 1% / 31% / 48% | 8% / 1% / 42% / 50% | 3% / 1% / 46% / 50% |
| House of Yuan | 19% / 4% / 23% / 54% | 9% / 2% / 38% / 51% | 4% / 1% / 46% / 49% |
| Cao Wei | 15% / 8% / 18% / 59% | 7% / 3% / 34% / 56% | 4% / 2% / 43% / 52% |
| Shu Han | 12% / 11% / 12% / 65% | 6% / 4% / 28% / 62% | 4% / 2% / 37% / 57% |
| Eastern Wu | 9% / 14% / 9% / 67% | 6% / 5% / 22% / 67% | 4% / 3% / 32% / 61% |
| Conquest of Shu | 6% / 17% / 8% / 69% | 5% / 6% / 18% / 71% | 3% / 4% / 27% / 66% |
| House of Sima | 10% / 38% / 12% / 40% | 13% / 19% / 29% / 39% | 13% / 12% / 47% / 27% |

The highest level the group reached, in the games where it was completed: no building, one or two, three, four, or a fortress.

| Group (none / 1 or 2 / 3 / 4 / fortress) | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Han Court | 19% / 6% / 2% / 2% / 71% | 10% / 6% / 2% / 2% / 80% | 6% / 4% / 2% / 1% / 88% |
| Chain Stratagem | 51% / 4% / 2% / 1% / 42% | 43% / 4% / 2% / 1% / 50% | 38% / 5% / 1% / 1% / 54% |
| House of Yuan | 58% / 10% / 3% / 2% / 27% | 46% / 11% / 4% / 3% / 36% | 40% / 10% / 3% / 3% / 44% |
| Cao Wei | 62% / 8% / 2% / 2% / 26% | 48% / 9% / 3% / 3% / 37% | 39% / 8% / 3% / 3% / 47% |
| Shu Han | 70% / 10% / 2% / 2% / 15% | 57% / 15% / 4% / 3% / 21% | 48% / 15% / 4% / 4% / 29% |
| Eastern Wu | 72% / 8% / 3% / 2% / 14% | 59% / 12% / 4% / 3% / 21% | 48% / 12% / 5% / 4% / 31% |
| Conquest of Shu | 76% / 9% / 4% / 3% / 8% | 66% / 14% / 5% / 3% / 12% | 55% / 17% / 5% / 5% / 19% |
| House of Sima | 49% / 12% / 6% / 8% / 25% | 36% / 14% / 6% / 8% / 36% | 20% / 13% / 6% / 7% / 54% |

- **Groups are completed by trade or by bankruptcy, seldom by the dice.** In a four-player game the last street is bought on landing in 3% to 4% of cases for six of the eight groups.
- **A group taken from a bankrupt player is a result of winning, not a cause.** With two players that is how 40% to 69% of the groups other than Han Court are completed, at the moment the game ends. This is why the study does not report how often "the first to complete a group" wins as a measure of the group's worth. The script prints that table; [what players hold after ten rounds](#what-holdings-are-worth) is the cleaner evidence.
- **The first player to complete any group** does so in round 15, 11 and 9 on average with two, three and four players, long before the first bankruptcy. That player wins 65.9% (65.6 to 66.2), 57.5% (57.2 to 57.8) and 52.0% (51.7 to 52.3) of games, against even shares of 50%, 33.3% and 25%.
- **The dear groups are seldom built on.** In a four-player game Conquest of Shu has no building in 55% of the games where it is completed and reaches a fortress in 19%. Han Court reaches a fortress in 88%.

### Money and events

| Per game | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Rent paid | 4120 | 6326 | 8709 |
| Salary collected | 5442 | 6183 | 6816 |
| Spent on buildings | 3104 | 4456 | 6082 |
| Spent on property at list price | 3543 | 4402 | 4935 |
| Spent at auction | 695 | 829 | 650 |
| Cash in accepted trades | 469 | 955 | 1339 |
| Taxes paid | 1109 | 1271 | 1417 |
| Trades proposed | 6.98 | 10.94 | 13.18 |
| Trades accepted | 1.41 | 2.55 | 3.35 |
| Share of proposals accepted | 20.2% | 23.3% | 25.4% |
| Cash paid in accepted trades over the list price received | 208% | 208% | 208% |
| Building auctions (bank short of buildings) | 3.30 | 6.51 | 8.07 |
| Sales of buildings back to the bank | 5.90 | 9.82 | 12.97 |
| Mortgages taken | 16.22 | 19.81 | 20.10 |
| Mortgages redeemed | 6.58 | 11.43 | 13.28 |
| Bankruptcies to a player | 0.98 | 1.95 | 2.94 |
| Bankruptcies to the bank | 0.02 | 0.05 | 0.06 |
| Times sent to jail | 6.34 | 7.26 | 8.08 |
| Largest single rent | 2000 | 2000 | 2000 |

- Rent is the largest flow at four players and salary at two: 8,709 coins of rent against 6,816 of salary in a four-player game, 4,120 against 5,442 with two.
- A fifth to a quarter of offers are accepted, and the cash paid is 208% of the list price of what is received at every table size. That is the agent's own rule, offering 1.7 to 2.2 times the list price, and nothing else.
- The bank runs out of buildings as a matter of course: eight building auctions in a four-player game.
- Nearly every bankruptcy is to another player. The bank takes over an estate in about six four-player games in a hundred.

## What holdings are worth

### What players hold after ten rounds

For each kind of holding: the share of the players holding it after round 10 who went on to win, and how common the holding is.

| Holding | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Any player | 50.0% (49.8 to 50.2); 100.0% of players | 33.3% (33.2 to 33.5); 100.0% of players | 25.0% (24.9 to 25.1); 100.0% of players |
| 0 passes | 40.7% (40.3 to 41.1); 30.0% of players | 32.1% (31.9 to 32.4); 37.3% of players | 26.4% (26.2 to 26.6); 43.7% of players |
| 1 pass | 48.8% (48.4 to 49.1); 42.1% of players | 31.6% (31.4 to 31.9); 40.7% of players | 23.1% (22.9 to 23.3); 39.1% of players |
| 2 passes | 58.7% (58.2 to 59.1); 22.2% of players | 35.6% (35.2 to 36.0); 17.9% of players | 24.0% (23.6 to 24.3); 14.4% of players |
| 3 passes | 72.9% (72.0 to 73.7); 5.2% of players | 49.3% (48.4 to 50.3); 3.8% of players | 34.4% (33.5 to 35.4); 2.6% of players |
| 4 passes | 88.9% (86.7 to 90.8); 0.5% of players | 74.9% (72.0 to 77.7); 0.3% of players | 60.4% (56.8 to 63.9); 0.2% of players |
| 0 works | 49.1% (48.8 to 49.4); 56.0% of players | 33.6% (33.4 to 33.8); 61.7% of players | 25.6% (25.4 to 25.7); 66.3% of players |
| 1 works | 50.4% (50.0 to 50.7); 37.2% of players | 32.4% (32.1 to 32.7); 33.0% of players | 23.6% (23.3 to 23.8); 29.5% of players |
| 2 works | 55.4% (54.6 to 56.3); 6.9% of players | 36.6% (35.8 to 37.3); 5.3% of players | 26.5% (25.8 to 27.2); 4.2% of players |
| No complete group | 47.4% (47.1 to 47.6); 82.6% of players | 27.2% (27.0 to 27.4); 78.4% of players | 18.0% (17.9 to 18.1); 76.7% of players |
| One complete group | 62.3% (61.8 to 62.8); 17.1% of players | 55.3% (54.9 to 55.7); 21.2% of players | 47.5% (47.2 to 47.8); 22.8% of players |
| Two or more | 69.1% (65.6 to 72.4); 0.4% of players | 71.0% (68.4 to 73.5); 0.4% of players | 72.8% (70.9 to 74.8); 0.5% of players |
| Whole group: Han Court | 63.7% (62.8 to 64.6); 5.3% of players | 55.1% (54.5 to 55.8); 6.9% of players | 42.6% (42.0 to 43.1); 7.8% of players |
| Whole group: Chain Stratagem | 76.9% (75.8 to 77.9); 3.1% of players | 74.2% (73.4 to 75.0); 3.7% of players | 70.6% (69.9 to 71.4); 3.5% of players |
| Whole group: House of Yuan | 60.1% (58.6 to 61.5); 2.3% of players | 57.8% (56.8 to 58.9); 2.9% of players | 55.1% (54.2 to 56.0); 3.0% of players |
| Whole group: Cao Wei | 66.5% (65.1 to 67.9); 2.2% of players | 64.8% (63.8 to 65.9); 2.7% of players | 62.3% (61.4 to 63.2); 2.8% of players |
| Whole group: Shu Han | 47.1% (45.2 to 49.0); 1.3% of players | 39.0% (37.7 to 40.3); 1.7% of players | 36.7% (35.6 to 37.8); 1.9% of players |
| Whole group: Eastern Wu | 49.0% (46.3 to 51.7); 0.7% of players | 37.5% (35.7 to 39.4); 0.8% of players | 32.9% (31.5 to 34.4); 1.0% of players |
| Whole group: Conquest of Shu | 43.5% (39.7 to 47.3); 0.3% of players | 28.0% (25.4 to 30.7); 0.4% of players | 20.4% (18.6 to 22.3); 0.5% of players |
| Whole group: House of Sima | 55.8% (54.4 to 57.1); 2.6% of players | 42.4% (41.3 to 43.4); 2.9% of players | 37.9% (37.1 to 38.7); 3.5% of players |

- **A complete group this early more than doubles a player's chances** with three or four players: 47.5% against 18.0% for a player without one at four, 55.3% against 27.2% at three.
- **Which group matters a great deal.** At four players a whole Chain Stratagem wins 70.6%, Cao Wei 62.3% and House of Yuan 55.1%. Han Court, House of Sima, Shu Han and Eastern Wu win between 33% and 43%.
- **An early Conquest of Shu wins less than an even share at every table size**: 20.4% at four players, 28.0% at three, 43.5% at two. Its owner has put 920 coins into streets that cost 200 a building to develop.
- **Passes behave differently by table size.** With two players every pass helps: 40.7% with none, 48.8% with one, 58.7% with two, 72.9% with three. With four, holders of one or two passes win slightly less often than holders of none (23.1% and 24.0% against 26.4%), and only the third and fourth pay: 34.4% and 60.4%.
- **Works hardly matter.** Both together add six points with two players and one to three with more.

### In coins

A linear model puts these holdings on one scale. It predicts whether a player wins from what the player holds after round 10: an indicator for each property, one for each complete group, three for two, three and four passes, one for both works, the cash in hand and the money spent on buildings. Because cash is one of its terms, every other term can be restated as the cash that moves the chance of winning as far. A property bought at list price is a good purchase, by this model, when that figure exceeds the price.

A whole set, counting its properties and what the model adds for holding them together, in coins and as a multiple of the list price:

| Set | List price | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: | ---: |
| Han Court | 120 | 210 (1.75) | 451 (3.75) | 362 (3.01) |
| Chain Stratagem | 320 | 791 (2.47) | 1221 (3.82) | 1600 (5.00) |
| House of Yuan | 440 | 414 (0.94) | 907 (2.06) | 1349 (3.07) |
| Cao Wei | 560 | 812 (1.45) | 1384 (2.47) | 1958 (3.50) |
| Shu Han | 680 | 366 (0.54) | 745 (1.10) | 1230 (1.81) |
| Eastern Wu | 800 | 405 (0.51) | 731 (0.91) | 1115 (1.39) |
| Conquest of Shu | 920 | 242 (0.26) | 481 (0.52) | 784 (0.85) |
| House of Sima | 750 | 516 (0.69) | 836 (1.12) | 1321 (1.76) |
| Passes | 800 | 1779 (2.22) | 1870 (2.34) | 2001 (2.50) |
| Works | 300 | 349 (1.16) | 339 (1.13) | 340 (1.13) |

Each property on its own, and the extra for holding a set whole:

| Holding | Price | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: | ---: |
| Dong Zhuo | 60 | 139 (2.32) | 205 (3.42) | 213 (3.54) |
| Emperor Xian | 60 | 139 (2.31) | 224 (3.74) | 224 (3.73) |
| Hulao Pass | 200 | 393 (1.97) | 221 (1.11) | 167 (0.84) |
| Wang Yun | 100 | 167 (1.67) | 291 (2.91) | 348 (3.48) |
| Diaochan | 100 | 167 (1.67) | 288 (2.88) | 340 (3.40) |
| Lü Bu | 120 | 199 (1.66) | 286 (2.38) | 361 (3.01) |
| Yuan Shao | 140 | 90 (0.64) | 204 (1.46) | 327 (2.33) |
| Ironworks | 150 | 131 (0.88) | 92 (0.61) | 107 (0.71) |
| Xu You | 140 | 75 (0.54) | 177 (1.27) | 288 (2.06) |
| Yan Liang & Wen Chou | 160 | 67 (0.42) | 197 (1.23) | 320 (2.00) |
| Guandu Ford | 200 | 347 (1.74) | 200 (1.00) | 146 (0.73) |
| Cao Cao | 180 | 167 (0.93) | 248 (1.38) | 413 (2.30) |
| Cao Pi | 180 | 156 (0.87) | 255 (1.42) | 389 (2.16) |
| Xun Yu | 200 | 176 (0.88) | 268 (1.34) | 400 (2.00) |
| Liu Bei | 220 | 68 (0.31) | 115 (0.52) | 237 (1.08) |
| Guan Yu | 220 | 75 (0.34) | 118 (0.54) | 216 (0.98) |
| Zhuge Liang | 240 | 78 (0.33) | 133 (0.55) | 253 (1.05) |
| Changban Bridge | 200 | 386 (1.93) | 208 (1.04) | 143 (0.72) |
| Sun Quan | 260 | 71 (0.27) | 90 (0.34) | 191 (0.73) |
| Zhou Yu | 260 | 72 (0.28) | 92 (0.36) | 197 (0.76) |
| Salt Works | 150 | 128 (0.86) | 110 (0.73) | 98 (0.65) |
| Lu Xun | 280 | 77 (0.27) | 90 (0.32) | 201 (0.72) |
| Jiang Wei | 300 | 45 (0.15) | 38 (0.13) | 121 (0.40) |
| Deng Ai | 300 | 44 (0.15) | 30 (0.10) | 116 (0.39) |
| Zhong Hui | 320 | 33 (0.10) | 20 (0.06) | 128 (0.40) |
| Jiange Pass | 200 | 328 (1.64) | 152 (0.76) | 103 (0.51) |
| Sima Yi | 350 | 197 (0.56) | 271 (0.78) | 532 (1.52) |
| Sima Zhao | 400 | 213 (0.53) | 333 (0.83) | 637 (1.59) |
| Whole group: Han Court |  | -69 | 21 | -75 |
| Whole group: Chain Stratagem |  | 258 | 357 | 550 |
| Whole group: House of Yuan |  | 182 | 329 | 415 |
| Whole group: Cao Wei |  | 312 | 613 | 755 |
| Whole group: Shu Han |  | 146 | 380 | 524 |
| Whole group: Eastern Wu |  | 186 | 459 | 526 |
| Whole group: Conquest of Shu |  | 120 | 393 | 418 |
| Whole group: House of Sima |  | 106 | 232 | 152 |
| two or more passes |  | 37 | 99 | 109 |
| three or more passes |  | 131 | 362 | 416 |
| all four passes |  | 156 | 628 | 916 |
| both works |  | 89 | 138 | 135 |

- **List price is wrong by a factor of five one way and four the other.** A whole Chain Stratagem is worth five times its price at four players. A whole Conquest of Shu is worth less than its price at every table size, and a quarter of it with two players.
- **The cheap side of the board is underpriced and the dear side overpriced.** At four players every street of Han Court, Chain Stratagem, House of Yuan and Cao Wei is worth between 2.0 and 3.7 times its price; a street of Shu Han is worth about its price; streets of Eastern Wu and Conquest of Shu are worth less.
- **Every group but Han Court is worth more the larger the table,** where there are more opponents to pay rent. A single pass goes the other way: 1.6 to 2.0 times its price with two players, 0.5 to 0.8 with four.
- **The four passes together are worth 2.2 to 2.5 times their price at every table size.** With two players that value is spread evenly over the four. With four players about two thirds of it is in what the model adds for the third pass and the fourth.
- **House of Sima is a special case.** Each of its two streets is worth one and a half times its price at four players, and holding both adds little more. The study does not say why.
- **Both works are worth slightly more than their price** at every size, and one alone is worth less.

The model itself, in percentage points of the chance of winning, with standard errors in brackets:

| Feature | Price | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: | ---: |
| (intercept) |  | -4.98 (0.84) | -24.08 (0.61) | -31.98 (0.43) |
| Dong Zhuo | 60 | 4.86 (0.34) | 6.46 (0.29) | 5.33 (0.26) |
| Emperor Xian | 60 | 4.83 (0.30) | 7.08 (0.25) | 5.61 (0.22) |
| Hulao Pass | 200 | 13.69 (0.33) | 6.98 (0.24) | 4.19 (0.19) |
| Wang Yun | 100 | 5.82 (0.26) | 9.16 (0.21) | 8.73 (0.17) |
| Diaochan | 100 | 5.81 (0.26) | 9.07 (0.21) | 8.53 (0.17) |
| Lü Bu | 120 | 6.92 (0.27) | 9.01 (0.21) | 9.06 (0.18) |
| Yuan Shao | 140 | 3.12 (0.26) | 6.44 (0.21) | 8.19 (0.17) |
| Ironworks | 150 | 4.57 (0.29) | 2.90 (0.22) | 2.68 (0.18) |
| Xu You | 140 | 2.63 (0.28) | 5.60 (0.22) | 7.21 (0.18) |
| Yan Liang & Wen Chou | 160 | 2.34 (0.27) | 6.20 (0.22) | 8.01 (0.18) |
| Guandu Ford | 200 | 12.08 (0.34) | 6.31 (0.25) | 3.67 (0.20) |
| Cao Cao | 180 | 5.83 (0.27) | 7.82 (0.21) | 10.36 (0.18) |
| Cao Pi | 180 | 5.44 (0.27) | 8.04 (0.21) | 9.76 (0.17) |
| Xun Yu | 200 | 6.14 (0.27) | 8.46 (0.21) | 10.03 (0.17) |
| Liu Bei | 220 | 2.36 (0.27) | 3.61 (0.21) | 5.94 (0.17) |
| Guan Yu | 220 | 2.62 (0.28) | 3.71 (0.22) | 5.43 (0.18) |
| Zhuge Liang | 240 | 2.72 (0.27) | 4.18 (0.21) | 6.34 (0.17) |
| Changban Bridge | 200 | 13.44 (0.35) | 6.56 (0.26) | 3.59 (0.20) |
| Sun Quan | 260 | 2.46 (0.28) | 2.82 (0.22) | 4.78 (0.18) |
| Zhou Yu | 260 | 2.51 (0.28) | 2.91 (0.22) | 4.94 (0.18) |
| Salt Works | 150 | 4.47 (0.30) | 3.46 (0.23) | 2.45 (0.19) |
| Lu Xun | 280 | 2.67 (0.28) | 2.84 (0.22) | 5.05 (0.18) |
| Jiang Wei | 300 | 1.58 (0.28) | 1.19 (0.22) | 3.04 (0.18) |
| Deng Ai | 300 | 1.52 (0.28) | 0.96 (0.22) | 2.91 (0.18) |
| Zhong Hui | 320 | 1.16 (0.29) | 0.63 (0.23) | 3.22 (0.18) |
| Jiange Pass | 200 | 11.43 (0.36) | 4.79 (0.27) | 2.58 (0.21) |
| Sima Yi | 350 | 6.84 (0.33) | 8.55 (0.26) | 13.34 (0.21) |
| Sima Zhao | 400 | 7.42 (0.31) | 10.50 (0.24) | 15.98 (0.20) |
| Whole group: Han Court |  | -2.39 (0.77) | 0.66 (0.57) | -1.87 (0.46) |
| Whole group: Chain Stratagem |  | 8.98 (0.85) | 11.24 (0.63) | 13.80 (0.51) |
| Whole group: House of Yuan |  | 6.34 (0.90) | 10.36 (0.65) | 10.41 (0.52) |
| Whole group: Cao Wei |  | 10.86 (0.87) | 19.32 (0.62) | 18.94 (0.50) |
| Whole group: Shu Han |  | 5.07 (1.02) | 11.99 (0.70) | 13.15 (0.55) |
| Whole group: Eastern Wu |  | 6.46 (1.37) | 14.46 (0.94) | 13.18 (0.69) |
| Whole group: Conquest of Shu |  | 4.17 (1.92) | 12.39 (1.35) | 10.49 (0.96) |
| Whole group: House of Sima |  | 3.69 (0.78) | 7.32 (0.58) | 3.81 (0.44) |
| two or more passes |  | 1.28 (0.44) | 3.11 (0.34) | 2.73 (0.27) |
| three or more passes |  | 4.57 (0.58) | 11.41 (0.49) | 10.44 (0.44) |
| all four passes |  | 5.44 (1.64) | 19.79 (1.51) | 22.98 (1.51) |
| both works |  | 3.09 (0.55) | 4.34 (0.45) | 3.38 (0.39) |
| cash, per starting stake |  | 52.21 (0.81) | 47.29 (0.56) | 37.61 (0.39) |
| spent on buildings, per starting stake |  | 90.99 (1.77) | 97.44 (1.09) | 86.42 (0.76) |

### Later rounds

The same whole sets after round 20:

| Set | List price | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: | ---: |
| Han Court | 120 | 221 (1.84) | 378 (3.15) | 244 (2.03) |
| Chain Stratagem | 320 | 656 (2.05) | 1033 (3.23) | 1696 (5.30) |
| House of Yuan | 440 | 408 (0.93) | 694 (1.58) | 1255 (2.85) |
| Cao Wei | 560 | 746 (1.33) | 1101 (1.97) | 2037 (3.64) |
| Shu Han | 680 | 393 (0.58) | 518 (0.76) | 1001 (1.47) |
| Eastern Wu | 800 | 450 (0.56) | 440 (0.55) | 794 (0.99) |
| Conquest of Shu | 920 | 319 (0.35) | 166 (0.18) | 312 (0.34) |
| House of Sima | 750 | 517 (0.69) | 648 (0.86) | 1300 (1.73) |
| Passes | 800 | 1569 (1.96) | 1470 (1.84) | 951 (1.19) |
| Works | 300 | 323 (1.08) | 216 (0.72) | 42 (0.14) |

At four players the cheap groups hold their value and the passes lose half of theirs, as an income that cannot grow would. Conquest of Shu falls further. These figures are less clean than those for round 10, because by round 20 what a player holds is partly a result of how the game is going. The script prints the tables for rounds 20 and 30 in full.

## Who is ahead

No single number says how a player stands. The study keeps a list of measures, each a function of the state and a seat, and asks of each one how well it tells who will win.

### The measures

| Measure | What it counts |
| --- | --- |
| Net worth | Cash, property at list price (half if mortgaged) and buildings at cost: what the rules use to rank players. |
| Cash in hand | |
| Spare cash | Cash above the largest rent or tax the player could owe on the next roll. Never below zero. |
| Disposable funds | Spare cash, plus what mortgaging every property outside the player's complete groups would raise. |
| Everything it could raise | Cash with every property mortgaged and every building sold back. |
| Danger | The rent and tax the player expects to pay on the next roll, over the 36 throws of two dice. |
| Rent roll | The rent each of the player's properties would charge now, added up. |
| Rent it could add at once | The rise in the rent roll if all the cash in hand went on buildings, best gain per coin first, building evenly. |
| Rent roll within reach | The two above together. |
| Room to grow beyond that | The rent roll with every complete group fully built, less the rent roll within reach. |
| Rent roll fully built | The rent roll with every complete group at a fortress. |
| Complete groups | |
| Groups one street short | Groups in which the player lacks exactly one street. |
| The same, the street held by a rival | The subset where the missing street is owned and so can only come by trade or bankruptcy. |
| Sets in which it holds the one property a rival lacks | A count of the player's blocking positions. |
| Trading chips | The list price of what the player holds that rivals are collecting: in full where it is the last property a rival lacks, in part where a rival holds some of the set. |
| Passes held | |
| Properties held | |
| Spent on buildings | |
| Property under mortgage | At list price. |

### The leader by each measure

How often the player who leads by a measure goes on to win. A tie shares the credit, and a position in which every player is level on a measure is left out for that measure. "Danger" and "Property under mortgage" are measures a player does not want to lead.

Two players:

| Leader by | Round 10 | Round 20 | Round 30 | Round 40 | Round 60 | Round 80 | Round 100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| (Games that last this long) | 100.0% | 99.7% | 97.9% | 92.3% | 65.6% | 33.9% | 13.9% |
| (A leader picked at random) | 50.0% | 50.0% | 50.0% | 50.0% | 50.0% | 50.0% | 50.0% |
| Net worth, as the rules count it | 58.8% | 68.3% | 75.3% | 80.4% | 86.3% | 88.0% | 87.8% |
| Cash in hand | 53.6% | 55.6% | 55.5% | 57.8% | 66.3% | 73.0% | 77.2% |
| Spare cash: above the largest rent within one roll | 54.4% | 57.9% | 60.7% | 65.0% | 74.2% | 79.4% | 82.1% |
| Disposable funds: spare cash plus mortgages on property outside its complete groups | 53.9% | 57.1% | 61.7% | 67.1% | 76.4% | 80.9% | 82.5% |
| Everything it could raise: all mortgaged, all buildings sold | 57.7% | 67.4% | 74.4% | 79.5% | 85.8% | 87.5% | 87.1% |
| Danger: rent and tax expected on its next roll | 48.0% | 43.0% | 38.2% | 34.9% | 31.5% | 29.9% | 30.3% |
| Rent roll: what its properties charge now | 61.4% | 72.9% | 78.2% | 81.7% | 86.5% | 88.0% | 87.8% |
| Rent it could add at once by building with the cash in hand | 63.8% | 65.9% | 66.9% | 67.7% | 61.6% | 50.4% | 41.0% |
| Rent roll within reach: now plus what cash could add | 61.4% | 73.2% | 78.4% | 82.4% | 87.3% | 88.3% | 87.7% |
| Room to grow beyond that: fully built, less the rent roll within reach | 58.7% | 59.3% | 58.6% | 54.1% | 40.4% | 29.5% | 22.1% |
| Rent roll with its groups fully built | 59.9% | 65.0% | 67.1% | 68.3% | 69.1% | 67.7% | 63.2% |
| Complete groups | 65.4% | 69.4% | 73.0% | 74.1% | 71.0% | 66.7% | 61.3% |
| Groups one street short | 46.1% | 46.9% | 47.7% | 47.7% | 47.4% | 46.9% | 46.9% |
| Groups one street short, the street held by a rival | 44.6% | 46.4% | 47.5% | 47.9% | 47.5% | 46.8% | 46.9% |
| Sets in which it holds the one property a rival lacks | 53.1% | 51.0% | 49.6% | 49.0% | 49.7% | 51.1% | 51.7% |
| Trading chips: what it holds that rivals are collecting, at list price | 49.4% | 49.3% | 49.8% | 49.9% | 49.9% | 50.2% | 49.9% |
| Passes held | 60.5% | 63.3% | 65.1% | 66.0% | 64.9% | 60.7% | 56.8% |
| Properties held | 55.1% | 65.2% | 69.2% | 70.2% | 69.0% | 65.4% | 59.8% |
| Spent on buildings | 69.0% | 70.6% | 74.6% | 79.8% | 86.3% | 87.6% | 86.8% |
| Property under mortgage, at list price | 33.7% | 28.1% | 22.7% | 17.6% | 14.0% | 14.3% | 14.7% |

Three players:

| Leader by | Round 10 | Round 20 | Round 30 | Round 40 | Round 60 | Round 80 | Round 100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| (Games that last this long) | 100.0% | 99.6% | 95.3% | 81.2% | 34.7% | 9.1% | 2.5% |
| (A leader picked at random) | 33.3% | 33.7% | 35.2% | 37.9% | 43.9% | 46.9% | 47.8% |
| Net worth, as the rules count it | 45.1% | 59.2% | 71.5% | 79.7% | 84.9% | 83.9% | 82.7% |
| Cash in hand | 33.8% | 38.5% | 45.0% | 52.4% | 64.2% | 65.4% | 60.6% |
| Spare cash: above the largest rent within one roll | 34.8% | 42.5% | 51.7% | 60.8% | 71.8% | 71.0% | 65.1% |
| Disposable funds: spare cash plus mortgages on property outside its complete groups | 34.6% | 36.9% | 46.4% | 57.8% | 72.7% | 72.9% | 67.1% |
| Everything it could raise: all mortgaged, all buildings sold | 39.8% | 54.4% | 67.9% | 76.8% | 82.4% | 79.6% | 76.1% |
| Danger: rent and tax expected on its next roll | 30.5% | 26.2% | 22.3% | 20.7% | 22.8% | 25.7% | 28.4% |
| Rent roll: what its properties charge now | 51.9% | 66.3% | 74.1% | 80.6% | 86.1% | 86.6% | 87.1% |
| Rent it could add at once by building with the cash in hand | 58.0% | 55.7% | 57.1% | 55.9% | 53.9% | 52.1% | 56.3% |
| Rent roll within reach: now plus what cash could add | 52.6% | 67.0% | 75.5% | 81.8% | 86.4% | 86.8% | 87.5% |
| Room to grow beyond that: fully built, less the rent roll within reach | 51.4% | 44.3% | 40.3% | 37.5% | 36.0% | 35.3% | 38.3% |
| Rent roll with its groups fully built | 49.5% | 54.6% | 59.2% | 64.4% | 66.7% | 59.6% | 57.3% |
| Complete groups | 59.6% | 59.4% | 63.9% | 68.0% | 67.5% | 60.5% | 59.1% |
| Groups one street short | 30.9% | 26.4% | 27.9% | 33.5% | 48.4% | 52.8% | 54.2% |
| Groups one street short, the street held by a rival | 28.2% | 25.4% | 27.3% | 33.0% | 48.2% | 52.8% | 54.2% |
| Sets in which it holds the one property a rival lacks | 31.9% | 31.5% | 31.3% | 31.2% | 33.4% | 39.2% | 41.8% |
| Trading chips: what it holds that rivals are collecting, at list price | 28.3% | 26.7% | 27.9% | 31.0% | 40.4% | 45.5% | 47.3% |
| Passes held | 37.0% | 38.4% | 41.2% | 44.9% | 51.0% | 49.5% | 47.1% |
| Properties held | 40.2% | 46.5% | 53.1% | 58.6% | 63.1% | 57.7% | 55.6% |
| Spent on buildings | 66.0% | 67.5% | 73.7% | 80.3% | 85.5% | 86.0% | 87.5% |
| Property under mortgage, at list price | 22.1% | 14.8% | 13.0% | 14.7% | 18.5% | 21.3% | 24.5% |

Four players:

| Leader by | Round 10 | Round 20 | Round 30 | Round 40 | Round 60 | Round 80 | Round 100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| (Games that last this long) | 100.0% | 99.2% | 88.9% | 62.1% | 16.8% | 4.0% | 1.1% |
| (A leader picked at random) | 25.0% | 26.0% | 30.1% | 35.2% | 41.1% | 42.9% | 43.8% |
| Net worth, as the rules count it | 40.1% | 59.5% | 72.7% | 78.4% | 79.6% | 76.6% | 72.9% |
| Cash in hand | 21.6% | 27.8% | 38.3% | 45.9% | 48.6% | 44.7% | 39.3% |
| Spare cash: above the largest rent within one roll | 22.3% | 32.3% | 45.3% | 54.2% | 56.0% | 50.7% | 45.5% |
| Disposable funds: spare cash plus mortgages on property outside its complete groups | 24.2% | 30.3% | 45.6% | 56.9% | 59.6% | 54.0% | 47.9% |
| Everything it could raise: all mortgaged, all buildings sold | 29.0% | 47.8% | 64.5% | 72.2% | 72.8% | 67.6% | 63.5% |
| Danger: rent and tax expected on its next roll | 21.2% | 16.6% | 14.6% | 16.0% | 19.2% | 19.5% | 18.6% |
| Rent roll: what its properties charge now | 48.6% | 64.6% | 76.1% | 82.4% | 86.4% | 87.4% | 88.7% |
| Rent it could add at once by building with the cash in hand | 53.2% | 52.8% | 53.9% | 56.3% | 62.5% | 69.2% | 72.9% |
| Rent roll within reach: now plus what cash could add | 49.6% | 67.0% | 78.0% | 83.6% | 87.0% | 88.2% | 89.0% |
| Room to grow beyond that: fully built, less the rent roll within reach | 45.5% | 36.2% | 34.8% | 37.5% | 44.3% | 50.7% | 56.9% |
| Rent roll with its groups fully built | 45.0% | 51.7% | 61.1% | 67.3% | 69.5% | 70.9% | 73.2% |
| Complete groups | 52.3% | 53.7% | 61.9% | 66.9% | 68.8% | 70.2% | 71.9% |
| Groups one street short | 27.1% | 23.7% | 32.9% | 46.4% | 60.1% | 65.9% | 68.0% |
| Groups one street short, the street held by a rival | 25.8% | 22.7% | 32.6% | 46.5% | 60.2% | 66.0% | 68.0% |
| Sets in which it holds the one property a rival lacks | 23.5% | 23.2% | 24.1% | 24.8% | 27.0% | 26.2% | 26.0% |
| Trading chips: what it holds that rivals are collecting, at list price | 21.3% | 20.7% | 27.7% | 36.2% | 44.1% | 44.7% | 45.0% |
| Passes held | 25.2% | 27.4% | 35.5% | 43.2% | 49.5% | 50.6% | 52.6% |
| Properties held | 35.8% | 43.7% | 55.7% | 63.7% | 67.0% | 68.5% | 69.1% |
| Spent on buildings | 59.3% | 66.1% | 76.5% | 82.5% | 86.6% | 87.4% | 88.7% |
| Property under mortgage, at list price | 15.9% | 11.1% | 13.9% | 18.0% | 23.9% | 27.5% | 32.3% |

- **From round 20 on, the best guides are the rent roll within reach, the plain rent roll and the money spent on buildings,** at every table size and within a point or two of each other.
- **Net worth is a weaker guide than any of those three until late.** At four players its leader wins 40.1%, 59.5%, 72.7% and 78.4% after rounds 10, 20, 30 and 40, against 49.6%, 67.0%, 78.0% and 83.6% for the leader by rent roll within reach.
- **At round 10 the clearest signs are a complete group and buildings,** where any player has them: the leader by money spent on buildings wins 69.0%, 66.0% and 59.3% with two, three and four players. Those measures separate the players in only a quarter to two thirds of positions that early.
- **Cash misleads.** With three or four players the leader in cash after round 10 wins no more often than a player picked at random, and at four players less often (21.6% against 25.0%). Early on, cash in hand is property not bought.
- **Debt is the clearest bad sign.** The player with the most property under mortgage after round 20 wins 28.1%, 14.8% and 11.1%.
- **What a player holds that rivals want does not show as an advantage.** The leader in trading chips wins less often than a random player through round 30 with three or four players, and exactly as often with two. The next section and [the tables on trading](#trading) say why.
- **Late in a long game cash means different things at different tables.** In the few games that reach round 100, the leader in cash wins 77.2% with two players. With four it wins 39.3%, less than a player picked at random among those still in.

### The measures together

A measure can matter only once the others are known. The table below takes each measure as the player's share of the table's total and gives two figures at round 20: its correlation with winning on its own, and its weight in a linear model that holds eleven of the measures at once, in percentage points of the chance of winning for one standard deviation. The other nine measures are sums or parts of those eleven and are left out of the model.

| Measure | Correlation, 2 players | 3 players | 4 players | Weight together, 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Net worth, as the rules count it | 0.44 | 0.45 | 0.51 |  |  |  |
| Cash in hand | 0.16 | 0.13 | 0.09 |  |  |  |
| Spare cash: above the largest rent within one roll | 0.18 | 0.19 | 0.17 |  |  |  |
| Disposable funds: spare cash plus mortgages on property outside its complete groups | 0.18 | 0.09 | 0.13 | 4.22 (0.15) | 4.56 (0.10) | 3.14 (0.07) |
| Everything it could raise: all mortgaged, all buildings sold | 0.42 | 0.40 | 0.42 |  |  |  |
| Danger: rent and tax expected on its next roll | -0.18 | -0.17 | -0.18 | 0.83 (0.10) | 0.35 (0.07) | -0.29 (0.06) |
| Rent roll: what its properties charge now | 0.53 | 0.57 | 0.61 | 23.82 (0.11) | 24.77 (0.08) | 23.95 (0.06) |
| Rent it could add at once by building with the cash in hand | 0.19 | 0.26 | 0.32 | 2.67 (0.12) | 3.40 (0.09) | 5.21 (0.07) |
| Rent roll within reach: now plus what cash could add | 0.54 | 0.59 | 0.63 |  |  |  |
| Room to grow beyond that: fully built, less the rent roll within reach | 0.15 | 0.18 | 0.19 | 4.25 (0.12) | 4.31 (0.10) | 3.04 (0.07) |
| Rent roll with its groups fully built | 0.37 | 0.43 | 0.48 |  |  |  |
| Complete groups | 0.25 | 0.40 | 0.45 |  |  |  |
| Groups one street short | -0.06 | -0.12 | -0.03 | 1.68 (0.14) | 1.61 (0.10) | 2.97 (0.09) |
| Groups one street short, the street held by a rival | -0.06 | -0.13 | -0.04 | -0.67 (0.12) | -0.51 (0.11) | 0.23 (0.09) |
| Sets in which it holds the one property a rival lacks | 0.02 | -0.03 | -0.03 | 1.84 (0.12) | 1.54 (0.10) | 1.14 (0.07) |
| Trading chips: what it holds that rivals are collecting, at list price | 0.00 | -0.16 | -0.10 | -0.01 (0.09) | -3.13 (0.11) | -1.90 (0.09) |
| Passes held | 0.25 | 0.08 | 0.03 | 2.88 (0.11) | -0.09 (0.08) | -0.81 (0.06) |
| Properties held | 0.32 | 0.23 | 0.31 |  |  |  |
| Spent on buildings | 0.29 | 0.48 | 0.54 |  |  |  |
| Property under mortgage, at list price | -0.17 | -0.15 | -0.12 | -1.18 (0.10) | -0.51 (0.08) | -0.63 (0.06) |

The same weights after round 10, when holdings are closest to luck:

| Measure | Weight together, 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Disposable funds: spare cash plus mortgages on property outside its complete groups | 8.74 (0.14) | 8.12 (0.11) | 6.36 (0.08) |
| Danger: rent and tax expected on its next roll | 3.03 (0.11) | 2.27 (0.09) | 1.61 (0.07) |
| Rent roll: what its properties charge now | 15.74 (0.12) | 18.20 (0.10) | 17.23 (0.07) |
| Rent it could add at once by building with the cash in hand | 2.27 (0.17) | 3.17 (0.13) | 3.90 (0.10) |
| Room to grow beyond that: fully built, less the rent roll within reach | 2.57 (0.18) | 3.85 (0.14) | 3.86 (0.11) |
| Groups one street short | -1.49 (0.11) | 0.47 (0.09) | 3.02 (0.07) |
| Groups one street short, the street held by a rival | -0.96 (0.11) | -0.19 (0.09) | 1.31 (0.08) |
| Sets in which it holds the one property a rival lacks | 1.41 (0.11) | 1.34 (0.09) | 0.90 (0.07) |
| Trading chips: what it holds that rivals are collecting, at list price | 0.22 (0.11) | -4.89 (0.09) | -3.46 (0.08) |
| Passes held | 2.66 (0.12) | -1.11 (0.09) | -2.08 (0.07) |
| Property under mortgage, at list price | -0.65 (0.11) | 0.08 (0.08) | 0.01 (0.06) |

- **The rent roll carries most of the weight**: 16 to 18 points for a standard deviation at round 10, and 24 to 25 at round 20.
- **Funds matter once the rent roll is held equal.** Disposable funds have almost no correlation with winning at round 10 on their own (0.03, −0.07 and −0.10 with two, three and four players), and the second largest weight in the model: 8.7, 8.1 and 6.4 points. Two players with the same rent roll are separated by what they can still spend.
- **Potential counts in both its forms.** The rent that could be added at once and the room beyond it each carry 2 to 5 points.
- **Trading chips carry a negative weight with three or four players** (−4.9 and −3.5 points at round 10), and none with two. At these tables, holding what a rival is collecting mostly means selling it to the rival at about twice its list price, which completes the rival's group. The same holdings in the hands of a player who refuses to sell win more than an even share; see [Trading](#trading).
- **Blocking positions carry a small positive weight** (0.9 to 1.8 points) at every size.
- **Passes carry weight only with two players**: 2.7 to 2.9 points there, and nothing or less with three or four.
- **Being one street short of a group is worth three points with four players,** where there are rivals to buy the street from, and nothing with two.

How much of the variance in winning each account explains:

| After | Players | Net worth alone | Rent roll alone | Rent roll within reach alone | What is held (the linear model) | Eleven measures together |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Round 10 | 2 | 4.6% | 8.6% | 8.6% | 9.6% | 11.6% |
| Round 10 | 3 | 5.2% | 12.7% | 13.5% | 15.0% | 15.8% |
| Round 10 | 4 | 7.0% | 15.0% | 16.2% | 18.2% | 18.4% |
| Round 20 | 2 | 19.4% | 28.5% | 29.2% | 21.5% | 30.7% |
| Round 20 | 3 | 20.5% | 33.0% | 34.3% | 27.2% | 35.2% |
| Round 20 | 4 | 25.6% | 36.9% | 39.4% | 31.4% | 39.7% |
| Round 30 | 2 | 32.4% | 41.0% | 41.8% | 30.5% | 43.5% |
| Round 30 | 3 | 35.3% | 46.5% | 48.3% | 36.4% | 48.2% |
| Round 30 | 4 | 42.0% | 54.0% | 55.7% | 43.7% | 55.2% |

Net worth explains about half of what the rent roll within reach explains at round 10, or less, and about two thirds at round 20. The eleven measures together add two to three points to the rent roll within reach alone at round 10, and almost nothing later. That is a statement about the agents as much as about the game: they all develop property in the same way, so little else separates them.

For every measure the script also prints the mean among eventual winners and among the rest, the share of positions in which it separates the players, and its correlation with winning at each round.

## The valuation V1

The measures above judge a seat one number at a time. V1, built in stage M1 of [the plan](plan/m01-valuation.md), weighs 54 of them together and gives every seat still in a chance of winning; the chances of a table add up to one. Its weights are not constants: each is fitted at rounds 5, 10, 20, 30, 45 and 60 and moves in a straight line between them. It was fitted on 18 November 2026 from snapshots taken every five rounds of the same 100,000 games at each table size: seeds 1 to 70,000 to fit, 70,001 to 85,000 to choose the penalties, 85,001 to 100,000 to test. Every figure below is from the test games.

**Log loss** (lower is better; the column on the right is how much worse than V1, with a 95% interval by bootstrap over games):

| Players | Even shares | Share of net worth | Share of the rent roll within reach | V1 |
| ---: | ---: | ---: | ---: | ---: |
| 2 | 0.693 | 0.448 (+0.065, 0.061 to 0.069) | 0.418 (+0.035, 0.032 to 0.038) | 0.383 |
| 3 | 1.013 | 0.690 (+0.118, 0.113 to 0.123) | 0.631 (+0.059, 0.056 to 0.062) | 0.572 |
| 4 | 1.242 | 0.857 (+0.181, 0.175 to 0.188) | 0.756 (+0.081, 0.077 to 0.085) | 0.675 |

**How often the leader goes on to win:**

| Players | Leader by | Round 10 | Round 20 | Round 30 | Round 40 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 2 | Net worth | 58.6% | 68.2% | 75.7% | 80.7% |
| 2 | Rent roll within reach | 61.6% | 73.5% | 78.9% | 83.1% |
| 2 | V1 | 67.3% | 76.3% | 81.6% | 85.2% |
| 3 | Net worth | 44.7% | 59.2% | 71.4% | 79.1% |
| 3 | Rent roll within reach | 52.6% | 67.1% | 75.3% | 81.6% |
| 3 | V1 | 58.8% | 70.9% | 77.8% | 82.6% |
| 4 | Net worth | 40.3% | 59.6% | 72.4% | 78.3% |
| 4 | Rent roll within reach | 49.9% | 66.4% | 77.5% | 83.4% |
| 4 | V1 | 56.8% | 70.5% | 79.5% | 84.8% |

Each figure has an interval of about ±0.8 points.

**Calibration.** In every tenth of V1's predictions, the share of seats that went on to win is within 1.1, 1.6 and 2.6 points of the mean prediction with two, three and four players.

- **V1 tells who is ahead better than any single measure, at every table size and every round tested.** After ten rounds of a four-player game its leader wins 56.8%, against 40.3% for the leader by net worth and 49.9% for the leader by the rent roll within reach.
- **What a holding is worth moves through the game.** At four players the weight on the rent roll grows from 0.58 at round 5 to 3.9 at round 60, and the weight on cash falls from 3.2 to nothing by round 30. The extra weight for holding all four passes falls from 1.67 at round 5 to 0.05 at round 30: the passes' early edge is gone by the middle of the game, as the regression after round 20 suggested.
- **Single weights are not values.** Many features move together (a whole group raises the rent roll and the room to grow), so a weight read alone can mislead; the weight for a whole group turns negative late in the game because the rent roll has taken over its role. What a change is worth is read through `priceOf`, which asks how much cash moves the chance as far, and through the intervention study below.

The full report, with every weight at every knot, is printed by `node scripts/fit-valuation.ts`.

## Trading

Full games among rule-based players as they are, and among the same players when nobody proposes or accepts a trade:

| Measure | 2, trading | 3, trading | 4, trading | 2, no trades | 3, no trades | 4, no trades |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Games played | 100000 | 100000 | 100000 | 2000 | 2000 | 2000 |
| Finished within the action limit | 100.0% (100.0 to 100.0) | 100.0% (100.0 to 100.0) | 100.0% (100.0 to 100.0) | 86.7% (85.1 to 88.1) | 58.1% (55.9 to 60.2) | 38.9% (36.8 to 41.1) |
| Turns per game, all games | 146 | 168 | 188 | 2631 | 7840 | 11364 |
| Turns in a finished game, mean | 146 | 168 | 188 | 210 | 250 | 327 |
| Games in which a group is completed | 100.0% | 100.0% | 100.0% | 93.4% | 68.4% | 50.6% |
| Games in which every property is owned | 61.3% | 73.6% | 80.8% | 75.3% | 92.3% | 96.4% |
| Games with a bankruptcy | 100.0% | 100.0% | 100.0% | 86.7% | 58.3% | 40.2% |

Trade is what ends the game. Without it, 13% of two-player games, 42% of three-player games and 61% of four-player games are still running after 40,000 actions, and a group is completed in only half of the four-player games. The games that do finish take 44% to 74% more turns.

## One odd player among ordinary ones

One seat plays differently from the others. The share of games that seat wins is set against an even share.

| Table | Games | Finished | Odd player wins | An even share | Turns, mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| One rule-based among 1 random | 20000 | 100.00% | 91.1% (90.7 to 91.5) | 50.0% | 121.9 |
| One rule-based among 2 random | 20000 | 100.00% | 92.5% (92.1 to 92.8) | 33.3% | 148.0 |
| One rule-based among 3 random | 20000 | 100.00% | 93.7% (93.4 to 94.1) | 25.0% | 169.1 |
| One random among 2 rule-based | 20000 | 100.00% | 2.5% (2.3 to 2.7) | 33.3% | 165.0 |
| One random among 3 rule-based | 20000 | 100.00% | 1.0% (0.9 to 1.1) | 25.0% | 183.5 |
| One no-works among 1 rule-based | 20000 | 100.00% | 45.8% (45.2 to 46.5) | 50.0% | 144.3 |
| One no-works among 2 rule-based | 20000 | 100.00% | 34.3% (33.6 to 34.9) | 33.3% | 167.3 |
| One no-works among 3 rule-based | 20000 | 100.00% | 26.1% (25.5 to 26.7) | 25.0% | 187.0 |
| One no-conquest among 1 rule-based | 20000 | 100.00% | 48.2% (47.5 to 48.9) | 50.0% | 134.5 |
| One no-conquest among 2 rule-based | 20000 | 100.00% | 40.5% (39.9 to 41.2) | 33.3% | 163.0 |
| One no-conquest among 3 rule-based | 20000 | 100.00% | 28.7% (28.1 to 29.3) | 25.0% | 183.9 |
| One refuser among 1 rule-based | 20000 | 100.00% | 58.2% (57.5 to 58.9) | 50.0% | 163.9 |
| One refuser among 2 rule-based | 20000 | 99.69% | 41.0% (40.3 to 41.7) | 33.3% | 194.1 |
| One refuser among 3 rule-based | 20000 | 99.82% | 30.4% (29.7 to 31.0) | 25.0% | 214.0 |
| One quiet among 1 rule-based | 20000 | 99.99% | 42.3% (41.6 to 43.0) | 50.0% | 163.3 |
| One quiet among 2 rule-based | 20000 | 100.00% | 14.2% (13.7 to 14.6) | 33.3% | 188.0 |
| One quiet among 3 rule-based | 20000 | 100.00% | 5.9% (5.6 to 6.2) | 25.0% | 205.9 |

- **The rule-based agent beats random play** nine times in ten at every table size. One random player among rule-based ones wins 2.5% of three-player games and 1.0% of four-player games.
- **Refusing every offer pays.** The refuser wins 58.2%, 41.0% and 30.4%, well above an even share at every size. It keeps the streets its rivals need, and goes on buying the streets it needs from rivals who sell at twice the list price. The agent's selling price is too low.
- **Never proposing is ruinous.** The quiet player wins 42.3%, 14.2% and 5.9%. It sells to rivals who ask and never asks in turn. No other change tested here costs as much.
- **Shunning Conquest of Shu helps with three or four players** (40.5% and 28.7%) and costs a little with two (48.2%), where the one rival then takes the streets at auction for the opening bid.
- **Shunning the works costs four points with two players** (45.8%), for the same reason, and gains about one point with three or four.

## The short game

Twenty thousand games at each size under [the short-game rules](rules.md#the-short-game): two properties dealt to each player, a fortress after three farmsteads, and an end at the second bankruptcy with the players left ranked by net worth.

| Measure | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Games played | 20000 | 20000 | 20000 |
| Finished within the action limit | 100.00% | 100.00% | 100.00% |
| Turns in a finished game, mean | 138.2 | 156.3 | 144.7 |
| Rounds in a finished game, mean | 69.1 | 52.1 | 36.2 |
| Turns, 10th percentile | 85 | 95 | 85 |
| Turns, median | 135 | 155 | 135 |
| Turns, 90th percentile | 205 | 225 | 215 |
| Turns, 99th percentile | 285 | 325 | 315 |
| Actions per game, mean | 511 | 623 | 572 |
| Every property owned: share of games | 60.2% | 71.6% | 67.6% |
| Every property owned: mean round | 52.7 | 35.2 | 25.4 |
| First group completed: share of games | 100.0% | 100.0% | 100.0% |
| First group completed: mean round | 12.5 | 8.2 | 5.7 |
| First building: share of games | 100.0% | 100.0% | 100.0% |
| First building: mean round | 14.7 | 9.0 | 6.2 |
| First bankruptcy: share of games | 100.0% | 100.0% | 100.0% |
| First bankruptcy: mean round | 69.1 | 41.8 | 30.7 |
| The first to complete any group wins | 67.9% (67.2 to 68.5) | 61.7% (61.0 to 62.3) | 56.4% (55.7 to 57.1) |

| Place in the order of play | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| 1 | 50.3% (49.6 to 51.0) | 34.3% (33.6 to 34.9) | 27.2% (26.6 to 27.9) |
| 2 | 49.7% (49.0 to 50.4) | 33.6% (32.9 to 34.3) | 25.5% (24.9 to 26.1) |
| 3 |  | 32.1% (31.5 to 32.8) | 24.1% (23.5 to 24.7) |
| 4 |  |  | 23.2% (22.6 to 23.7) |

- **Only the four-player game is much shorter**: 145 turns against 188, and 572 actions against 782. With two players a game ends at the first bankruptcy under either set of rules, and with three the second bankruptcy is the end of the full game as well. There the short game saves 5% to 7% of the turns, all of it from the dealt properties and the faster fortresses.
- **The first group arrives sooner**, in round 5.7 instead of 9.0 at four players, and the first player to complete one wins a little more often: 56.4% against 52.0%.
- **The advantage of moving first appears slightly smaller,** by about a point at three and four players. With 20,000 games the intervals are too wide to be sure.

The script prints the leader tables for the short game as well. They follow the full game closely.

## Running it again

```sh
node scripts/study.ts 100000 --json build/study/study.json > build/study/report.md
node scripts/study.ts --from build/study/study.json            # print the report again from the saved run
node scripts/study.ts --from build/study/study.json --details  # add the full report for every main table
```

The first argument is the number of games at each size of the main tables; the short-game and odd-player tables play a fifth as many and the no-trading tables a fiftieth. `--workers n` sets the number of processes. The same arguments give the same figures.

A new measure of standing is one entry in the `MEASURES` list of the script. Measures are computed while the games are played, so a new one needs a new run.
