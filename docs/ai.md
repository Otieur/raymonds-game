# Computer opponents

This document has three parts. [Today](#today) describes the agents that exist and how strong they are. [What the simulations say](#what-the-simulations-say) lists the measured facts the plan rests on; the full tables are in [statistics.md](statistics.md). [The plan](#the-plan) is the design for agents trained by machine learning and reinforcement learning.

Of the plan, only the measurement is built: `scripts/study.ts` and `scripts/benchmark.ts`. Everything else is design. This document gives the design and its reasons. How each stage is built, task by task, is in [plan/](plan/README.md), one file for each milestone; where the two differ in a detail, the stage file is the later and the more exact.

## Today

No model is involved. The computer players are two hand-written agents in `src/sim/`, both of which only ever choose among the actions the engine lists as legal.

### The agent interface

```ts
// Chooses for one named player. Returns null when the game is not waiting on them.
chooseHeuristicAction(engine, state, actor, random, memory?): Action | null
chooseRandomAction(engine, state, random, actor?): Action | null

// Chooses for whichever player the game is waiting on. Used by simulateGame.
type Agent = (engine: Engine, state: GameState, random: () => number) => Action | null;
```

The client uses the per-player form: `GameStore.schedule()` in `web/src/game/store.ts` calls `chooseHeuristicAction` for each computer-played seat. Every agent in the plan takes the same per-player form, so that it drops into the client, the benchmark and the study without changes around it.

`simulateGame(engine, { players, seed, maxActions, agent })` plays a whole game, checks the invariants after every action, and returns the final state and a count of events.

### The random agent

`src/sim/random-agent.ts`. It picks at random among legal actions, with weights chosen so that games move along (it buys three times in four, bids half the time, builds more often than it sells). It exists to exercise the rules, and it is the floor any other agent is measured against.

### The rule-based agent

`src/sim/heuristic-agent.ts`, about 290 lines. It does not look ahead and does not learn. The only randomness is in how much it raises a bid and how much cash it offers in a trade. All four computer players in the client are this agent.

**How it values a property**

| Case | Value |
| --- | --- |
| Completes a group for the player | 2.2 times the list price |
| The player already holds part of the group | 1.3 times |
| A pass | 1 + 0.25 for each other pass held, times the price |
| A works | 1 + 0.3 if the other is held, times the price |
| Mortgaged | The above, less the cost of redeeming it |

**How much cash it keeps:** 150 (three quarters of a salary), or 300 once any rival has a building.

**What it does**

| Decision | Rule |
| --- | --- |
| Buying what it lands on | Buys if half its reserve would be left. Buys regardless if the property completes its own group, or denies a rival theirs. |
| Property auction | Bids up to 85% of its valuation, or 110% to deny a rival a group, always keeping a third of its reserve. Raises by the minimum plus 0 to 11. |
| Building | Builds where each coin spent raises the rent most, while the reserve stays intact, all the way to a fortress. |
| Redeeming | Redeems the most valuable mortgage first, when the reserve plus half a salary would be left. |
| Building auction | Bids up to 115% of the building's cost on the street where it gains most. |
| Jail | While more than a third of the properties are unowned, leaves at once (a card, or bail if the reserve allows). Later it stays and rolls. |
| Proposing a trade | At most once per turn, after rolling: for the one street missing from a group, offers 1.7 to 2.2 times its list price in cash. Never offers property. |
| Answering a trade | Accepts when what it receives is worth at least 1.1 times what it gives, by its own valuation, and counts an extra 0.8 times the price against a property that would complete the proposer's group. |
| In debt | Mortgages the least valuable property first, then sells buildings from the cheapest street. Goes bankrupt only when the engine allows it, that is, when nothing else would cover the debt. |
| Receiving a mortgaged property | Redeems it at once if the reserve plus half a salary would be left. |

**What it cannot do:** weigh where rivals are likely to land, mortgage in order to build, stop building at a chosen level, bid to drain a rival, sell or swap property, read how the table trades, or play differently by seat or by the number of players. A careful person beats it.

### Baselines

Measured by `scripts/study.ts` on 17 November 2026. Each figure is the share of 20,000 full games won by one seat that plays differently from the rest, with its 95% interval. An even share is 50%, 33.3% and 25%.

| One seat | The other seats | 2 players | 3 players | 4 players |
| --- | --- | ---: | ---: | ---: |
| Rule-based | Random | 91.1% (90.7 to 91.5) | 92.5% (92.1 to 92.8) | 93.7% (93.4 to 94.1) |
| Random | Rule-based | 8.9%, from the row above | 2.5% (2.3 to 2.7) | 1.0% (0.9 to 1.1) |
| Rule-based, refusing every offer | Rule-based | 58.2% (57.5 to 58.9) | 41.0% (40.3 to 41.7) | 30.4% (29.7 to 31.0) |
| Rule-based, never proposing | Rule-based | 42.3% (41.6 to 43.0) | 14.2% (13.7 to 14.6) | 5.9% (5.6 to 6.2) |
| Rule-based, never buying Conquest of Shu | Rule-based | 48.2% (47.5 to 48.9) | 40.5% (39.9 to 41.2) | 28.7% (28.1 to 29.3) |
| Rule-based, never buying a works | Rule-based | 45.8% (45.2 to 46.5) | 34.3% (33.6 to 34.9) | 26.1% (25.5 to 26.7) |
| The best style found by M3's search (5,000 games on evaluation seeds, 18 November 2026) | Rule-based | 87.3% | 56.4% | 39.3% |

The rule-based agent is far above random play and well below what is possible. Two one-line changes to it, refusing every offer and leaving Conquest of Shu alone, each beat it with three and four players. The refuser is the first bar a new agent must clear: an agent that only matches it has learned one trick. The styles found by M3's search clear it at every size; they hold the lines `style-2`, `-3` and `-4` in `assets/lines.json`, and are the bar after it.

The scale of the game the agents play, from 100,000 full games at each size:

| | 2 players | 3 players | 4 players |
| --- | ---: | ---: | ---: |
| Turns in a game, mean | 146 | 168 | 188 |
| Turns, 99th percentile | 305 | 355 | 405 |
| Actions in a game, mean | 546 | 704 | 782 |
| Decisions by one seat, mean | 273 | 235 | 195 |
| Legal actions on a free turn, mean and most | 14.4, 41 | 12.1, 47 | 10.9, 51 |
| Win share of the first to move | 50.6% | 35.0% | 27.7% |
| Win share of the last to move | 49.4% | 31.8% | 22.5% |

The engine plays about 34,000 actions a second on one core with these agents choosing, which is about 44 four-player games (`scripts/benchmark.ts`).

## What the simulations say

The study behind this section is 706,000 games; [statistics.md](statistics.md) has its method, its tables and its limits. Two of those limits bear on everything below. The figures describe games among today's rule-based agent, and they are measured again whenever the agents change. And they are associations: what a player holds late in a game is partly a result of winning, so the plan leans on what players hold after ten rounds.

### Findings

| | Finding | Evidence | What the plan does with it |
| --- | --- | --- | --- |
| S1 | **List price misstates what a holding is worth,** by up to five times. | Restated in cash by a model of who wins, a whole Chain Stratagem held after ten rounds of a four-player game is worth 5.0 times its list price, Cao Wei 3.5, the four passes 2.5, Shu Han 1.8 and Conquest of Shu 0.85. Measured directly, by changing positions and playing them out (M1): at four players the street that completes a group adds 20 to 32 points of win share, worth 700 to 900 coins, while buying a group's first street at list price gains nothing. | The valuation of workstream A replaces list price wherever an agent prices a purchase, a bid or a trade (R5). |
| S2 | **The table size changes what is worth holding.** | One pass is worth 1.6 to 2.0 times its price with two players and 0.5 to 0.8 with four. Every group but Han Court is worth more the larger the table. Leaving Conquest of Shu alone gains 7 points of win share with three players and loses 2 with two. | Everything is fitted, searched and gated separately for each size (R3): the valuation, the archive of styles, the specialists. |
| S3 | **Rent tells who is ahead, and net worth tells it poorly.** | After 20 rounds of a four-player game the leader by rent roll within reach wins 67.0% and the leader by net worth 59.5%. At round 10, net worth explains 7% of the variance in winning and the rent roll within reach 16%. The same order holds at every size up to round 40. V1, the fitted valuation of M1, does better than either: its leader after 20 rounds of a four-player game wins 70.5%, and on held-out games its log loss is 0.675 against 0.857 for the share of net worth and 0.756 for the share of the rent roll within reach. | The gate of A. The shaping potential in E is a valuation, never net worth. |
| S4 | **Funds count only next to the rent roll.** | The leader in cash after ten rounds of a four-player game wins 21.6%, less than a player picked at random. With the rent roll held equal, disposable funds carry the second largest weight of eleven measures: 6 to 9 points for one standard deviation. | The valuation takes the measures of standing jointly, and the observation carries all of them (D). How much cash to keep, and whether to mortgage in order to build, are searched and not fixed (B). |
| S5 | **Today's agent sells too cheaply, and refusing to sell beats it.** | Accepted offers pay 208% of list price. A player who refuses every offer wins 58.2%, 41.0% and 30.4%. With three or four players the leader in trading chips wins less often than a player picked at random. | The refuser joins the league as a school. The price of the last street of a group is in the style search (`acceptMargin`, `completionPenalty`). The gates of G must clear the refuser, not just an even share. What a rival's need is worth is measured again once agents bargain. |
| S6 | **Proposing trades is worth more than any other habit tested.** | A player who never proposes wins 42.3%, 14.2% and 5.9%. | A learner is never left without proposals: a school proposes on its behalf until it has learned to (G, H). |
| S7 | **Without trade the game does not end.** | With nobody trading, 13%, 42% and 61% of games are still running after 40,000 actions, and a group is completed in half of the four-player games. With trading, one full game in 300,000 failed to finish. | Truncation (D). The hazard of a learner that never trades (G). Schools that trade well in the league (C). |
| S8 | **An early cheap group wins. An early dear one does not.** | Of players holding a whole group after ten rounds of a four-player game, Chain Stratagem wins 70.6%, Cao Wei 62.3% and House of Yuan 55.1%. Conquest of Shu wins 20.4%, below an even share, as it does at every size. | Buying and bidding are set for each set separately (B). The Groups potential counts a group by what it returns, not as one group (E). |
| S9 | **The third building is the best coin spent.** | True in seven of the eight groups. Built to three, the groups other than Han Court pay back their outlay in 26 to 35 turns of one opponent. | `buildTarget` (B). The Built-to-three potential (E). |
| S10 | **Passes pay as a set, and singly only with two players.** | Four passes pay back in 32 opponent turns and one in 254. With four players, holders of one or two passes after ten rounds win less often than holders of none. | The Passes potential is steep (E). A school built on passes is expected to do best with two players (B). |
| S11 | **Declining to buy is costly at a small table.** | With two players, a property that is declined goes to the rival at auction for a quarter to a half of its list price. With four it sells for 81% to 94%. | Buying and bidding are learned for each size. A school that declines and bids is tested at each (B). |
| S12 | **The order of play is worth 1 to 5 points.** | The first to move wins 50.6% with two players and 27.7% with four; the last wins 49.4% and 22.5%. | Seats are rotated in every evaluation. The observation always puts the observer first and shows the order (D). |
| S13 | **Landings are uneven and do not depend on the table size.** | Sides two and three take 28.1% each, sides one and four 23.8% and 23.9%. ChiBi takes 7.0%. | The static return V0 (A). The order of building (B). Landing rates among the property facts in the observation (D). |
| S14 | **The short game is much shorter only with four players.** | 145 turns against 188 with four players; 138 against 146 with two; 156 against 168 with three. | The curriculum uses the short game only at four players (G). |
| S15 | **The bank runs out of buildings in ordinary play.** | 3.3, 6.5 and 8.1 building auctions in a game with two, three and four players. | `holdHouses`, the Cornerer school (B). The Supply potential (E). |
| S16 | **Early, with three or four players, the second street of a group is worth nearly as much as the last, as a gift. Bought from a rival it is worth about half that, and still worth asking for at four players.** | Measured by intervention (M1), among today's agent. At four players a second street of Cao Wei given by the bank adds 30, 25 and 8 points of win share at rounds 5, 10 and 20; the last street adds 44, 27 and 21. Chain Stratagem: 33, 22 and 5 against 33, 24 and 10. At three players the second street of Chain Stratagem, House of Yuan and Cao Wei adds 21 to 25 points at round 5. At two players it adds 4 to 8 at round 10. See [statistics.md](statistics.md#the-second-street-by-round). Bought from a rival (the probe of M3b, 19 November): at four players +12.5 to +22.6 points at round 5 at list price, +4.4 to +9.9 at twice list, +5.6 to +13.2 at round 10, about +3 to +5 at round 20; at three players worth it only at round 5 and up to one and a half times list. The cash paid strengthens the seller. As a school: early asks before round 5, with the last street priced as today's agent prices it, win **+2.4 (0.5 to 4.3)** points at three players and **+9.7 (7.9 to 11.4)** at four over 5,000 paired games. | Early asks (K, [M3b](plan/m03b-table-politics.md)), in the preset `early-bird-2`, and in the teachers and schools of later stages. Only before round 5 to 8, and never with the last street priced low (S20). |
| S17 | **Half of all groups are first completed from a bankrupt player's estate.** | At four players the last street of Chain Stratagem, House of Yuan, Cao Wei and Shu Han comes by trade in 37% to 46% of cases and from a bankruptcy in 49% to 57%; a game has 2.9 bankruptcies, nearly all to another player. A failing seat's useful street bought at list price adds about 6 points at four players at rounds 5 and 10 (the probe: +5.8 ± 3.1 and +5.8 ± 4.3), and nothing measurable at three. As schools with the pricing flaw of S20, buying estates early lost among today's agent (Undertaker −6.4 and −4.8, Broker −6.5 and −4.9, Scavenger at the debt window −7.4 and −5.1 at three and four players) and won among the strong style holders (Undertaker 23.0% and 28.3% against the baseline's 19.8% and 11.0%). With the flaw fixed: Undertaker +1.1 and +4.3, Scavenger +0.6 and +3.6, so level at three players and ahead at four. | Estates stay in K's schools, with S20's fix. |
| S18 | **Refusing the leader alone loses; trading on worse terms with it and better with trailing seats does not, and at four players two seats doing it cut the leader's lead. At three players two such seats lose.** | A school that makes and takes no deal with the seat ranked first wins 23.2% and 16.3% with three and four players, below an even share: it gives up its own deals and the other seats go on selling to the leader. Balancer, which answers by the sheet and favours trailing seats, wins +5.6 points at three and at four players as the one seat doing it, once S20's flaw is fixed (−1.6 and −3.6 with it); Patron likewise. Answering by the sheet alone is worth 4 to 6 of those points (S22). At a four-player table of the `style-4` holder, a baseline and two fixed Balancers, the holder wins 34.2% against 37.7% beside three baselines, the two Balancers together 46.7% against 41.5% for two baselines in the same seats, and the seat ranked first at round 20 goes on to win 65.8% against 71.2%; 96.7% of games finish against 99.8%. A third Balancer adds nothing. At three players, beside the `style-3` holder, two fixed Balancers win 34.3% together against 42.8% for two baselines, and the holder rises from 57.2% to 65.7%. | Working against a leader is measured at tables of two (K). The settings of `againstLeader` and `forWeak` (M3b task 16a) are being run, at both sizes. Leader conversion at round 20 fell by 5.4 points, past the 5 that M3b set for specifying a field for hiding a lead. |
| S19 | **Stopping a rival is worth little, whoever does it.** Restated: the first form, that it is worth most to the seat nearest the rival, is not supported. | The form of V1 suggested it: chances add to one, so a rival's gain comes from the others roughly in proportion to what each has. Measured by the probe of M3b: buying from a third seat the street a rival lacks adds about 1 point at list price at four players, whatever the buyer's rank, loses 2 to 6 at twice list, and loses at three players. Warden, which does it, loses 7.7 and 5.6 points at three and four players with S20's flaw, and with it fixed draws at three players and wins 4.0 at four; it makes 0.04 denying deals a game, so its result is its pricing, not its denials. The probe plays on with today's agent, which sells such a street on for twice its price, so a denial that is held was not what was measured. | Denying stays a field and leaves the presets offered to a player. Warden is measured again with `denyRank: 2`. |
| S20 | **A seat that asks a low price for the street that completes a group loses the completions that win games.** | Pricing every ask by its worth to the seat in a deal with that holder asked for a last street at about a third of that worth, where today's agent offers 1.7 to 2.2 times list. Alone, that pricing loses 5.7 points at three players and 6.9 at four. Early asks on top of it gain back +3.0 and +7.0; with today's price for the last street the same school gains +2.4 and +9.7 against the baseline. Six more schools run again with that price each gain 6.5 to 9.6 points, and at four players each then beats the baseline by its interval: Balancer +5.6, Patron +5.6, Undertaker +4.3, Warden +4.0, Scavenger +3.6, Envoy +3.2. | The field `completeBy: 'list'` keeps today's price for the completing street. Proposed for every school that prices by value; the presets keep the recorded form until the author decides. |
| S21 | **Political play loses among players who sell cheaply and wins among players who do not.** | As the one seat among copies of the style holders (found-3-b2t2p1c1; found-4-b2t1p1c2, which is Sky rush), 2,000 games: the baseline wins 19.8% and 11.0% at three and four players; Early bird 24.7% and 33.4%; Warden 23.1% and 29.9%; Undertaker 23.0% and 28.3%; Balancer 26.1% and 41.8%; the Statesman 36.6% and 45.4%. Among today's agent most of the same schools lose (M3b's table of worth). The baseline's four-player tables there finished 74% of their games against 92% to 99% for the others. | The league must hold strong opponents that do not sell cheaply, or a learner learns only to farm the cheap seller (S5). A school is judged among both. |
| S22 | **Mortgaging idle property to build is worth 7 to 11 points; hunting a failing seat adds nothing.** | Hunter, which mortgages to build and builds where a failing seat is about to land, wins +11.4 and +6.7 points at three and four players against the baseline, and +0.1 and +0.1 against the baseline with `mortgageToBuild` alone. Likewise Grudger's +6.4, +6.9 and +4.7 come from answering by the sheet: against that base it gains +1.5, +1.1 and +0.4. | `mortgageToBuild` and answering by the sheet belong in the search's starting archive and in the teachers. |
| S23 | **An offer that asks for a partner pays at three players and costs at four.** | Two Envoys, which send invitations (offers that favour the receiver while a third seat leads) and read them, against two Balancers in the same seats, 5,000 games: at three players +5.8 points for the pair (40.4% against 34.6%), where an invitation nearly always goes to the other Envoy; at four players level (46.5% against 46.8%), and the baseline in the fourth seat gains 4.3 points, because it takes invitations and answers about 8% of them. Beside a False friend, which invites and never returns, an Envoy does as well as a Balancer at three players and 2.3 points worse at four; a smaller gift (`giftEdge: 1`) halves the loss, a larger one (4) does not help. | Signals stay for three players. At four players a reader needs a reason to answer, which the agents of today do not have; the question passes to the learners of M8 and to the person's check in M10. |

### The reference style against the figures

The plan takes one style from a person as a reference ([workstream B](#b-schools-of-play)). The study already checks several of its beliefs. The values in coins are those of the model after ten rounds of a four-player game, and are a first cut.

| Belief | What the study shows |
| --- | --- |
| The second and third sides are the busy ones. | Confirmed: 28.1% of landings each, against 23.8% and 23.9%. |
| Cao Wei is the best group. | Confirmed. It returns the most for its cost at three buildings, and a whole Cao Wei after ten rounds wins 62.3% of four-player games. |
| House of Yuan is nearly as good. | Confirmed: 55.1%. |
| Shu Han is nearly as good. | Weaker than believed early on: 36.7% after ten rounds, and its streets are worth about their list price. By round 30 it has caught up to 50.5%. |
| Chain Stratagem is good for an early kill. | Understated. It is the strongest group to hold early at every table size: 76.9%, 74.2% and 70.6%. |
| Conquest of Shu is a last resort. Do not buy it, do not bid on it. | Confirmed with three and four players, where leaving it alone wins 40.5% and 28.7%. With two players it costs 1.8 points, because the rival then takes the streets for the opening bid. There the better rule is to bid low, not to pass. |
| The works are not worth buying. | About right with three and four players, where leaving them alone gains a point. With two it costs four points, for the same reason. |
| Han Court is easy to complete and weak. | Weak by landings: 67 opponent turns to pay back at three buildings. But it is cheap enough that its streets are worth three and a half times their price, and a whole Han Court after ten rounds still wins 42.6% against an even share of 25%. |
| House of Sima is easy to complete and costly. | A single street of it is worth one and a half times its price at four players. Holding both adds little. |
| Build to three at once. | Confirmed: the third building is the best coin spent in seven of eight groups. |
| A pass is worth bidding up to 450. | Right for a player collecting all four, which are worth 2,001 coins together, about 500 each. A single pass is worth 103 to 167 coins with four players and 328 to 393 with two. |
| Auction ceilings by side: 250 on side one, 350 on side two, 400 for Shu Han, 350 for Eastern Wu, 550 for House of Sima. | By what one street is worth on its own: low for Chain Stratagem (340 to 361) and Cao Wei (389 to 413); about right for Han Court (213 to 224), House of Yuan (288 to 327) and House of Sima (532 to 637); high for Shu Han (216 to 253) and Eastern Wu (191 to 201). A street that completes a group is worth more than these figures. |
| Keep about 200 in cash, more late. | The direction is supported: with the rent roll held equal, spare funds carry the second largest weight. The level is for the style search to set. |
| When the table will not trade, collect passes and block. | Supported. Without trade half of four-player games see no group completed, four passes are worth two and a half times their price, and a player who never sells wins more than an even share. |
| Mortgage idle property in order to build. Limit the cash a trading partner is left with. | The first half is confirmed and large: mortgaging to build is worth 7 to 11 points at three and four players (finding S22). The second is not tested. |
| Buy toward a group many rounds before it lacks one street. | Supported with three and four players, early: before round 5 it wins 2.4 points at three players and 9.7 at four, provided the last street is still paid for at today's price (findings S16, S20). Not with two, where a second street adds little. Among the strong style holders, who do not sell cheaply, Early bird wins 24.7% and 33.4% against the baseline's 19.8% and 11.0%. |
| Pay a high price for a useless property to stop a strong rival. | Not supported among these agents: a denial is worth about a point at list price and loses at twice list, whatever the buyer's rank (finding S19). |
| Buy a failing player's property long before the bankruptcy. | The stake is large: half of all groups are first completed from an estate (finding S17), and a failing seat's useful street at list price is worth about 6 points at four players. As a school with the price of finding S20 fixed, it draws at three players and wins about 4 points at four. |
| Behind, work with the weak against the strong; ahead, choose a partner before being ganged up on. | Supported at four players, not at three. One seat refusing the leader loses (finding S18), but one seat trading on better terms with trailing seats wins 5.6 points, and at four players two such seats take 5.2 points more than two baselines would and cut the leader's share by 3.5. At three players two such seats lose 8.5 points and the leader gains. Asking a partner with a favourable offer works at three players and not at four (finding S23). |
| The whole style, as told (Reference II). | Better than the outline of M2 at every size: +6.1, +5.4 and +2.6 points against the Reference, each interval above zero; with the last street at today's price, +4.3, +3.8 and +3.7. Against the baseline +4.4, +3.3 and −2.4. |

## The plan

### Requirements

| | Requirement | How it is checked |
| --- | --- | --- |
| R1 | **Beyond any one style.** No single way of playing, the author's own included, is the target. Styles are references, opponents and starting points. | The final agent beats every style it was started from, at every table size. |
| R2 | **Several schools.** The game has more than one sound way to play. The system produces several distinct, competent schools and the final agent holds up against all of them. | A league of schools that differ measurably in behaviour; the final agent's worst result against any of them is still above an even share. |
| R3 | **Table sizes differ.** Two-, three- and four-player games get their own logic. | Separate baselines, gates and style searches for each size; a specialist per size ships only if it beats the shared model at that size. |
| R4 | **Several reward signals.** Winning is the goal, but learning draws on more than the final result: completing a group, holding passes, building to three, and others still to be found. | Every signal is a named, switchable term; each is kept only if an ablation shows it helps win. |
| R5 | **Real value.** Assets are scored by what they do for winning, not by list price. | A valuation that predicts the winner better than paper net worth does. |
| R6 | **One source of rules.** Training talks to this engine. The rules are never reimplemented elsewhere. | The trainer reaches the game only through `src/env/`. |
| R7 | **Runs in the browser.** A trained agent is a file the client loads and runs offline, behind the interface above. | The agent plays in the client and in the desktop app. |
| R8 | **Evidence.** A stage is done when a number beats a baseline, with an interval that excludes luck. | The [evaluation protocol](#evaluation-protocol). |
| R9 | **The plan moves.** Each milestone ends by rerunning the study with the new agents and revising this document. | The milestone table. |
| R10 | **Play the position.** A school is an ingredient, not a cage. Agents combine schools, part by part, and change plan as the position changes, looking again at every decision. | Written playbooks and a learned conductor are each compared with the best fixed school at every table size; the learned agent's play is shown to differ between the opening, the middle and the endgame. |
| R11 | **Play the table.** With three or four players, whom a seat deals with, refuses and stops is strategy of the first rank: buying toward a group early, buying to deny a strong rival, buying a failing player's property before the bankruptcy, working with the weak against the strong, choosing a partner when ahead, asking again as the position changes, and asking for an alliance, and reading such a request, through offers alone. Agents weigh what a deal does to every seat, not only to the two that make it. The plan looks for such strategy on its own account and does not wait to be told of each. | Each behaviour is a school with a measured result ([M3b](plan/m03b-table-politics.md)); the league reports how often a leader goes on to win; a learned agent's deals are shown to depend on the standing of its partner and never on whether the partner is a person. |

### Overview

```text
 scripts/study.ts ──▶ docs/statistics.md
        │
        ▼
 A. Valuation ───────────────┐          what assets are really worth
        │                    │
        ▼                    ▼
 B. Schools ──▶ C. League ──▶ F. Supervised learning ──▶ G. Reinforcement learning
    parameterised    rates       imitate the best schools,     PPO inside the league:
    rule-based       everyone    train a value network         main agents for 2, 3, 4 players,
    agent, searched  against                                   style learners, exploiters
    for styles       everyone             ▲                              │
                                          │                              ▼
                         D. Environment, E. Rewards              H. Trading, I. Looking ahead
                                                                         │
                                                                         ▼
                                                          J. assets/models/ in the client
```

The order matters. A, B and C need no neural network and no bridge to Python: they run on the engine alone, at about 44 four-player games a second on one core. They produce the opponents, the valuation and the yardsticks that every later stage is judged by, and they answer R1, R2 and R5 in a first form before any training starts. Workstream K, table politics, was added on 18 November 2026 and runs on the engine alone as well, after C and before the teachers of F are chosen.

Processes during training:

```text
 Python (train/)                         TypeScript
 ┌───────────────────────┐   JSON lines  ┌──────────────────────────────────┐
 │ learner: BC, PPO      │◀─────────────▶│ scripts/env-server.ts            │
 │ league bookkeeping    │    stdio      │   src/env/  environment          │
 │ vectorized env client │               │     ledger, observation encoder  │
 └──────────┬────────────┘               │     action codec and mask        │
            │ export                     │     potentials                   │
            ▼                            │   src/sim/  schools, valuation   │
   assets/models/                        │   src/engine  (the rules)        │
            │                            └──────────────────────────────────┘
            ▼
 Browser: src/env/mlp.ts ──▶ learned agent ──▶ GameStore.schedule()
          (uses the same src/env/ encoder and codec as training)
```

The encoder, the codec and the opponents are written once, in TypeScript, and used in both places. A policy therefore sees exactly the same numbers in the browser as it did in training.

Proposed layout:

| Path | Contents | Workstream |
| --- | --- | --- |
| `scripts/study.ts` | The simulation study. Exists. | |
| `src/sim/measures.ts`, `src/sim/valuation.ts` | The measures of standing, moved out of the study script. What a holding is worth: the static table and the fitted model. | A |
| `scripts/fit-valuation.ts`, `scripts/probe-value.ts` | Fits the valuation. Measures what a purchase or a deal is worth by changing a position and playing it out. | A, H |
| `src/sim/style-agent.ts`, `src/sim/styles.ts` | The parameterised rule-based agent and its named presets. | B |
| `src/sim/parts.ts`, `src/sim/signals.ts`, `src/sim/playbook.ts` | The parts of a style; what a playbook can see of a position; playbooks. | B |
| `scripts/search-styles.ts` | Searches the style parameters for strong and different styles, and searches for playbooks. | B |
| `src/sim/deal.ts`, `src/sim/relations.ts`, `scripts/table.ts` | What a deal does to every seat's chance; what has passed between each pair of seats; one named table played many times, with its political measures. | K |
| `scripts/promote.ts`, `assets/lines.json` | A new version against the best so far; who holds each line. | all |
| `scripts/league.ts` | Plays every member against every other and rates them. | C |
| `src/env/` | The environment over the engine: ledger, observation encoder, action codec, potentials. The network's forward pass and the learned agent for the client. | D, E, J |
| `scripts/env-server.ts` | Serves environments to the trainer over standard input and output. | D |
| `scripts/make-dataset.ts` | Writes held-out sets of decisions made by league members. | F |
| `train/` | Python: the environment client, models, behaviour cloning, PPO, league training, export. | F, G |
| `assets/models/` | Exported policies the client loads, each with a short record of how it was made and how it scored. | J |

The stage files in [plan/](plan/README.md) list every file each milestone adds.

### A. Valuation: what things are really worth

List price is a poor guide. The study shows it in three ways (findings S1 to S3): the return on a coin differs several times over between groups, a pass or a street is worth more or less depending on what else its owner holds and on how many players are at the table, and the player whose properties charge the most rent is a better bet to win than the player with the highest net worth.

**Measures of standing.** No single number says how a player stands. The study therefore keeps a list of measures, each a small function of a state and a seat, and reports for every one how well it tells who will win: how often its leader wins, how it correlates with winning, and what it adds when the others are already known. The list today, in `scripts/study.ts`:

| Kind | Measures |
| --- | --- |
| Funds | Cash in hand. Spare cash, above the largest rent within one roll. Disposable funds: spare cash plus what mortgaging property outside complete groups would raise. Everything that could be raised, with all mortgaged and all buildings sold. |
| Danger | The rent and tax expected on the next roll. Property under mortgage. |
| Income | The rent roll: what the seat's properties charge now. Spent on buildings. |
| Potential | The rent that could be added at once by building with the cash in hand. The room to grow beyond that, up to every group fully built. Groups one street short, and whether a rival holds that street. |
| Bargaining | Sets in which the seat holds the one property a rival lacks. Trading chips: everything it holds that rivals are collecting, weighted by how close they are. |
| Holdings | Net worth as the rules count it. Complete groups. Passes. Properties. |

Adding a measure is one function and one line in the list; the next run of the study reports on it. That is the intended way of working: think of something a player would look at, write it down as a measure, and let the games say whether it matters. A measure earns a place in the valuation below by improving its fit on games held out.

One caution applies to every figure the study gives. A measure is judged by the games it is measured in. Among players who sell a street for a fixed multiple of its price and never bargain, holding what a rival needs is worth little; among players who bargain well it may be worth a great deal. The figures say what a measure is worth at today's tables, and they are measured again whenever the league changes.

**Valuations.** A valuation is a function from a state and a seat to a number: the seat's chance of winning. Three are planned, each behind the same interface so that its users can switch.

| | What it is | Built from | Used for |
| --- | --- | --- | --- |
| V0 | **Static return.** For every property and level, the rent expected per opponent turn: landing rate times rent. For every set, the outlay and the turns that pay it back. | The landing rates in [statistics.md](statistics.md#where-players-land). No fitting. | The schools' building order and targets. A sanity check on V1. |
| V1 | **Holdings model.** Each seat's chance of winning, as a function of what the seats hold and of the round. | Fitted by maximum likelihood on snapshots of simulated games. The linear model in [statistics.md](statistics.md#what-holdings-are-worth) is its first cut. | The schools' valuations of a purchase, a bid and a trade. The first shaping potential. Showing who is ahead in the client. |
| V2 | **Value network.** The chance of winning, from the full observation. | Trained in workstream F and kept training in G. | The shaping potential and the critic in G. Judging trades in H. Looking ahead in I. |

**V1 in detail.** One model for the whole table: each seat still in the game gets a score, and a seat's chance of winning is its score's share of the table's, so the chances add up to one. A snapshot is taken every five rounds, and the target is which seat won. A seat's score is a weighted sum of:

- the measures of standing above, each as the seat's share of the table's total;
- for each group: streets held by the seat (as a share), the most held by any one rival, whether complete, the building level;
- passes held by the seat, as indicators for one, two, three and four, and whether a rival holds three;
- works held;
- the seat's place in the order of play.

The weights are not constants. Each is given at a few rounds (5, 10, 20, 30, 45 and 60) and interpolated between them, so the model says how the worth of a holding moves through a game: the study's fixed snapshots could not, and they suggest it moves a great deal (four passes fall from 2.5 times their price after ten rounds of a four-player game to 1.2 after twenty).

To fit it without playing the games again each time, the study gains an option to write its snapshots to a file: for each one, the round, every seat's cash and position, every property's owner, level and mortgage, and who won. Any measure can then be computed and tested from the file in seconds.

It is fitted separately for two, three and four players, and refitted whenever the league changes, since what a holding is worth depends on how the rest of the table plays. The weights are written out as a TypeScript module and evaluated in TypeScript, so the same valuation runs in training and in the browser.

**Measuring by intervention.** A model fitted to games as they happened cannot fully separate what helps a seat win from what a winning seat ends up holding. So the worth of a purchase is also measured directly: take a position from a simulated game, give a seat a property (with or without the payment), play both versions to the end many times with fresh dice, and compare how often the seat wins. The same method later prices a deal between two players (workstream H). It is slower than the model and is the authority where the two disagree. [plan/m01-valuation.md](plan/m01-valuation.md) has the design.

**Gate.** On games held out from the fit, at every table size: V1 has a lower log loss than the same model given only the seat's share of paper net worth, and the leader by V1 goes on to win more often than the leader by net worth at rounds 10, 20, 30 and 40. The figures to beat are in [statistics.md](statistics.md#who-is-ahead). V1 must also be calibrated, and agree in sign with the measurements by intervention in at least nine cells of ten.

The rule that ranks players by net worth at the end of the short game is part of the game, not of this plan, and is left as it is. Whether the short game should rank by something closer to real value is a question for the rules.

### B. Schools of play

A school is a way of playing that hangs together: what to buy, how hard to bid, how much to keep, how far to build, when to deal. The rule-based agent is one school with its settings frozen in code. This workstream turns those settings into data, so that a school is a point in a space that can be named, measured, searched and handed to a learner as an opponent.

**The parameterised agent.** `chooseStyledAction(engine, state, actor, random, style, memory)` in `src/sim/style-agent.ts`. A `Style` is plain JSON. Its parameters, with today's agent as one setting:

| Parameter | Meaning | Range | Today's agent |
| --- | --- | --- | --- |
| `buy[set]` | Whether to buy a property of this set at list price on landing. One value for each of the ten sets (eight groups, passes, works). | 0 to 1 | 1 for all |
| `buyFloor` | Cash that must remain after a purchase. | 0 to 400 | 75 |
| `bidCap[set]` | The most to bid in an auction, as a multiple of list price. | 0 to 5 | 0.85 |
| `ownBonus`, `completeBonus` | How much more a property is worth when the seat already holds part of its set, or when it completes the set. | 1 to 4 | 1.3, 2.2 |
| `blockBonus` | How much more to pay to keep a rival from completing a set. | 1 to 3 | 1.3 (110% against 85%) |
| `reserve` | Cash kept in hand. | 0 to 600 | 150 |
| `reserveThreat` | How the reserve grows with the largest rent the seat could owe on its next roll. | 0 to 1 of that rent | A flat 300 once any rival has built |
| `buildTarget` | The level at which building on a group pauses until every group the seat holds has reached it. | 1 to 5 | 5 |
| `buildBeyond` | Cash above the reserve needed before building past the target. | 0 to 2,000, or never | 0 |
| `buildOrder` | Which street of a group gets the next building: the largest rent gain per coin, or the largest gain weighted by landing rate. | two choices | Rent gain |
| `mortgageToBuild` | Whether to mortgage property outside complete groups to pay for buildings below the target. | yes or no | No |
| `holdHouses` | Whether to stop at four farmsteads when the bank is short of them, to keep them from rivals. | yes or no | No |
| `jailStay` | The share of property that must be owned before the seat prefers to stay in jail. | 0 to 1 | 0.67 |
| `proposeRate` | Trade proposals per turn of its own. | 0 to 1 | 1 |
| `offerMultiple` | Cash offered for a missing street, as a multiple of list price. | 1 to 4 | 1.7 to 2.2 |
| `swaps` | Whether it offers property for property. | yes or no | No |
| `acceptMargin` | What it must receive, relative to what it gives, to accept. | 0.8 to 3 | 1.1 |
| `completionPenalty` | The extra it demands for the street that completes the proposer's set, as a multiple of list price. | 0 to 5 | 0.8 |
| `leaveCash` | When a deal would complete the other side's set: the most buildings their remaining cash may pay for, or no limit. | 0 to 15, or none | None |
| `moodWindow`, `moodFloor` | How many offers at the table it watches before judging whether the table trades, and the acceptance rate below which it changes mode. | 4 to 30; 0 to 1 | Never changes |
| `blockMode` | What changes when the table does not trade: raised caps for passes, one street of every group held and never sold. | a second set of the caps above | None |
| `bySize` | Overrides of any of the above for two, three or four players. | | None |

About sixty numbers once the per-set values are counted. The agent built from today's settings must reproduce `chooseHeuristicAction` decision for decision; that is its first test.

A survey of published strategy added schools that these parameters could not express, and ten fields to express them: a preference for chosen sets (`prefer`), mortgaging in order to buy (`mortgageToBuy`), declining so as to buy at auction when rivals are short of cash (`declinePoor`), bidding a rival up on what it needs (`driveUp`), taking one group to the target before the next (`buildSpread`), building only when a rival is within reach (`buildNear`), staying in jail once rivals have built (`jailStayBuilt`), offering property for sale and making low offers to a rival in debt (`sellOffers`, `distressOffers`), refusing to deal with the leader and selling out when lost (`shunLeader`, `giveUpBelow`), and a second set of values once the seat's first group is built (`afterFirstGroup`). The full type, with every default and rule, is in [M2](plan/m02-schools.md).

Twenty-eight more fields are planned for table politics (workstream K): asks priced by what a property is worth and made again as the position changes, asks for a second street, purchases that deny a rival, purchases from a failing player, answers that weigh what a deal does to every seat, offers at the moment a rival cannot pay a debt, invitations to an alliance sent and read through offers alone, and building where a failing player is about to land. They are specified in [M3b](plan/m03b-table-politics.md), and were built and tested there on 18 November 2026. None has yet been measured in a run.

**The reference style.** One style comes from a person: the way the project's author plays the classic game, translated to this board by position. It is recorded here as a preset, and it is the first school the plan implements after the baseline. It is a reference and an opponent, not a target (R1).

| Decision | Reference style |
| --- | --- |
| Buying on landing | Everything, except the two works and the Conquest of Shu group. |
| Auction ceilings, in coins | Han Court and Chain Stratagem 250. House of Yuan and Cao Wei 350. Shu Han 400. Eastern Wu 350. Conquest of Shu: does not bid. House of Sima 550. A pass 450. |
| Reading the table | Tests early whether the others will trade. |
| If the table trades | Works toward complete groups. Preference: Cao Wei first, then Shu Han and House of Yuan; Chain Stratagem for an early kill; any group when the chance comes; Conquest of Shu only as a last resort. Han Court and House of Sima are easy to complete, the first weak and the second costly. |
| If the table does not trade | Collects passes, and holds one street of each group so that nobody else completes it. |
| On completing a group | Builds at once to three on every street, mortgaging idle property to pay for it. Builds first on the squares that cards send players to. |
| Cash | Keeps about 200, more late in the game, when one landing can cost over 600. |
| Trading | Trades to complete a set. When a deal completes a set for the other side as well, limits the cash they are left with, so that they can afford only a few buildings. |
| Buying early | Holding one street of a group of three while a rival holds another and the third is unowned, weighs the group's strength, the table, the positions and the chances of winning, and trades for the second street many rounds ahead. No fixed price: it depends on the position. |
| Asking again | Who holds the last street matters. Offers for it again and again over many rounds, to test whether the holder will let it go, because a person's answer changes with the game. |
| Denying | Buys, or trades for, what a strong rival needs, and will pay a high price for a property of no other use. A strong rival is judged by its property, how near a group is to complete, whether it is about to build, whether someone is about to land on it, and its chance of winning. |
| Estates | Whoever bankrupts a player takes that player's property. So buys a failing player's important property, important to the author or to a strong rival, long before the bankruptcy. A failing player is judged by cash, mortgages, the rents ahead and the chance of winning. |
| Alliances | When behind, picks weaker players to work with against the strong one. When ahead, picks a partner first, so as not to be ganged up on. Asks for an alliance by the offers he makes and reads the same from others; nothing is said. How far to go against a leader has no fixed answer: as far as helps him win. |

The last five rows were added on 18 November 2026. The Reference preset of M2 predates them and holds only the outline of this style, so its results (about an even share or less) do not describe the author's play; [M3b](plan/m03b-table-politics.md) adds the fuller preset.

The study already bears on most of these beliefs; see [The reference style against the figures](#the-reference-style-against-the-figures).

**Named schools.** Thirty-seven presets in `src/sim/styles.ts`. Each is a hypothesis about how to win, written down so that it can lose. Eleven were this plan's first guesses; three show how schools combine; twenty-three were added from a survey of published strategy: a simulation of eight strategy agents, the fixed agents of Bonjour and others (2022), a catalogue of tactics, and a staged plan built on break-even times. [M2](plan/m02-schools.md#the-named-schools) gives each school's settings, the behaviour it must show, and the sources.

| Family | School | Idea |
| --- | --- | --- |
| What to buy | Baseline | Today's rule-based agent. It buys whatever it can afford. |
| | Cheap side | Only the first two sides of the board. |
| | Dear side | Only the last two sides. |
| | Warm sides | Prefers the second and third sides, which are landed on most. |
| | Sniper | Buys a street only to complete a group or to block one. |
| | Prestige | The passes and House of Sima first. |
| | Orange and sky | The passes, Cao Wei and Chain Stratagem first. |
| | Pass baron | Passes above everything, single streets to block, little building. |
| | Land-grabber | Buys everything, and mortgages what it has to keep buying. |
| How to build | Three and hold | Every group to three, then cash. |
| | Rusher | The cheap groups, built to the top at once, everything else mortgaged to pay for it. |
| | All in | No spare cash at any time: every coin and every mortgage goes into buildings. |
| | Slumlord | Han Court and Chain Stratagem to fortresses as early as possible. |
| | Concentrator | One group to four before a second group gets anything. |
| | Ambusher | Holds its cash and builds when a rival is within one roll. |
| | Cornerer | Stops at four farmsteads to run the bank out of buildings. |
| How much cash | Hoarder | A large reserve, few purchases early, strong bids late. |
| | Turtle | A reserve that tracks the danger ahead; sits in jail once rivals have built. |
| How to bid | Shark | Declines at list price and buys at auction. |
| | Driver | Bids rivals up on what they need. |
| | Vulture | Waits for rivals to run short, then buys at auction and from the indebted. |
| How to trade | Refuser | Makes offers and accepts none. |
| | Hermit | No deal of any kind. |
| | Open hand | Accepts nearly anything. A weak opponent on purpose. |
| | Blocker | Never sells a street somebody needs. Buys and bids to deny. |
| | Dealer | Proposes often, swaps property, accepts fair deals. |
| | Big spender | Pays up to three times the price for the street that completes a group. |
| | Squeezer | Sells the last street of a group to a rival who will be too poor to build on it. |
| | Icebreaker | When the table stops trading, it raises its offers. |
| | Leveller | Makes and takes no deal with whoever is ahead. Three and four players. |
| | Kingmaker | When it cannot win, sells out to the weakest rival. Three and four players. |
| Whole plans | Reference | The style above: reads the table and changes plan. |
| | Two-stage | A cheap group first, built to three; then a dear group paid for by it. |
| | Duelist | For two players: lets nothing go to auction cheaply and never helps the one opponent. |

**Mixing schools, and playing the position.** A school is one way of playing held from the first roll to the last. Nobody good plays like that. A player buys like one school and trades like another, and drops both when a rival completes a group or the table stops dealing. The plan treats schools as ingredients, in four steps of rising freedom.

| Step | What it is | Where |
| --- | --- | --- |
| **Parts** | A style is cut into seven parts: how it values, buys, bids, builds, keeps cash, makes offers and answers them. A new style can take each part from a different school, and two styles can be blended by any proportion. | M2 |
| **Playbooks** | A base style and an ordered list of rules. A rule reads the position through twenty-one signals (who is ahead, what the seat lacks, how dangerous the board is, whether the table deals, how many players are left) and swaps parts in from other schools while it holds. The rules are looked at again at every decision. | M2 |
| **Searched playbooks** | The style search, run again over rules: which signals are worth reacting to, at what thresholds, and with which school's part. The best playbook is set against the best fixed style, so that whether changing plan pays is measured and not assumed. | M3 |
| **The conductor** | A learner that makes no moves. At each of its turns it chooses which school plays its seat. It is cheap to train, and what it learns can be read off as a table: in this kind of position, play this way. | M8 |

The learned main agent stands at the end of that road: it has no school, and every move comes from the position, so mixing and changing are what it does by construction. The steps before it exist because they can be read. A playbook and a conductor say why they changed plan; a network does not. They also make opponents whose change of mind a person can see at the board. [plan/m02-schools.md](plan/m02-schools.md#mixing-schools-and-playing-the-position) has the parts, the signals and the first playbook.

**Searching for styles.** The presets are guesses. `scripts/search-styles.ts` looks for better ones and for different ones.

- *Score.* A candidate's win share when it takes one seat among opponents drawn from the current pool, over a fixed set of seeds shared by all candidates, so that candidates differ by their play and not by their dice.
- *Search for strength.* An evolution strategy over the parameters: perturb the best candidates, keep what scores higher.
- *Search for difference.* An archive in the manner of MAP-Elites (Mouret and Clune, 2015). Each candidate is described by how it actually played: the share of its spending that went on buildings, the trades it completed per game, the passes it held at round 20, the cash it held at round 20. The archive is a grid over those descriptors and keeps the best candidate in every cell. The result is not one strong style but the strongest style of every kind.
- *By table size.* One archive each for two, three and four players (R3).
- *Guarding against luck.* The best of many candidates is partly the luckiest. Every candidate that would enter the league is scored again on seeds the search never used.
- *Cost.* One candidate over 600 four-player games is about 14 seconds of one core. The whole search, 40 generations of 32 candidates at each table size, is about 13 core-hours.

**Gates.**

1. The baseline preset reproduces today's agent exactly over 1,000 games.
2. Each preset shows the behaviour it is named for in the study's measures (the Pass baron holds more passes at round 20 than the baseline, and so on).
3. At each table size the archive holds at least twelve styles in different cells that each win at least an even share against the baseline.
4. At each table size the best style found wins more than the refuser does as the one among baselines, over 5,000 paired games, with the interval of the difference above zero. An even share is no longer the bar: the study showed that a one-line change to today's agent already clears it.

### C. The league

The league is the set of agents everything is measured against. It starts with the schools and grows as training produces more.

| Member | Comes from | Role |
| --- | --- | --- |
| Baseline and random | `src/sim/` today | Fixed yardsticks. Never removed. |
| Schools | The presets and the archive of workstream B | Fixed opponents of many kinds. |
| Main agents | Workstream G, one for each table size | What is being improved. |
| Past selves | Checkpoints of the main agents | Stop a main agent from forgetting how to beat what it once beat. |
| Style learners | Workstream G, trained under a style's rewards | Schools that are learned rather than written. |
| Exploiters | Workstream G, trained only against a frozen main agent | Find the main agent's weaknesses. |

**Standard tables.** Two kinds of table make results comparable:

- *One among copies:* one seat for agent X, the others for copies of agent Y. Played for every ordered pair, it gives a matrix of win shares for each table size.
- *Mixed:* every seat drawn at random from the league. Closer to real play, and the place where three-way effects such as kingmaking show.
- *Named:* a table whose seats are chosen, such as a strong member, a baseline and two seats of one political school, set against the same table with two baselines in their place. One seat among copies of another cannot show whether two seats working against a leader gain by it; this table can (K).

**Measures of the table.** Besides who wins, the report gives how often the seat ranked first by the valuation at round 10 and at round 20 goes on to win (among today's agent: 56.8% and 70.5% with four players), how often the lead changes, and what share of bankrupt players' property goes to the seat that was ahead. Where trailing seats work against a leader the first figure falls.

**Rating.** `scripts/league.ts` plays the tables and reports, for each table size: the matrix, each member's worst row (the opponent it does worst against), and a rating fitted to finishing orders by a Plackett-Luce model (Hunter, 2004), which handles games of more than two players and, with every game in hand at once, needs no game-by-game update. Strategies in this game need not be transitive: A may beat B, B beat C and C beat A. A single rating hides that, so the matrix is always reported with it.

**Gate.** The league report runs for all three table sizes and reproduces the baseline figures in this document to within their intervals.

### D. The environment

A thin layer over the engine that turns a game into a stream of decisions for a learner.

```ts
interface Env {
  reset(options: {
    seed: number;
    players: number;
    rules?: Partial<RuleConfig>;
    seats: Seat[];            // each a learner, or a league member that plays itself
    potentials: string[];     // which potentials to report
  }): Step;
  step(action: number): Step;
}

interface Step {
  seat: number;               // whose decision this is
  observation: Float32Array;  // what that seat may know
  mask: Uint8Array;           // which actions are legal
  phi: Float32Array;          // the value of each configured potential for that seat
  done: boolean;
  truncated: boolean;         // cut off by the turn limit, not finished
  final?: Final;              // at the end: each seat's result and place
  info: StepInfo;             // the kind of decision, the turn
}
```

- **One decision at a time.** The engine may wait on several players at once (an auction). The environment serves them one by one, in the order of play starting after the high bidder.
- **Forced moves are skipped.** A decision with a single legal action is applied without asking. That removes the opening roll.
- **Seats.** A seat is either exposed to the trainer or handed to a league member that plays it inside the environment. A trainer therefore sees only the decisions of the seats it is training.
- **Seat rotation.** The observer is always seat 0 and the others follow in the order of play. That one trick makes a policy indifferent to which faction it plays.
- **Truncation.** A game is cut off at a turn limit, set near the 99th percentile of finished games at that table size (see [statistics.md](statistics.md#how-long-games-last)). Among today's agents that is 310, 360 and 410 turns for two, three and four players in the full game, and 320 turns in the four-player short game. The limits are set again whenever the league changes, because a table that trades less plays longer: one refuser among four players raises the mean from 188 turns to 214. A cut-off game is not ranked. The learner treats the cut as a pause, not an ending, and takes the value of the last state in place of a result (partial-episode bootstrapping; Pardo and others, 2018). The share of games cut off is a metric to watch: where nobody trades, most games never end.

**The ledger.** The state says where things stand, not how the table has behaved, and the second is what a player reads to decide whether to play for sets or for passes. The environment therefore keeps a ledger for each game, built from the engine's events, and the encoder reads it. For every seat it holds running counts: properties bought and declined at list price; auctions entered, the highest bid made as a multiple of list price, auctions won; trades proposed, accepted and rejected, as proposer and as receiver; buildings bought and sold; mortgages taken; average cash at the start of its turns. The same ledger code runs in the client, fed by the same events.

**Observation, version 3.** A flat vector of 1,023 numbers. [plan/m04-environment.md](plan/m04-environment.md) and [plan/m03b-table-politics.md](plan/m03b-table-politics.md) give every block to the last number; the table here is the outline. Version 2 had 985 numbers. Version 3, built on 18 November 2026, widened the risk block from the observer to every seat and added what table politics needs: what has passed between each pair of seats, and what an offer does to each seat's chance. A model or a decision set of version 2 is refused, not misread.

| Block | Per item | Items | Numbers |
| --- | --- | ---: | ---: |
| Players | present, bankrupt, is the turn player, cash, position (one-hot over 40), in jail, jail rolls, jail cards, value by V1 | 4 | 192 |
| Players' standing | the measures of standing of workstream A, as shares of the table's total | 4 | 80 |
| Players' habits | the ledger's counts for the seat, as rates | 4 | 48 |
| Properties | owner (one-hot: bank and four seats), mortgaged, level (one-hot over six), is the subject of the open decision, I would receive it, I would give it | 28 | 420 |
| Property facts | price, landing rate, rent at the current level, the share of its set I hold, the largest share one rival holds, would complete a set for me, would complete one for a rival | 28 | 196 |
| Table | phase, doubles so far, round, buildings left in the bank, kind of open decision (one-hot), high bid, who is still bidding, debt and creditor, the offer on the table or being drafted, table size (one-hot), players still in, short or full game, my place in the order of play | 1 | 47 |
| Risk | the largest rent or tax the seat could owe on its next roll, the amount expected, and the rent it expects from the others' next rolls | 4 | 12 |
| Relations | deals between each pair of seats (6); for each rival: offers refused each way, the highest multiple of list price it refused from me, turns since my last offer to it, goodwill each way | 3 | 24 |
| Deal sheet | what the offer on the table, or my draft so far, does to the seat's chance | 4 | 4 |

Amounts are divided by the starting cash. The property facts repeat what a policy could work out from ownership alone; they are there because they are cheap, and because the study shows they are what winning turns on.

What a seat may not know stays out: the order of the decks, the generator's state and the dice queue. The environment's tests check it.

**Actions, version 2.** One discrete choice among 188, masked to what is legal.

| Group | Actions | Count |
| --- | --- | ---: |
| Fixed | roll, end turn, pay bail, use card, buy, decline, pass, accept, reject, withdraw offer, declare bankruptcy, redeem a received mortgage, keep it mortgaged | 13 |
| Per street | build, sell one building | 44 |
| Per property | mortgage, redeem | 56 |
| Bid | eight levels | 8 |
| Drafting an offer | ask for a property (28); give a property or nothing (29); cash level, either way, which sends the offer (9); drop the draft (1) | 67 |

- **Bids** are eight levels between the legal minimum and the bidder's cash: the minimum, the minimum plus 10, then 50%, 75%, 100%, 125% and 150% of the list price, and all in. Levels outside the legal range are masked. In a building auction the street is chosen by rule (where rent grows most).
- **Offers** are composed in steps inside the environment: what is asked for, what is given, then how much cash and which way, which sends it. Only the last step reaches the engine, as one `PROPOSE_TRADE`. The policy keeps a single masked head, and an offer of property for property with cash on either side takes three choices instead of one choice among tens of thousands. Workstream H says when these actions are switched on.
- **Left to rules:** selling a whole group down in one step, which is needed only when a fortress must be broken up and the bank is short of farmsteads.

Invalid actions are masked out of the policy's distribution, never punished with a negative reward. Huang and Ontañón (2022) show that masking is a valid policy gradient and that it keeps working as the share of invalid actions grows, where penalties fail.

**Tests the environment must pass before any training.**

- The mask marks exactly the actions `legalActions` allows, across thousands of simulated decisions at every table size.
- Every action index decodes to an action the engine accepts when the mask allows it.
- The observation does not change when the deck order, the generator state or the dice queue are changed.
- The same seed and actions give the same episode, rewards included.
- The ledger rebuilt from a game's events equals the ledger kept while playing it.
- Every potential telescopes: over an episode its terms sum to nothing more than its end value less its start (see E).

**Speed.** The engine alone plays about 34,000 actions a second on one core, agents included. The costs of encoding, serializing and crossing between processes are not known. Measuring them is the first task of this workstream, before any training code is written. If the bridge is too slow, in order of effort: send observations as binary rather than JSON; let the server apply actions in place instead of cloning the state at every step; compute legal actions incrementally.

### E. Rewards

The goal is to win. Everything else in this section exists to make that goal learnable in a game where a seat makes hundreds of decisions before it finds out. Every signal is a named term with a weight, switchable from the run's configuration. The environment reports each potential's value at every decision, and the trainer combines them, so a weight or the discount can change without touching the environment and each term's effect can be measured.

**1. The result.** Paid once, at the end.

| Table | Default | Variant |
| --- | --- | --- |
| Two players | +1 to the winner, −1 to the loser. | |
| Three or four | **Winner takes all:** +1 to the winner, −1 shared among the rest. | **By place:** from +1 for first to −1 for last, evenly spaced, places among the losers by who lasted longer. |

Main agents train on the default, because the game has one winner. The variant values survival; it is used for a style learner and kept as an ablation.

**2. Shaping by value.** Between two decisions of the same seat, the seat receives the change in a potential:

```text
F = β · (γ · Φ(next state) − Φ(state)),   Φ = 0 at the end of the game
```

Φ is the seat's chance of winning as a valuation sees it: V1 at first, V2 once it exists. A reward of this form leaves the best policy unchanged (Ng, Harada and Russell, 1999), and in a game of several players it leaves the equilibria unchanged (Devlin and Kudenko, 2011), also when the potential itself changes during training (Devlin and Kudenko, 2012). So it can tell the learner early that completing a group or taking a fourth pass was good, by exactly as much as those things are worth, without teaching it to chase them at the cost of winning. It rewards whatever the valuation has learned to value, including things nobody thought to list.

**3. Milestones, as potentials.** The signals below are the ones a person would name. Each is a number between 0 and 1 computed from the state of one seat, and each enters as a potential, exactly like Φ above, with its own weight.

| Signal | Value for a seat |
| --- | --- |
| Groups | Complete groups held, each counted by its static return (V0), scaled so that the best three count as 1. |
| Built to three | The share of streets in the seat's complete groups that stand at three or more. |
| Passes | 0, 0.03, 0.13, 0.38, 1 for none to four, in proportion to what they earn. |
| Rent roll | The seat's share of all the rent the table's properties would charge now. |
| Rent roll within reach | The same, counting what each seat's cash could build at once. The study's best single guide to who is ahead (finding S3). |
| Funds | The seat's share of the table's disposable funds (finding S4). |
| Denial | The share of groups in which a rival holds every street but one and the seat holds that one. |
| Safety | Whether the seat's cash covers the largest rent it could owe on its next roll. |
| Supply | The seat's share of the buildings in play, counted only while the bank is short. |
| Solvency | The share of the seat's property that is not mortgaged. |
| Eliminations | Rivals the seat has bankrupted, as a share of its rivals. |
| Threat denial (M3b) | Denial weighted by whom it stops: over the groups where the seat holds the one street a rival lacks, that rival's chance of winning. |

No new term is needed for buying toward a group early. The value potential already pays for a second street by what the valuation says it is worth, which finding S16 puts close to the worth of the last.

Why potentials and not bonuses: a bonus paid when something happens can be farmed. Pay for the third building and a policy can learn to build, sell and build again. A potential pays for holding the thing and takes the payment back when it is lost, so a loop earns nothing. One of the environment's tests checks exactly this.

The list is a start, not the whole of R4. Every measure of standing in workstream A can be used as a potential in the same way, so a new signal costs one function and one line of configuration, and the study says beforehand how it relates to winning.

**4. Schedules.** A main agent starts with the milestone weights on and β high. The milestone weights fall to zero over the first part of training, and β falls to zero before the end, so that the final stretch is trained on the result alone and the comparison with and without shaping is reported. A style learner keeps the milestone weights of its style for good: that is what makes it a school.

**5. Searching the rewards.** Which signals help, and how strongly, is an empirical question, and R4 asks for more exploration than a hand-picked list. The weights are therefore searched as well. Several short runs start from the same checkpoint with different weights; they are judged by win share against the league on seeds none of them trained on, never by their own shaped return; the best are copied and perturbed (in the manner of population-based training; Jaderberg and others, 2017). The run's record shows which signals survived.

**6. Predictions on the side.** The network also predicts things that are not rewards: each seat's finishing place, the rent the seat will collect over the next ten rounds, whether it will complete each group, whether it will be bankrupt within twenty rounds. The targets come free from the rest of the episode. They teach the shared layers what matters in a position without changing what the policy is paid for (Jaderberg and others, 2016).

**7. Discount.** 0.999. A seat makes about 195 decisions in a four-player game and 273 in a two-player one, and a smaller figure would make the end of the game invisible from the start.

**The rule for every term.** A term stays in the final recipe only if removing it lowers the win share against the league on held-out seeds, by more than the interval. The ablation table is part of every milestone's report.

### F. Supervised learning

The schools are free teachers. This stage uses them to prove the pipeline and to give reinforcement learning somewhere to start.

**F1. Data.** Games among league members at all three table sizes give, for every decision that is not forced: the observation, the mask, the action taken, the school that took it, and how the game ended for that seat. Ten thousand four-player games give about 7.8 million decisions, forced ones included; the engine plays them in about four minutes on one core before the cost of encoding. At 1,023 numbers a decision that is about 2 KB, so the training sets are written once to a large disk by `scripts/make-dataset.ts` and read many times: every run then sees the same data, and a pass over a file is faster than playing the games again. A share of the games has random moves mixed in, so that the data covers positions good players never reach.

**F2. Behaviour cloning.** A masked classifier trained to predict the action taken, in two forms.

- *The starting policy.* Trained on the decisions of the strongest schools at each table size, weighted by league rating. It is the main agents' starting point. It imitates several teachers, not one (R1).
- *The style-conditioned policy.* The same network with the school's parameters as an extra input, trained on all schools. One file that can play any school on request. It is how the client can later offer opponents with different characters.

*Gate:* on held-out games, at least 90% agreement with each teacher on that teacher's decisions for the conditioned policy; and for the starting policy, taking one seat among baselines, a win share whose interval lies at or above an even share at every table size.

*What it proves:* the encoder carries enough information, the codec is right, the bridge works, and the exported model plays in the browser. A clone that cannot match its teachers means a bug in one of those, and it is far cheaper to find here than in the middle of a reinforcement-learning run.

**F3. The value network (V2).** From the same games: predict each seat's chance of winning from an observation, together with the side predictions of section E. It gives the reinforcement learner a critic to start from and the shaping its potential.

*Gate:* on held-out games it is calibrated (of the positions it calls 70%, about 70% are won), and it beats V1 on log loss at every table size.

A clone inherits its teachers' blind spots. Going beyond them is what the next stage is for.

*First results (18 November 2026, the pipeline only; see [m05](plan/m05-supervised.md)).* A clone of the rule-based agent alone, at four players, agrees with it on 92% to 93% of held-out decisions yet wins only 6.8% to 8.5% as one seat among baselines. Agreement is not enough. Handing kinds of decision back to the rules one group at a time shows where the gap is: with only its free turns (building, lifting mortgages, offers, ending the turn) made by the rules it wins 23.8%, level with the rules alone, and the same with only the decisions where it could start an offer; bids, answers to offers, building and lifting mortgages cost little on their own. The clone starts 0.9 offers a game where the rules start 3.1, so it completes fewer groups and builds half as often; but weighting that choice in the loss does not help, because its games seldom reach a position worth an offer (1.3 a game, of which it takes 74%). Small errors after the roll compound into different games, which is what correction in the manner of DAgger is for, and the reward in M6 has to reach the same positions. A flaw in the first decision sets (every decision recorded with two offers left in the turn) was fixed on the way.

*Decided by the author on 18 November 2026.* The cheap remedies still to try are run (more perturbed games, further rounds of correction), and the clone is scored the way M6 will use it, with a school proposing on its behalf. That removes the part of the fault that lies in choosing to offer, which by the tally is the smaller part: the clone already takes 74% of the positions the rules would offer in, and reaches too few of them. M6's code is written meanwhile, and M6 starts from the best clone to hand even if the bar is unmet: a reward reaches positions that imitation does not. The bar stays as written and is reported as it stands. A teacher that asks only when it lacks one street gives a learner three chances a game to see an offer made; the schools of workstream K ask earlier and oftener, and join the teachers when M3b has measured them.

### G. Reinforcement learning

**Algorithm.** Proximal policy optimization (Schulman and others, 2017) with a masked policy head and a value head, started from the weights of stage F. It is the method the strongest published agent for this kind of game used, it tolerates long horizons with generalized advantage estimation (Schulman and others, 2015), and it is forgiving of its settings.

**Network.**

- Input: the observation of section D.
- Trunk: a perceptron, three layers of 512. If it plateaus, the next step is to treat the 28 properties and the four players as sets and let attention relate them, since what matters about a property is mostly who owns its neighbours.
- Heads: the policy over the masked actions; a value for each table size; the side predictions.
- Table size is an input and selects the value head, so one network can serve all three sizes while valuing them differently.

**Settings to start from.** These are common defaults (Schulman and others, 2017; Huang and others, 2022), not results. They are where tuning begins.

| Setting | Start |
| --- | --- |
| Discount, advantage decay | 0.999, 0.95 |
| Clip range | 0.2 |
| Learning rate | 3e-4, falling linearly to zero |
| Epochs per update, minibatch | 4, 4,096 decisions |
| Decisions per update | about 130,000 (some 170 four-player games) |
| Entropy bonus | 0.01, falling to 0.001 |
| Value loss weight, gradient clip | 0.5, 0.5 |
| Advantages | normalized within each batch, separately for each kind of decision |

**Staying close to the teachers at first.** Early updates can destroy what cloning learned before the value head is any good. A loss that pulls the policy toward the starting policy is added with a weight that decays to zero (kickstarting; Schmitt and others, 2018), which lets the learner pass its teachers instead of first falling below them.

**The skew.** Most decisions are routine and a few decide the game. Five measures against a learner that spends itself on the routine ones:

1. Forced moves never reach the learner.
2. Advantages are normalized by kind of decision, so that the many small decisions do not set the scale for the few large ones.
3. The loss is weighted by kind of decision; the weights are settings.
4. The entropy bonus is set by kind of decision: exploration is cheap in an auction and expensive at the roll.
5. A kind of decision can be left to a school for a whole stage and taken over later. Proposing trades starts that way.

**Opponents.** Each game draws its table from the league.

- The table size follows the stage of the curriculum.
- The other seats are drawn with weights that grow with how often the learner loses to a member (prioritized fictitious self-play, from AlphaStar; Vinyals and others, 2019), so that training time goes where the learner is weakest.
- A fixed share of games, a fifth to start, is played against tables of baselines, so that progress against the yardstick is never lost.
- A tenth is played against the holder of the learner's own line of succession, the best version so far, and every earlier holder stays in the league. A learner is always being measured against what it has to beat.
- A share is played against copies of the learner itself, kept small at first: a table of copies can settle into habits that only work against copies.

**Curriculum and gates.** The simplest game first. With two players the result is zero-sum and every deal has one counterparty. The short game is used only with four players, the one size at which it is much shorter (finding S14).

Every gate has two bars, for one learner among baselines on evaluation seeds with seats rotated. The first is an even share, over 1,000 games. The second is the refuser: over 5,000 games, the learner must win more than the refuser wins in the same seats on the same seeds, with the interval of the difference above zero. Refusing every offer is the cheapest way to beat today's agent (finding S5), and a learner that has found only that has not learned the game.

| Step | Game | Even share | The refuser's share, full game |
| --- | --- | ---: | ---: |
| G1 | Two players, full game | 50% | 58.2% |
| G2 | Four players, short game | 25% | To be measured in the short game |
| G3 | Three players, full game | 33.3% | 41.0% |
| G4 | All three sizes, full game | As above | 58.2%, 41.0%, 30.4% |
| G5 | All three sizes, full game, against the league | | |

G5 is passed when, against every school and every past self, the learner wins more than an even share as the one among copies, and no member wins more than an even share as the one among copies of the learner.

**One agent for each table size (R3).** The games differ: with two players every trade that helps one side hurts the other and blocking is nearly absolute; with three a losing player can decide which of the other two wins; with four, a group is seldom completed without a trade. The study puts figures on it (findings S2, S7, S10 and S11). One pass is worth 1.6 to 2.0 times its price with two players and less than its price with four. A property declined with two players goes to the rival for a fraction of its price. Without trades a group is completed in 93% of two-player games and 51% of four-player games. Training begins with one network for all sizes, because most of what it learns is shared. After G4 it is branched into three specialists, each trained on its own size alone. A specialist ships only if it beats the shared network at its size on evaluation seeds, with the interval of the difference above zero.

**Style learners.** Copies of the starting policy trained under a school's milestone weights, held constant. They are schools that are learned instead of written (R2), and they join the league when they pass two checks: their behaviour, by the study's measures, differs from every other member's, and they win at least an even share against baselines.

**Exploiters.** Every so often a fresh copy of the starting policy is trained against the frozen main agent and nothing else. Its only job is to find a hole. If it wins clearly more than an even share, it joins the league, so that the main agent must now learn to beat it, and what it does is written into the run's record. The best exploiter's win share is the nearest thing to a measure of how exploitable the main agent is.

**Hazards to watch for.**

- *Stalling.* If a cut-off game is worth more than a finished one, the agent learns to stall. Treating a cut as a pause removes the incentive; the share of cut-off games is tracked.
- *Never trading.* Refusing every offer is safe and, against today's rule-based agent, profitable: it wins 30.4% of four-player games. A learner can settle there, and a table of such learners seldom finishes a game: with nobody trading, 61% of four-player games are still running after 40,000 actions. The league must contain schools that trade well, so that refusing has a price.
- *Collusion.* Copies of one policy can learn to feed each other through trades. Workstream H measures it. Working together against a leader is not collusion and is wanted (R11); the line between them is that a deal may depend on a partner's standing and never on who the partner is. A learner's deals are compared between partners of the same rank who are and are not its copies.
- *Variance.* One game says little. Batches span many games, and no conclusion rests on fewer than several hundred.
- *Forgetting.* An agent that has learned to beat its own past may stop beating the baseline. Every checkpoint is evaluated against the fixed tables.
- *Rewards that outlive their use.* A milestone weight left on too long becomes the goal. The schedules and the ablations are there to catch it.

### H. Trading

Trading is where a person most easily exploits an agent, where the action space is largest, and, by the study, what decides whether games end at all. It is taken in three steps, each inside the reinforcement learning of workstream G.

1. **Answering,** from the first step of G. Accept or reject is a binary action and the offer is in the observation.
2. **Proposing, from the drafting actions,** switched on after G4. Until then the starting policy's school proposes. The drafting actions cover cash for a property, a property for a property, and either with cash added on either side.
3. **Reading the table.** No separate mechanism: the ledger in the observation, and opponents in the league whose willingness to trade differs widely, give the learner both the information and the reason to change its plan when a table does or does not deal.

What the policy sees about an offer, on the table or in draft: whether it completes a set for either side; each side's cash after the deal; how many buildings each side could then afford on the set it completes; and the change the valuation sees in each side's chance of winning. The last matters differently by table size. With two players a deal good for one side is bad for the other. With more, a deal can be good for both sides and bad for everyone else at the table.

**Measures.**

- *Bad offers.* A fixed suite of offers nobody should take (a pittance for the last street of a group, and the like) and of offers nobody should refuse. The right answer to each is measured, by applying the deal to the position and playing both versions out, not assumed.
- *Transfers between copies.* At tables with two copies of the same agent and other members besides: how far the prices in deals between the copies sit from the valuation's prices, compared with their deals with others.
- *Trading well.* The win share of the agent against a copy of itself whose proposals and answers are replaced by the school's.

**Gate.** The gates of G hold or improve; bad offers are accepted in under 2% of cases and good ones refused in under 10%; deals between copies are priced no further from value than deals with others; and the agent beats the copy of itself that trades by rule.

The offers a learner can already draft cover every deal of workstream K: any property a rival holds can be asked for on any turn, for cash up to three times its list price or all the seat's spare cash. What a learner lacks is anyone to learn them from, which is what K supplies first.

### K. Table politics

Added on 18 November 2026, from the author's account of his own play (R11) and from what the study already shows (findings S16 to S19). [plan/m03b-table-politics.md](plan/m03b-table-politics.md) is the stage.

**The idea.** With three or four players a deal moves chance of winning from the seats outside it to the seats inside it. Two trailing players who swap streets so that each completes a group gain, and the leader pays most of it. So the choice of partner is a move in its own right, and so is the choice of whom to stop. The agents so far choose neither: every proposer waits until it lacks one street and offers a fixed multiple of list price to whoever holds it.

**The deal sheet.** For any deal, the change in every seat's chance by the valuation. It is the one number the behaviours below price by, and what a learner sees of an offer from layout version 3.

**The behaviours,** each a field of a style and so a school that can be measured:

| Behaviour | What it does | Evidence in hand |
| --- | --- | --- |
| Early asks | Asks for a second street of a group, many rounds before the group lacks one. | S16: pays at three and four players before round 5 to 8 |
| Value pricing, asking again | An ask is priced as a share of what the property is worth to the seat, raised after a refusal, and made again when the holder's position worsens. | The author's account. Loses when it prices the completing street low (S20), so that street keeps today's price |
| Denying | Buys what the strongest rival is about to gain, paying up to what the denial saves the buyer. | S19: worth about a point, whoever buys |
| Estates, rescue, hunting | Buys from a failing player before the bankruptcy; pays to keep an estate from the leader; builds where a failing player is about to land. | S17; hunting adds nothing (S22) |
| Answering by the sheet | Accepts by what a deal does to itself, to the strongest rival and to a weak partner. Covers working with the weak against the strong, favouring the second when third, and choosing a partner when ahead. | S18: one seat alone loses; S22: answering by the sheet alone is worth 4 to 6 points |
| Reciprocity | Asks more of a seat that has refused it and less of one it has dealt with. | Published strategy |
| Signals | Sends an invitation, an offer that plainly favours the seat it wants as a partner, and reads one by the goodwill a seat has shown it. An agreement is a favour returned. | The author's account |
| The debt window | Offers for a debtor's property at the moment it cannot pay, and, as a debtor, sells to a seat other than the creditor to stay in. | S17; the rules allow it and no agent does it |

**Rules the design keeps.**

- *By standing, not by name.* A seat is treated by its rank in the valuation and by what has passed between the two seats in this game. Whether it is a person or a program is not an input. A test permutes the seats and requires the permuted action.
- *No promises.* The rules have offers and answers only. An alliance here is a pattern of deals, and it ends when the position that made it ends.
- *Signals, not speech.* Decided by the author on 18 November 2026: nothing is added to the game for players to talk with. A seat asks for an alliance with an offer and is answered with one, and the design has two halves, sending and reading. A person's offers are read by the same rule as a program's.
- *As far as it wins.* Decided the same day: there is no setting for how hard a seat works against a leader, a person included. It goes as far as serves its own chance of winning and no further, so the weights are set by the seat's own win share and not by taste.
- *Measured at the right table.* One political seat among baselines shows little, because nobody answers in kind. Named tables with two such seats, and the leader's conversion there, are the measure.

**What is published agrees.** A book of strategy for the classic game (Walker and Lehman, 1975) gives a chapter to the balance of power. It sorts a table into four states (nobody ahead; ahead and unnoticed; ahead and worked against; a rival ahead), tells a co-leader to undermine the other leader by working with the trailing players, tells a trailing player to set the leaders against each other, and holds that the best thing for a leader is that the table believes someone else is ahead. Work on learned trading in another game of several players found that an agent trades better when it keeps a model of what its opponent wants (Efstathiou and Lemon, 2016; Cuayáhuitl and others, 2015). M3b's Statesman is written over the four states.

**Further strategy the plan has looked for** beyond the author's list. Each is present, planned, or set aside with its reason.

| Strategy | State |
| --- | --- |
| Favour the second when third, so that the two leaders wear each other down | Covered by answering by the sheet. |
| The creditor's seat: build where a failing player is about to land | Planned (`huntFailing`). `buildNear` builds near any rival and does not pick the failing one. |
| Rescue: keep a failing player's estate from the leader | Planned (`rescue`). |
| The end of the short game, which comes at the second bankruptcy: hasten it when ahead, delay it when behind | A playbook rule over the new signals; no new field. |
| Reciprocity and grudges | Planned (`reciprocity`), with a record of what has passed between each pair of seats. |
| A model of each rival's price | Planned in a first form: the record of each ask and its refusals, and each seat's rate of accepting. |
| Hiding a lead so as not to be worked against | Set aside until a table that works against leaders exists; then specified if the leader's conversion there falls by 5 points. |
| Choosing whom to hand the game to when lost | Exists as Kingmaker. People dislike being decided by a player who is out of it, so its use against a person is a question for M10. |
| Draining a rival's cash at auctions, leaving a partner too poor to build, cornering the buildings | Exist: `driveUp`, `leaveCash`, the Cornerer. |
| Offers out of turn | In the rules, and unused by every agent. Used at a rival's debt only (the debt window), until that is measured. |
| Deals among three seats; speech | Not in the rules, and by the author's decision speech is not added. |

**Gate.** The deal sheet agrees with deals measured by intervention; every school shows its behaviour; buying early beats the baseline at three and four players over 5,000 paired games; and every other behaviour, with the tables of two, is measured and recorded whichever way it falls.

*State on 18 November 2026.* The code of the stage is written and tested: the deal sheet, the relations, twenty-eight fields and their behaviours, the debt window, fifteen presets and a playbook, the measures and the script for named tables, the probe of deals, the genome, layout version 3 and the thirteenth potential. Writing it showed one thing about the valuation: what a property is worth to a seat when the cash leaves the game is about twice what the seat can pay another seat for it, because cash paid to a rival strengthens the rival (M3b, "Paying a rival is not paying the bank").

*State on 19 November 2026,* after the first night of runs ([M3b's Result](plan/m03b-table-politics.md#result)). The deal sheet passed its check against measured deals (96% of clear cells with the right sign, rank correlation 0.87). Every school shows its behaviour. Buying early pays at three and four players once the completing street keeps today's price (S16, S20). The Statesman, Hunter and Grudger beat the baseline by 5 to 13 points, mostly through mortgaging to build and answering by the sheet (S22); the Statesman is level with Sky rush, its base, once its pricing is fixed. Denying is worth little (S19). Among the strong style holders every political school measured wins clearly (S21). With the pricing fixed, each of the six value-pricing schools run again beats the baseline at four players by 3 to 6 points (S20). At four players two Balancers cut the holder's share and the leader's conversion; at three players they lose (S18). Signals pay at three players and cost at four (S23); reading them is safe at three players and, by 2.3 points, not at four. Waiting: the settings of `againstLeader`, the runs among refusers, and the search with the new genome.

### I. Looking ahead

The engine is deterministic and fast, and a state is plain data that can be copied. With a value network, an agent can test a decision before making it: for each candidate action, play a few dozen short continuations with the dice re-rolled and the unseen cards reshuffled, and average the value at the end. This is most useful for the few decisions that are both rare and large, such as an expensive purchase, a high bid or a trade.

It is optional, and it costs time at every decision. It belongs after G, and only if the learned policy alone has stopped improving.

### J. In the browser

- A policy of this size is three matrix products, so the client runs it with a forward pass written in TypeScript (`src/env/mlp.ts`), and the weights travel inside the script as 16-bit floats, about 3 MB a model. The desktop app opens a build from disk as one script with no other files, where a runtime that fetches a WebAssembly binary and a model file would need special handling. ONNX is still written at export, as the interchange format, and ONNX Runtime Web is the fallback if the network stops being a stack of dense layers. A decision is answered well within the 850 ms pause the client already takes before a computer player acts.
- A `learnedAgent` wraps it in the per-player form of [the interface](#the-agent-interface): keep the ledger, encode the state for the acting seat, run the model, take the best legal action, decode it. The client picks the model for the table size.
- A seat's setting grows from person or computer to person, rule-based or learned. The schools give the game difficulty levels, and the style-conditioned policy can give opponents different characters.
- The mask is applied in the browser as in training, so a model can never play an illegal move. If a model fails to load, the seat falls back to the rule-based agent.
- Every file in `assets/models/` carries a record: the commit and configuration it was trained from, its layout and action versions, its results on the standard tables, and the date.
- Before a model is offered, a person plays it. [plan/m10-in-the-client.md](plan/m10-in-the-client.md) has the questions that check asks.
- Opponents that play the table (workstream K) treat a person exactly as they treat a program of the same standing, and work against a leader as far as it helps them win. There is no setting for it and no channel for speech, by the author's decisions of 18 November 2026. What the client owes the player is that an invitation made with an offer can be read as one; M10's check asks whether it can.

### Evaluation protocol

The same protocol for every claim, in this document and afterwards.

- **Seeds set aside.** Seeds 1 to 999,999 belong to the study and the benchmark. Seeds 1,000,000 to 1,999,999 are for evaluation and are never trained or searched on. Training and search use seeds from 2,000,000, in ranges that [plan/README.md](plan/README.md) assigns stage by stage. Progress during training is checked on seeds of its own, so that choosing a checkpoint never uses the seeds a gate is read from.
- **Every table size.** A result is reported for two, three and four players, or says which it covers.
- **Rotated seats.** Every agent plays every place in the order of play equally often. The opening roll already shuffles the order by seed; first-mover advantage is measured in [statistics.md](statistics.md#the-order-of-play) and must be cancelled, not ignored.
- **Enough games.** 1,000 for a gate, which puts a 95% interval of about ±3 points on a win share near one half and ±2.7 near one quarter. 10,000 or more for a claim about a difference of a point or two.
- **Paired games.** Two agents being compared play the same seeds in the same seats, so that the dice cancel and the difference between them is measured directly.
- **Intervals with every number.** Wilson intervals, as `scripts/benchmark.ts` and `scripts/study.ts` print.
- **Worst case as well as average.** An agent's result against the league is its average and its worst row.
- **New against best.** A gate against fixed opponents says a version is good enough, not that it is better than the last. Every kind of agent therefore has a line of succession: a holder, and every holder before it. A new version takes the line only by beating the holder head to head, on seeds kept for such matches and never reused, without losing ground against the baselines or the league. Every holder is kept and played against, and a ladder of all holders shows whether strength rises with the version or goes in circles. Only holders ship. [plan/README.md](plan/README.md#new-against-best) has the rule.
- **Rule safety.** An evaluated agent must never produce an action the engine refuses. The simulator stops on the first refusal or broken invariant.
- **Behaviour.** The study's measures are run on every new agent: what it buys, how it bids, how far it builds, how it trades. A change in strength is always reported with the change in behaviour that produced it.
- **A person's check.** Before a model ships, play it in the client. Numbers do not catch an opponent that is strong and no fun.

### Running experiments

- **One configuration file per run,** under `train/configs/`: the table sizes, the opponents, every reward weight and schedule, every setting of the learner, the seeds.
- **One directory per run:** the configuration, the commit it ran from, the metrics as a line of JSON for each update, the checkpoints, and the evaluation reports.
- **Metrics every update:** win share against the fixed tables, by table size; the share of games cut off; game length; each reward term's contribution; entropy and loss by kind of decision; trades proposed, accepted and refused; buildings bought by level.
- **Replays.** Every game the trainer plays is fixed by its seed and its actions, so a surprising result can be replayed in the client and watched.
- **Compute.** The engine's share is known: about 23 core-seconds for 1,000 four-player games, so 100 million actions cost roughly 50 core-minutes of rules. Workstream D measured the rest on 18 November 2026 ([m04-environment.md](plan/m04-environment.md#result)): with the encoder, V1 and the rule-based players included, one core serves about 855 learner decisions a second at four players in process and about 720 through the bridge to Python, both measured on a loaded machine; eight workers should give roughly 6,000 a second. Nothing here yet estimates how many decisions reinforcement learning will need.

### Milestones

| | Deliverable | Workstream | Done when | Stage plan |
| --- | --- | --- | --- | --- |
| M0 | The simulation study and its statistics | | Done: `scripts/study.ts`, [statistics.md](statistics.md) | |
| M1 | The study's snapshot file; valuation V0 and V1, for each table size; the measurement by intervention | A | The gate of A | [m01](plan/m01-valuation.md) |
| M2 | The parameterised agent, the reference style and the named schools | B | Gates 1 and 2 of B; the study rerun with each school | [m02](plan/m02-schools.md) |
| M3 | The style search, the playbook search and the first league report | B, C | Gates 3 and 4 of B; the gate of C | [m03](plan/m03-search-and-league.md) |
| M3b | The deal sheet, the political schools, the measures of the table, layout version 3 | K | The gate of K | [m03b](plan/m03b-table-politics.md) |
| M4 | The environment, the ledger, the server, a throughput figure for the bridge | D, E | The environment's tests pass and the figure is written here | [m04](plan/m04-environment.md) |
| M5 | Held-out sets, the starting policy, the style-conditioned policy, the value network; a clone playing in the client | F, J | The gates of F | [m05](plan/m05-supervised.md) |
| M6 | PPO: two players, then four in the short game, then three | G | G1 to G3 | [m06](plan/m06-first-games.md) |
| M7 | PPO: full game, specialists for each size | G | G4, and the test for shipping a specialist | [m07](plan/m07-full-game.md) |
| M8 | League training with style learners and exploiters; the conductor; the reward search | E, G | G5; the ablation table | [m08](plan/m08-league-training.md) |
| M9 | Learned proposals and the trading measures | H | The gate of H | [m09](plan/m09-trading.md) |
| M10 | Opponents selectable in the client, by level and by character | J | A person has played them; the baselines table has new rows | [m10](plan/m10-in-the-client.md) |

M1 to M3b depend only on the engine. M4 can proceed alongside them. Nothing from M5 on should start before M3 and M4 are done, because they supply its opponents, its data and its tests. One exception was decided on 18 November 2026: M6 may be written, and started from the best clone to hand, while M5's bar for the starting policy is unmet (see F). M5's full sets of decisions wait for M3b, which changes the teachers and the layout.

### Risks

| Risk | What would show it | Answer |
| --- | --- | --- |
| The bridge is too slow to train through | The throughput figure of M4 | The three speed measures of D, in order; failing those, batch more environments per process |
| The schools are too weak to teach anything | The best style barely beats the baseline in M3 | Widen the parameter space where the search runs into its limits; the reinforcement learner needs only a starting point, not a master |
| Shaping changes what is learned | The ablation at the end of training differs from the shaped run | It is annealed to zero by design; report both |
| The learner settles on refusing every trade | Trades accepted fall to zero; games cut off rise | Schools in the league that punish refusing; the trading measures of H |
| Results that are luck | A gate passes once and fails on new seeds | Evaluation seeds are separate; gates are rerun on fresh seeds before a milestone closes |
| Strength without variety | Every league member converges on one way of playing | The archive keeps styles by kind, not by rank; style learners keep their own rewards |
| A strong agent that is no fun | The person's check | Ship several levels and characters, chosen for how they play as well as how often they win |
| Computer players that gang up on the person | The person's check; a learner's deals differing between a person and a program of the same rank | Treatment by standing only, tested by permuting seats. An opponent works against a leader as far as it helps it win and no further; a player who wants a gentler table chooses opponents that do not play this layer |
| Political schools that only exploit today's cheap seller | A school beats the baseline and loses among refusers | Every behaviour of K is also measured among refusers and among the best found styles, and what it exploits is written into its record |
| A valuation that misprices deals it never saw | The deal sheet disagrees with deals measured by intervention | The probe of M3b; prices from the probe where the sheet fails; a refit of the valuation on games that contain such deals |

### Open questions

- **How much compute reinforcement learning needs** is not known. M4 answers the first half of the question.
- **Whether winner-takes-all or by-place rewards make the better opponent** at three and four players. The first is truer to the rules; the second may play more like a person who would rather come second than last.
- **How far the four-player short game transfers to the full one.** The curriculum assumes it does. The short game ends by ranking on net worth, which the study shows to be a poor guide to who is winning.
- **What holding a rival's missing street is worth once agents bargain.** Among today's agents it is a bad sign, because they sell it cheaply (finding S5). The measures of bargaining position are kept and measured again as the league improves. Buying it to deny the rival was worth about a point among today's agent, whatever the buyer's rank (finding S19); that probe played on with agents that sell such a street on, so a denial that is held is still unmeasured.
- **Whether working against a leader pays at all among these agents.** One seat doing it loses (finding S18). Whether two gain by it is what M3b's tables of two are for; if they do not, the question passes to the learners of M8.
- **Whether a person can read an invitation made with an offer, and whether a computer seat reads a person's.** The signals are meant to be plain: a street one needs, at its list price, from a seat that also trails. Only play will tell, and M10's check asks.
- **What the debt window does to the game.** By the rules any seat may buy from a debtor at the moment of the debt. Among agents that do, fewer estates should reach the creditor and fewer players should be eliminated early; whether games then run too long is measured in M3b.
- **Whether a second street is worth what finding S16 says once the last street cannot be bought cheaply.** Partly answered: among the strong style holders, who do not sell cheaply, Early bird wins 24.7% and 33.4% against the baseline's 19.8% and 11.0%; among refusers it draws (−1.4 and +0.2 points).
- **Why a single street of House of Sima is worth so much with four players,** and holding both so little more. The study shows it and does not explain it.
- **Whether refitting V1 as the league changes helps or chases its own tail.** The value of a holding depends on how the table plays, and the table is what is being trained.
- **Whether changing plan by rule beats holding one plan,** and whether learned switching beats written rules. M3 and M8 each measure it; the first search's fixed styles may turn out to be hard to beat.
- **What "strong" should mean in a game people play for fun.** An agent that never trades, or that always blocks, may win and still be poor company.
- **Whether the short game should rank players by something closer to real value.** A question for the rules, raised by workstream A.

### References

- R. Ash, R. Bishop. "Monopoly as a Markov process." Mathematics Magazine 45(1), 1972.
- P. Bailis, A. Fachantidis, I. Vlahavas. "Learning to play Monopoly: A Reinforcement Learning approach." AISB 2014. [PDF](https://www.doc.gold.ac.uk/aisb50/AISB50-S02/AISB50-S2-Bailis-paper.pdf)
- T. Bonjour, M. Haliem, A. Alsalem, S. Thomas, H. Li, V. Aggarwal, M. Kejriwal, B. Bhargava. "Decision Making in Monopoly using a Hybrid Deep Reinforcement Learning Approach." IEEE Transactions on Emerging Topics in Computational Intelligence 6(6), 2022. [arXiv:2103.00683](https://arxiv.org/abs/2103.00683)
- H. Cuayáhuitl, S. Keizer, O. Lemon. "Strategic dialogue management via deep reinforcement learning." 2015. [arXiv:1511.08099](https://arxiv.org/abs/1511.08099)
- S. Devlin, D. Kudenko. "Theoretical considerations of potential-based reward shaping for multi-agent systems." AAMAS 2011. [PDF](https://eprints.whiterose.ac.uk/id/eprint/75111/1/aamas11.pdf)
- S. Devlin, D. Kudenko. "Dynamic potential-based reward shaping." AAMAS 2012. [PDF](https://eprints.whiterose.ac.uk/75121/2/p433_devlin.pdf)
- I. Efstathiou, O. Lemon. "Learning better trading dialogue policies by inferring opponent preferences." AAMAS 2016 (extended abstract). [PDF](https://ifaamas.org/Proceedings/aamas2016/pdfs/p1403.pdf)
- D. Hunter. "MM algorithms for generalized Bradley-Terry models." The Annals of Statistics 32(1), 2004. [Project Euclid](https://projecteuclid.org/journals/annals-of-statistics/volume-32/issue-1/MM-algorithms-for-generalized-Bradley-Terry-models/10.1214/aos/1079120141.full)
- S. Huang, R. Dossa, A. Raffin, A. Kanervisto, W. Wang. "The 37 implementation details of Proximal Policy Optimization." ICLR Blog Track, 2022. [Post](https://iclr-blog-track.github.io/2022/03/25/ppo-implementation-details)
- S. Huang, S. Ontañón. "A Closer Look at Invalid Action Masking in Policy Gradient Algorithms." FLAIRS 2022. [arXiv:2006.14171](https://arxiv.org/abs/2006.14171)
- M. Jaderberg, V. Mnih, W. Czarnecki, T. Schaul, J. Leibo, D. Silver, K. Kavukcuoglu. "Reinforcement learning with unsupervised auxiliary tasks." 2016. [arXiv:1611.05397](https://arxiv.org/abs/1611.05397)
- M. Jaderberg and others. "Population based training of neural networks." 2017. [arXiv:1711.09846](https://arxiv.org/abs/1711.09846)
- J.-B. Mouret, J. Clune. "Illuminating search spaces by mapping elites." 2015. [arXiv:1504.04909](https://arxiv.org/abs/1504.04909)
- A. Ng, D. Harada, S. Russell. "Policy invariance under reward transformations: Theory and application to reward shaping." ICML 1999.
- F. Pardo, A. Tavakoli, V. Levdik, P. Kormushev. "Time limits in reinforcement learning." ICML 2018. [arXiv:1712.00378](https://arxiv.org/abs/1712.00378)
- S. Schmitt and others. "Kickstarting deep reinforcement learning." 2018. [arXiv:1803.03835](https://arxiv.org/abs/1803.03835)
- J. Schulman, P. Moritz, S. Levine, M. Jordan, P. Abbeel. "High-dimensional continuous control using generalized advantage estimation." 2015. [arXiv:1506.02438](https://arxiv.org/abs/1506.02438)
- J. Schulman, F. Wolski, P. Dhariwal, A. Radford, O. Klimov. "Proximal Policy Optimization Algorithms." 2017. [arXiv:1707.06347](https://arxiv.org/abs/1707.06347)
- O. Vinyals and others. "Grandmaster level in StarCraft II using multi-agent reinforcement learning." Nature 575, 2019.
- J. Walker, J. Lehman. "1000 Ways to Win Monopoly Games." 1975. Chapter 11, "The balance of power". [PDF of chapters 11 and 12](https://www.jeffreylehman.com/pdf_files_collection/1000-ways-chapters-11-12.pdf)
