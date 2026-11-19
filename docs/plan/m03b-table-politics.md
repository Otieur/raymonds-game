# M3b. Table politics

## Purpose

With three or four players a deal is never only between two seats. It moves chance of winning from the seats outside it to the seats inside it, so whom a seat deals with, whom it refuses and whom it stops decide games as much as what it buys. The agents built so far do not play this layer. Every proposer waits until it lacks one street, prices by a fixed multiple of list price, and treats the other seats as scenery. Two fields touch it (`shunLeader`, `giveUpBelow`) and both are crude.

The project's author plays this layer deliberately, and on 18 November 2026 asked for it to be designed in (requirement R11 of [ai.md](../ai.md)): buying toward a group many rounds before it lacks one street; buying, at a high price if need be, what a strong rival needs; buying a failing player's property long before the bankruptcy that would hand it to the creditor; working with the weak against the strong when behind, and choosing a partner early when ahead; and asking again and again over many rounds, because an answer changes with the position. He signals that he wants a partner by the offers he makes, without a word, and reads the same from others. Findings S16 to S19 of ai.md are the evidence already in hand.

This stage does five things, all on the engine alone, with no network:

1. A **deal sheet**: what any deal does to every seat's chance of winning.
2. The behaviours above as fields of a style, so that each is a school that can be measured and can lose.
3. **Measures of table politics** in the study and the league.
4. Experiments that say whether each behaviour pays: against today's agent, against players who do not sell, and at tables where two seats play this way.
5. What the later stages need from it: teachers for M5, schools for M8's conductor, cases for M9's offer suite, an observation that carries relations between seats, and questions for M10's person's check.

It needs M1 (the valuation and `priceOf`), M2 (the style agent) and M3 (the league and the search). It feeds M5, M8, M9 and M10.

## Deliverables

| File | Contents |
| --- | --- |
| `src/sim/deal.ts` | `dealSheet`, `threatOf`, `distressOf`, `denialWorth`. |
| `src/sim/relations.ts` | What has passed between each pair of seats: deals, refusals, the price of each ask, each seat's chance round by round. |
| `src/sim/style.ts`, `style-agent.ts`, `parts.ts` | Twenty-eight new fields and the behaviours behind them. Every default leaves today's behaviour unchanged. |
| `src/sim/signals.ts` | Four new signals. |
| `src/sim/styles.ts` | Fifteen new presets and one playbook. |
| `scripts/study.ts` | The measures of table politics for the odd player. |
| `scripts/table.ts` | Plays one named table many times and prints each seat's share and the table's political measures. |
| The simulator (`simulateGame`), the study and the environment's ruled seats | The debt window: seats are asked whether they propose when a rival cannot pay a debt. |
| `scripts/league.ts` | The report gains leader conversion, changes of lead and where estates go. |
| `scripts/probe-hands.ts` | Changes of hands between players, measured by intervention. A script of its own beside `probe-value.ts`, which it leaves as M1 ran it. |
| `src/sim/politics.ts` | The watch that keeps the measures of table politics for a game. |
| `src/sim/window.ts` | The debt window. |
| `scripts/check-style.ts` | The behaviour bars of the new schools; the renaming check. |
| `scripts/search-styles.ts` | The new fields in the genome. |
| `src/env/observe.ts`, `src/env/ledger.ts`, `src/env/potentials.ts` | Layout version 3; the potential `threatDenial`. |
| `test/deal.test.ts`, `test/relations.test.ts`, additions to `test/style-agent.test.ts` and `test/env/env.test.ts` | Tests. |

## Specification

### The deal sheet

```ts
export interface Deal {
  from: PlayerId;
  to: PlayerId;
  give: { cash: number; properties: string[]; jailCards: number };     // what `from` hands over
  receive: { cash: number; properties: string[]; jailCards: number };  // what `from` gets
}
export interface DealSheet {
  /** Each seat's chance before the deal, in the order of state.players. */
  before: number[];
  /** The change in each seat's chance of winning by the valuation. Sums to zero. */
  delta: number[];
  /** The state with the deal applied. */
  after: GameState;
}
export function dealSheet(ctx: Context, state: GameState, deal: Deal, valuation: Valuation, before?: number[]): DealSheet;
/** The most a seat can pay for a change without losing by it; with `payee`, when the cash goes to that seat. */
export function worthInCoins(ctx, state, changed, seat, valuation, bound, payee?): number;
```

The deal is applied to a copy of the state and the valuation is read before and after. The sheet is the number every behaviour below prices by: what an ask is worth, who pays for a deal, and whether a partner will find it worth taking.

The valuation is one model over the seats of a table (M1), so when one seat's standing rises, the chance it gains is taken from the others roughly in proportion to the chance each already has. Two consequences follow, and the probe below tests both: a deal between two trailing seats is paid for mostly by the leader; and stopping a rival's gain is worth most to the seat nearest that rival and little to the seat in last place.

**Paying a rival is not paying the bank.** What a property is worth to a seat when the cash leaves the game, and what the seat can pay another seat for it, differ: cash paid to a rival strengthens the rival, and the sheet counts that against the payer. For the last street of Chain Stratagem at round 10 the first figure is 1,038 and 962 coins with three and four players and the second 529 and 548, about half. Every purchase from a seat is priced by the second. M1's worths in coins are of the first kind, which is right for a purchase from the bank and too high for a trade.

**Limit.** V1 was fitted on games among today's agent, which sells the last street of a group for about twice its list price. It therefore prices two streets of three almost as high as three, because among those agents the third follows. Against players who do not sell, the sheet overstates an early purchase. The probe measures how far, and `earlyNeed` below discounts for it.

### Threat and distress

```ts
/** A rival as a danger: its chance now, and its chance after the one acquisition that would raise it most. */
export function threatOf(ctx, state, seat, valuation): { now: number; potential: number; wants: string | null; canBuild: number; income: number };
/** A seat as a failing player. */
export function distressOf(ctx, state, seat, valuation, relations): { chance: number; short: boolean; mortgaged: number; falling: boolean; creditor: PlayerId | null };
```

| Field | Value |
| --- | --- |
| `now`, `potential` | The seat's chance by the valuation, over an even share among those still in; the same in the state where it holds the one property, not its own, that raises its chance most (`wants`). |
| `canBuild` | Buildings its spare cash would pay for on its complete groups now. |
| `income` | The rent it expects from the other seats' next rolls. |
| `short` | Its cash is below the largest rent or tax it could owe on its next roll. |
| `mortgaged` | The share of its property, by list price, that is mortgaged. |
| `falling` | Its chance fell in each of the last three rounds (from the chance log below). |
| `creditor` | The owner of the largest rent it could owe on its next roll: the seat most likely to take its estate. |

A rival is **failing** when its chance over an even share is below the style's `failBelow` and it is either `short` or `falling`. The **strongest rival** of a seat is the rival with the highest `potential`. These are the author's own tests (property held, a group nearly complete, cash to build, rent about to arrive, the chance of winning) gathered into numbers.

### What stopping a rival is worth

```ts
export function denialWorth(ctx, state, me, rival, property, valuation, relations): number;   // coins
```

`sale × (my chance if I hold the property − my chance if the rival holds it, having paid twice its list price)`, restated in coins. `sale` is the chance that the holder sells to the rival: the holder's share of received offers accepted, from the ledger (0.5 until three cases), or 1 when the bank holds the property, or when the holder is failing and the rival is its creditor. It is computed in points of chance and restated in coins by what a coin is worth to the seat now (`pointsPerCoin`). The deal sheet of a denying purchase does not show this gain, since the sheet does not know that the rival was about to buy; the score of a denying ask adds it.

### Relations

```ts
export interface Relations {
  tracking: boolean;                                    // set by an agent whose style reads the table; until then only the counts are kept
  deals: Record<string, number>;                        // accepted deals between two seats, key "a|b" with a < b
  refusals: Record<PlayerId, Record<PlayerId, number>>; // offers from the first seat refused by the second
  answers: Record<PlayerId, { received: number; accepted: number }>;
  asks: Record<PlayerId, Record<PropertyId, Ask>>;      // by asker and property: the latest ask, its share and cash, the own turn it was made on,
                                                        // times refused, and the holder's chance and whether it was short of cash then
  chances: Record<PlayerId, number[]>;                  // each seat's chance at the start of the latest eight rounds
  shown: Record<PlayerId, Record<PlayerId, { round: number; points: number }[]>>;  // what the second seat has shown the first (see Signals)
  open: Record<string, number>;                         // offers on the table: the receiver's gain less the proposer's, in points
  round: number;
}
export function createRelations(): Relations;
export function noteRelations(relations: Relations, state: GameState, events: GameEvent[], ctx?: Context, valuation?: Valuation): void;
export function goodwillOf(relations: Relations, to: PlayerId, by: PlayerId, round: number, halfLife: number): number;
export function acceptRate(relations: Relations, seat: PlayerId): number;   // 0.5 until a seat has answered three offers
```

`StyleMemory` gains `relations`. The environment's ledger keeps the same record for the observation. The counts come from the events alone. What an offer showed is read from the position it was made in, at the moment it is proposed, so the record is fed after every action with the state that action left. The parts that read the valuation are kept only once an agent whose style reads the table has set `tracking`, so games among today's agent do not pay for them.

### New fields of a style

```ts
  // Offers (part: offer)
  offerBy: 'list' | 'value';         // 'list'  'value' prices an ask by the deal sheet, not by a multiple of list price
  openShare: number;                 // 0.3     the first ask, as a share of what the property is worth to the seat
  maxShare: number;                  // 0.8     the most it offers, as that share
  raiseStep: number;                 // 0.15    added to the share each time the same ask is refused
  probeGap: number;                  // 3       own turns before a refused ask is made again
  probeDrop: number;                 // 0.05    a fall in the holder's chance since the last ask that renews it at once
  earlyOffers: boolean;              // false   asks for streets of groups it holds part of, not only for a last street
  earlyBefore: number;               // 20      the round after which early asks stop
  earlyNeed: number;                 // 0       the least chance of getting the rest of the group for an early ask
  denyOffers: boolean;               // false   buys what the strongest rival wants
  denyThreat: number;                // 1.3     the rival's `potential` from which it acts
  denyShare: number;                 // 0.8     the most it pays, as a share of `denialWorth`
  denyRank: number;                  // 4       acts only while ranked at or above this place
  estateOffers: 'off' | 'self' | 'both';   // 'off'   buys from a failing rival: what it wants, or also what the strongest rival wants
  failBelow: number;                 // 0.4     a rival is failing below this chance over an even share
  rescue: boolean;                   // false   pays a failing rival enough to meet its largest due when the creditor is the strongest rival
  debtOffers: boolean;               // false   offers for a rival's property at the moment that rival cannot pay a debt
  debtSales: boolean;                // false   in a debt it cannot cover, offers its own property to a seat other than the creditor
  courtAllies: boolean;              // false   sends invitations: offers that favour a seat it wants as a partner
  giftEdge: number;                  // 2       points by which an invitation favours the receiver
  allyAt: number;                    // 3       goodwill each way from which two seats are allied
  allyTurns: number;                 // 4       rounds an invitation waits for an answer, and the rounds in which goodwill halves

  // Answers (part: answer)
  answerBy: 'factors' | 'sheet';     // 'factors'
  acceptEdge: number;                // 0       points a deal's score must reach
  againstLeader: number;             // 0       the strongest rival's gain counts against a deal by this weight
  forWeak: number;                   // 0       the gain of a partner ranked below both the seat and the strongest rival counts for it
  reciprocity: number;               // 0       the weight of a partner's goodwill in a deal's score: how far it reads signals

  // Building (part: build)
  huntFailing: boolean;              // false   builds first where a failing rival is about to land
```

With every field at its default the agent is today's agent, and the equivalence test of M2 must still pass. The twenty-eight are listed in `TABLE_FIELDS`. A style stored before they existed (the sixty-two found styles of M3) lacks them; `completeStyle` gives it the baseline's value for each, so that it plays as it did when it was admitted.

**The score of a deal,** for the seat that weighs it, in points of chance by the sheet:

```text
score = Δ(me) − againstLeader · Δ(strongest rival) + forWeak · Δ(partner, if it ranks below me and below the strongest rival)
        + reciprocity · (the partner's goodwill toward me), bounded at ±5
```

A seat using `answerBy: 'sheet'` accepts when the score is at least `acceptEdge`. A seat using `offerBy: 'value'` sends, of its candidate asks, the one with the highest score at the price its ladder gives, and none when no score is above zero. Ranks are by the valuation, never by who is a person and who is a program, so the same position gets the same treatment whoever sits in it.

This one rule covers what a player calls alliances. Behind and with `againstLeader` set, a seat takes less from another trailing seat (the deal costs the leader) and asks more of the leader or refuses it. Ranked third, it favours the seat ranked second. Ahead and with `forWeak` set, it gives a weak seat good terms, so that the seat has a stake of its own and less reason to feed the nearest challenger. No promise is made and none could be kept: the alliance lasts as long as the position that made it.

### How far to go against a leader

Decided by the author on 18 November 2026: there is no setting for how hard a seat works against a leader, and none for a leader who is a person. A seat goes exactly as far as serves its own chance of winning, and no further. So `againstLeader`, `forWeak`, `denyShare` and `reciprocity` are not matters of taste. Each is set where the seat's own win share is highest at that table size (task 16a), a playbook may vary it with the position, and a learner finds its own level from the result alone. A level that costs the seat games is lowered, however good it looks as politics.

### Signals: asking for an alliance without a word

Decided by the author on the same day: nothing is added to the game for players to talk with. A seat that wants a partner says so with its offers, as a bridge player signals with the cards played, and the design has two halves: sending such a signal, and reading one. The rules require both sides of an offer to hand something over, so every signal is a real deal.

| Signal | Its form, as a legal offer | Read as |
| --- | --- | --- |
| Invitation | An offer that favours the receiver: by the sheet the receiver gains at least `giftEdge` points more than the proposer, the proposer does not lose, and the strongest rival of both is a third seat. In order of preference: a swap that advances a group for each; a street the receiver needs, for its list price; a generous price for a street the receiver has no use for. | "Work with me against that seat." |
| Agreement | The receiver accepts, and within `allyTurns` rounds sends back an offer that is even by the sheet or favours the first seat. | "Agreed." |
| No | The receiver refuses; or accepts and sends nothing back in that time; or answers with an offer in its own favour. | Taking what is offered commits it to nothing. |
| Standing | Each later deal between the two that is even or better for the other. | "Still on." |
| Break | Refusing an even offer from the partner; buying to deny the partner; a deal that hands the strongest rival more than `giftEdge` points. | "Over." |

**Goodwill** is how a signal is read. `goodwillOf(relations, a, b, round, allyTurns)` is what seat b has shown seat a, each offer counting for at most 5 points either way: the sum, over b's offers to a, of a's gain less b's gain by the sheet, in points, counted in full for an offer that a accepted and by half for one it refused; less 2 for each offer of a's, even or better for b, that b refused; less 5 for each purchase by which b denied a. It halves every `allyTurns` rounds. Two seats are **allied** while each one's goodwill toward the other is at least `allyAt` and neither is the other's strongest rival.

**Sending** (`courtAllies`), at most once a round. Behind (`gap` below 0), the seat invites the trailing seat with whom it has the best deal against the strongest rival. Ahead (`gap` at least 0.3), it invites the seat ranked last, before the others have reason to combine. To an ally it offers at least half of what the property is worth to it, not `openShare`, and it makes no denying purchase against one. Before either, it answers a seat that has shown it goodwill and had nothing back, with an offer that is at least even.

**Reading** (`reciprocity` above 0). Goodwill enters the score of every deal with that seat, so a seat that has been favoured gives better terms back, and an ally's even offers are accepted. A person's offers are read by the same rule: a person who offers a computer seat a favourable deal while a third seat leads is read as inviting it, and a person offered such a deal is being invited.

Every step is still weighed by the seat's own score. An invitation is accepted only if the receiver does not lose by it, and an alliance ends the moment the partner becomes the seat's strongest rival. What a signal can buy is bounded (±5 points in the score), so that a seat cannot farm a reader with small favours; the False friend below is the test of that.

### At a rival's debt

The rules allow a trade to be proposed by any player whenever no decision is open, not only on its own turn; and while a debt is open they allow trades that involve the debtor ([rules.md](../rules.md#trades)). No agent uses either rule: every agent, and the environment, acts only when the engine awaits it. So today a seat that cannot pay goes to its creditor with everything it holds, although any seat could have bought its property at that moment, and the debtor could have sold to stay in. Buying long before the bankruptcy (estates, above) is one answer to finding S17. This is the other.

**The debt window.** When a debt opens that the debtor's cash does not cover, each other seat still in whose style has `debtOffers`, in the order of play and leaving out the creditor, is asked once whether it proposes to the debtor, before the debtor acts. The debtor answers each offer as it answers any. Then the debtor acts as today. Seats without the field are not asked, so games among today's agent are unchanged, draw for draw. In the environment the ruled seats are asked, and for a learner's seat the school that proposes on its behalf.

| Field | Rule |
| --- | --- |
| `debtOffers` | At the window, asks the debtor for its unmortgaged property, on a group without buildings, that is worth most to the seat; with `estateOffers: 'both'`, for the one the creditor would gain most by, when that is worth more to stop. Priced by value, never below list price. |
| `debtSales` | In a debt that selling buildings and mortgaging would not cover, or would cover only by mortgaging a complete group, the debtor offers its most valuable property outside its complete groups to the seat, other than the creditor, to which it is worth most by the sheet, for at least the shortfall and never below list price. |

### What each new decision does

| Decision | Rule |
| --- | --- |
| **Pricing an ask by value** | With `offerBy: 'value'`, the cash offered is a share of what the property is worth to the seat in a deal with that holder: the most it can hand the holder without losing by the sheet (`worthInCoins` with the holder as payee); `denialWorth` for a denying ask. The share starts at `openShare`, rises by `raiseStep` each time that ask is refused, and stops at `maxShare`. Capped at the cash above the reserve. |
| **Asking again** | A refused ask is made again after `probeGap` own turns, at the raised share. It is made again at once, at the same share, when the holder has become `short` or the holder's chance has fallen by `probeDrop` since the last ask. |
| **Early asks** | With `earlyOffers`, before round `earlyBefore`, the candidates include every unmortgaged street of a group in which the seat holds at least one street and lacks more than one, held by a rival, on a group with no buildings. An early ask needs the chance of getting the rest to be at least `earlyNeed`: the product, over the streets still missing afterwards, of one over the seats still in for a street the bank holds, and of the holder's share of received offers accepted for one a rival holds (0 if that rival has refused the seat twice for a street of the group). |
| **Denying** | With `denyOffers`, while ranked at or above `denyRank`: when the strongest rival's `potential` is at least `denyThreat` and the property it `wants` is held by a third seat, asks that seat for it, paying up to `denyShare` of `denialWorth`. In an auction for such a property the bid cap is the larger of today's cap and that figure. |
| **Estates** | With `estateOffers`, asks a failing rival for the unmortgaged property, on a group without buildings, that is worth most to the seat, when that worth is at least its list price; with `'both'`, also for the one the strongest rival `wants` when its `denialWorth` is larger. Priced by value, and never below list price. |
| **Rescue** | With `rescue`, when a failing rival's `creditor` is the seat's strongest rival, an estate offer is raised to cover that rival's largest due within reach, if the cap allows. The cash keeps the estate out of the creditor's hands for longer; it is the creditor's in the end, and the price counts that. |
| **Answering by the sheet** | With `answerBy: 'sheet'`, refuses anything in `neverSell`, then accepts when the score is at least `acceptEdge`. `completionPenalty` and `acceptMargin` are not read. |
| **Inviting, reading, the debt window** | As in the three sections above. |
| **Hunting** | With `huntFailing`, when a failing rival stands 2 to 12 squares before a street of one of the seat's complete groups, that group is built first and building there may pass the target as if `buildBeyond` were 0. |

### Signals

Four more, for playbooks and for M8's conductor, which brings the list to twenty-five.

| Signal | Value |
| --- | --- |
| `threat` | The strongest rival's `potential`. |
| `gap` | The seat's chance less the strongest rival's, both over an even share. |
| `failing` | 1 when some rival is failing. |
| `shunned` | The share refused of the seat's latest six offers. 0.5 until there are six. |

### The new schools

Each of the first twelve is the baseline with one behaviour, so that the behaviour can be measured alone. Sources: A is the author's account of 18 November 2026; P is this plan; L is published strategy (the references of ai.md).

| School | Settings | Sizes | Source |
| --- | --- | --- | --- |
| Early bird | `valuation: 'v1'`, `offerBy: 'value'`, `earlyOffers: true`. | 3, 4 | A |
| Prober | Early bird with `openShare: 0.2`, `raiseStep: 0.1`, `probeGap: 2`. | 3, 4 | A |
| Warden | `valuation: 'v1'`, `offerBy: 'value'`, `denyOffers: true`, `denyShare: 1`. | all | A |
| Undertaker | `valuation: 'v1'`, `offerBy: 'value'`, `estateOffers: 'self'`. | 3, 4 | A |
| Broker | `estateOffers: 'both'`, `rescue: true`, otherwise as Undertaker. | 3, 4 | A, P |
| Balancer | `valuation: 'v1'`, `answerBy: 'sheet'`, `offerBy: 'value'`, `againstLeader: 1`. | 3, 4 | A |
| Patron | As Balancer with `againstLeader: 0.5`, `forWeak: 0.5`. | 3, 4 | A, L |
| Grudger | `answerBy: 'sheet'`, `reciprocity: 1`. | all | P, L |
| Hunter | `huntFailing: true`, `mortgageToBuild: true`. | 3, 4 | P |
| Envoy | As Balancer with `courtAllies: true`, `reciprocity: 1`. It sends invitations and reads them. | 3, 4 | A |
| Scavenger | `valuation: 'v1'`, `offerBy: 'value'`, `debtOffers: true`. | all | P |
| Debtor | `debtSales: true`. | all | P |
| False friend | `courtAllies: true` with `reciprocity: 0` and answers by factors: it invites, takes what comes back and returns nothing. A test opponent, not a school to play. | 3, 4 | P |
| Statesman | Composed: offers from Prober with `denyOffers`, `estateOffers: 'both'`, `courtAllies`, `debtOffers` and `debtSales`; answers from Patron with `reciprocity: 1`; building from Hunter; the rest from Sky rush, which holds the style line at four players. At three players a found style holds the line, and the search of task 17 starts from both. | 3, 4 | P |
| Reference II | The Reference preset of M2 with the author's trading as told: `offerBy: 'value'`, `earlyOffers`, `denyOffers` with `denyShare: 1`, `estateOffers: 'both'`, `answerBy: 'sheet'`, `againstLeader: 0.5`, `forWeak: 0.5`, `courtAllies`, `reciprocity: 1`, `debtOffers`. | all | A |

**The Statesman as a playbook.** A second form of the Statesman changes with the state of the table, after the four states of Walker and Lehman (1975). Its base is the Statesman above with `againstLeader` and `forWeak` at 0; its rules, in order, each held for two own turns:

| Rule | When | Sets |
| --- | --- | --- |
| nobody ahead | `threat` < 1.3 and `gap` ≥ −0.3 | Early asks only: `denyOffers: false`. |
| a rival ahead | `threat` ≥ 1.3 and `gap` < 0 | `againstLeader: 1`, `denyOffers: true`, `estateOffers: 'both'`, `rescue: true`. |
| ahead | `gap` ≥ 0.3 | `forWeak: 0.5`, `againstLeader: 0.5`, `huntFailing: true`. |
| ahead and worked against | `gap` ≥ 0.3 and `shunned` ≥ 0.67 | `forWeak: 1`, `maxShare: 1`: it pays more for the few deals it can still make. |

Both forms are measured. Whether the playbook beats the fixed form is the question M3 asked of every playbook, asked again here.

The Reference preset of M2 is kept as it is, for the record of M2's runs. It holds only the outline of the author's play and wins about an even share or less; Reference II is the fuller account.

### Measures of table politics

For the odd player of a table and an ordinary player of the same table, the study adds:

| Measure | Definition |
| --- | --- |
| Early deals | Accepted asks after which the proposer still lacks at least one street of the group, per game, and their mean round. |
| Denying deals | Accepted asks for a property the strongest rival `wants`, per game. |
| Estate deals | Property, by list price, bought from seats that went bankrupt within ten rounds, per game; and the share of all such seats' property that left by sale before the bankruptcy. |
| Price by kind | Cash paid over list price for early, completing, denying and estate purchases. |
| Asks per purchase | Offers made for a property before it was sold to the seat. |
| Partner rank | The share of its accepted deals made with the seat ranked first, and with the seat ranked last, at the time. |
| Who paid | The mean change, by the sheet, of the seat ranked first among those outside its deals. |
| Creditor share | The share of the table's bankruptcies in which it was the creditor. |
| Invitations | Sent per game; the share answered with an agreement; alliances formed per game and how many rounds each lasted; the share of its deals made with a seat allied at the time. |
| At a debt | Offers made at a rival's debt per game and the share accepted; for its own debts, the share of those its cash did not cover that did not end in bankruptcy. |

The watch (`src/sim/politics.ts`) reads these for any seat, whatever its style. To it an invitation is an offer that favours the receiver by 2 points by the sheet, without costing the proposer or helping the proposer's strongest rival; an agreement is an offer back, within four rounds, that is even or better for the seat that invited; and an alliance lasts from the agreement to the last deal between the two. By that reading today's agent sends an invitation now and then without meaning one, which is why a school is compared with the baseline and not with zero.

For a table as a whole, in `scripts/table.ts` and in the league's mixed tables:

| Measure | Definition | Among today's agent |
| --- | --- | --- |
| Leader conversion | How often the seat ranked first by the valuation at round 10, and at round 20, wins. | 67.3% and 76.3%, 58.8% and 70.9%, 56.8% and 70.5% with two, three and four players (M1) |
| Changes of lead | Times the seat ranked first changes, per game. | To be measured in task 12 |
| Estates to the leader | The share of bankrupt seats' property, by list price, that went to the seat ranked first before the bankruptcy. | To be measured in task 12 |
| Estates sold | The share of indebted seats' property, by list price, sold at a debt window and so kept from the creditor. | None: no agent offers at a debt |
| Finished | The share of games that end within the turn limit. | Above 99% |

Leader conversion is the stage's measure of whether a table plays politics: where trailing seats work against the leader, it falls.

### The probe: changes of hands

`scripts/probe-hands.ts` extends M1's intervention study from gifts by the bank to deals between seats. A cell is a kind of deal, the set, the round and the table size; each position is played on with the deal and without it, 8 times each, with today's agent at every seat, and each seat's win share is compared. Positions come from the test games of M1's snapshots.

| Kind | Deals | Cells |
| --- | --- | --- |
| Second street | The seat holds one street of the group and buys a second from a rival that holds one, at 1, 1.5 and 2 times list. The third street is with the bank, or with a third seat. | Chain Stratagem, House of Yuan, Cao Wei, Shu Han; rounds 5, 10, 20; three and four players |
| Denial | The seat buys, from a third seat, the street a rival lacks, at 1 and 2 times list. Split by the buyer's rank among the rival's opponents: nearest, middle, last. | The same sets; rounds 10 and 20; three and four players; at two players by the one opponent |
| Estate | The seat buys a failing seat's most valuable unbuilt street at list price: one it wants itself, and one the strongest rival wants. | Rounds 10 and 20; three and four players |

The report gives, for each cell, the measured change for the buyer, the seller, and the strongest of the others, each with its interval, beside the deal sheet's figure for the same positions.

### The environment

**Layout version 3,** 1,023 numbers. Built here and not in M9 so that M5's decision sets, which have to be written again for the new teachers, are written once.

| Block | Change | Numbers |
| --- | --- | ---: |
| Relations | New. Accepted deals between each pair of seats, over 5 (6 pairs). For each rival: my offers it refused, over 10; its offers I refused, over 10; the highest multiple of list price it refused from me, over 4; turns since my last offer to it, over 20; its goodwill toward me and mine toward it, over 10. | 6 + 3 × 6 = 24 |
| Risk | Was 2 numbers for the seat that decides. Now, for each relative seat: the largest rent or tax it could owe on its next roll; the amount expected; the rent it expects from the others' next rolls. | 4 × 3 = 12 |
| Deal sheet | New. Under an offer or a draft, the change in each relative seat's chance by the sheet; zeros otherwise. | 4 |

985 − 2 + 24 + 12 + 4 = 1,023. M9's four numbers then make version 4.

**Potential `threatDenial`.** Over the groups in which the seat holds exactly one street and one rival holds every other: that rival's chance by the valuation, summed, capped at 1. It is the `denial` potential weighted by whom it stops. Thirteen potentials in all.

## Tasks

1. **`dealSheet`.** *Check:* the changes sum to zero within 1e-9; a street for one coin raises the receiver and lowers the giver (the rules do not allow an offer with an empty side); renaming the seats permutes the sheet and changes nothing else; the state after the deal passes `checkInvariants`.
2. **`threatOf`, `distressOf`, `denialWorth`.** *Check:* on hand-built positions: a seat one street short with cash to build has `potential` above `now`; a seat with everything mortgaged and cash below its dues is failing and names its creditor; `denialWorth` is zero when the holder has refused every offer it received.
3. **`relations.ts`,** wired into `observe` and the environment's ledger. *Check:* over whole games at three and four players the counts equal a tally of the event list and no offer is left open; an ask refused twice shows `refused: 2` and its last share; without `tracking` nothing that reads the valuation is kept.
4. **The new fields:** type, defaults, validation, parts. *Check:* the default style validates; every new field is in exactly one part; `node scripts/check-style.ts --equivalence --games 1000` still finds every decision equal to today's agent.
5. **Pricing by value and asking again.** *Check:* on a hand-built position the first ask is `openShare` of the worth; after a refusal the next is `raiseStep` higher and comes no sooner than `probeGap` own turns later; it comes at once when the holder's cash is set below its dues; it never passes `maxShare`.
6. **Early asks.** *Check:* holding one street of three with a rival holding another, the seat asks for it before round `earlyBefore` and not after; with `earlyNeed: 0.5` it does not ask when the third street's holder has refused it twice; the baseline never makes such an ask.
7. **Denying,** in offers and in bids. *Check:* with a rival one street short and that street in a third seat's hands, the seat asks for it; ranked below `denyRank` it does not; its bid cap for such a property is at least `denyShare` of `denialWorth`.
8. **Estates and rescue.** *Check:* the seat asks a failing rival for the street worth most to it and never offers under list price; with `'both'` it asks for the street the strongest rival wants when that is worth more; with `rescue` the cash offered covers the rival's largest due when the cap allows, and only when the creditor is the strongest rival.
9. **Answering by the sheet,** with `againstLeader`, `forWeak` and `reciprocity`. *Check:* one offer is accepted from the seat ranked last and refused from the seat ranked first; a swap that completes a group for each of two trailing seats is accepted at a lower price than the same swap with the leader; with `reciprocity: 1` a seat whose goodwill is −4 is asked four points more.
9a. **Goodwill and signals:** sending with `courtAllies`, reading with `reciprocity`. *Check:* on a hand-built position a trailing seat offers the seat ranked third a street it needs at list price and sends the leader nothing; the receiver's goodwill rises by the sheet's difference; after an agreement in return the two are allied; after a denying purchase against it the alliance is off; every invitation is an offer the engine accepts.
10. **Hunting.** *Check:* with a failing rival seven squares before the group, that group is built before one with a better return; with no failing rival the order is today's.
10a. **The debt window,** in the simulator, the study and the environment's ruled seats, with `debtOffers` and `debtSales`. *Check:* with no seat using either field, 300 games at each size are the same, action for action, as games played without the window; with a rival in a debt it cannot pay, a seat with `debtOffers` offers for its best street before the debtor acts, and the creditor is not asked; a debtor with `debtSales` sells and stays in where today's agent goes bankrupt.
11. **Signals and presets.** *Check:* the four signals do not change when seats are renamed; all fifteen presets and the playbook validate; `node scripts/check-style.ts --presets 3` plays each at each of its sizes with no refused action and no broken invariant.
12. **The measures:** the study's table for the odd player, `scripts/table.ts`, and the league report's lines. *Check:* at a table of today's agent, leader conversion reproduces M1's figures within their intervals; the baseline shows no early deal; the shares by partner rank add to 1; changes of lead and estates to the leader are written into the table above.
13. **The probe.** *Check:* a street for one coin shows a clear gain for the receiver; every cell prints its count of positions, and a cell with fewer than 30 is marked thin; gate 1's table is printed.
14. **Run the study** with each new school as the odd player, 2,000 games at each of its sizes, the baseline's tables as the control. *Check:* every table finishes at least 99% of its games; `node scripts/check-style.ts --gate` prints the behaviour bars of the gate.
15. **What each is worth.** Paired games on evaluation seeds, as in the table under Experiments. *Check:* each difference is printed with its interval and written into Result, whichever way it fell.
16. **Tables of two.** The tables under Experiments, at three and four players. *Check:* each table's shares, leader conversion and finished share are written into Result.
16a. **How far to go.** `againstLeader` at 0, 0.5, 1 and 2 with `forWeak` at 0, 0.5 and 1, each as one seat among baselines and as two seats at the named tables, 2,000 games, at three and four players. *Check:* the table of the seat's own win share by setting, with intervals; the level with the highest share at each size is written into the presets; if no level beats 0 by its interval, 0 is chosen and that is said.
16b. **Signals at the table.** Two Envoys against two Balancers in the same seats; an Envoy beside a False friend against a Balancer beside one. *Check:* invitations sent, the share answered, alliances formed and their length; the pair's share against the two Balancers on the same seeds; and the Envoy beside a False friend wins no less than the Balancer there by more than its interval.
17. **Search again** with the new fields in the genome, at three and four players, from M3's archives; admission on fresh seeds; a promotion match for the best. *Check:* the log gives each generation's best on the list it was chosen on and on the next; every admitted entry validates; the match is recorded in `assets/lines.json`, won or lost.
18. **Layout version 3 and `threatDenial`.** *Check:* M4's tests pass with the total pinned at 1,023; the observation is unchanged by the deck order, the generator and the dice queue, and by renaming the players; `threatDenial` lies in 0 to 1 over 300 games; a model that records version 2 is refused by the learned agent.
19. **Hand over.** The teachers of M5, the conductor's schools in M8 and the offer suite of M9 take the schools and the kinds of deal that passed. *Check:* each of the three stage files names what it took, by school and by figure.
20. **Write up.** *Check:* every figure quoted in the documents can be found in a report under the data directory, the Result section names the command, seeds and commit, and the link check passes.

## Tests

- The deal sheet, as in task 1.
- Relations rebuilt from events, as in task 3.
- Each new behaviour on a hand-built position, as in tasks 5 to 10, and each absent at its default.
- **Blind to who sits where:** for every new school, a position with the player ids permuted yields the permuted action.
- The equivalence test of M2, with every new field at its default.
- The environment's tests of M4 at the new size.

## Experiments and cost

The rates are those measured on 18 November 2026 on a shared machine, about a third of the plans' first figures. In a crash test a seat with every field on played at about 0.1 s a game on one core, four to five times a game among today's agent. A school that reads the deal sheet computes the valuation for every candidate ask, so each run is timed on its first 200 games before it is sized; the times below are guesses until then.

| Run | Size | Seeds | Time, on six processes |
| --- | --- | --- | --- |
| The probe | About 250 cells × 50 positions × 2 versions × 8 playouts, 200,000 part-games | The test games of M1's snapshots | About 45 minutes |
| The study, fifteen schools and the playbook | 2,000 games at each of a school's sizes | The study's | 3 to 4 hours |
| Worth, against the base without the field | 5,000 paired games: Early bird and Statesman at three and four players. 2,000 paired games: every other school at each of its sizes. | From 1,100,000 | About 3 hours |
| Worth, where nobody sells cheaply | Early bird, Warden, Undertaker, Balancer and Statesman as the one among refusers, and as the one among copies of the holder of the style line: 2,000 games each | From 1,110,000 | About 2 hours |
| Tables of two, four players | The holder of `style-4`, the baseline and two Balancers, against the same with two baselines in their place; the same with Statesman; the holder and three Balancers. 5,000 games each, the same seeds across tables. | From 1,120,000 | About 2 hours |
| Tables of two, three players | The holder of `style-3` and two Balancers, against the holder and two baselines; the same with Statesman. 5,000 games each. | From 1,130,000 | About an hour |
| Signals, three and four players | Two Envoys against two Balancers, with the holder of the style line (and a baseline at four players); an Envoy beside a False friend against a Balancer beside one. 5,000 games each. | From 1,140,000 | About 3 hours |
| How far to go | Twelve settings, as one seat among baselines and as two seats at the named table, 2,000 games each, at three and four players | From 1,150,000 | About 4 hours |
| The search, two sizes | 10 generations of 24, the best 6 kept, 400 games a score | From 2,050,000; admission from 2,150,000 | About 4 hours |

About two unattended nights in all. Evaluation seeds 1,100,000 to 1,199,999 are this stage's; no earlier stage has used them.

## Commands

```sh
node scripts/probe-hands.ts --snapshots $DATA_DIR/snapshots --json $DATA_DIR/probes/hands.json > $DATA_DIR/probes/hands.md
node scripts/study.ts 2000 --styles early-bird,prober,warden,undertaker,broker,balancer,patron,grudger,hunter,envoy,scavenger,debtor,statesman,statesman-book,reference-2 --json $DATA_DIR/study/politics.json
node scripts/check-style.ts --gate $DATA_DIR/study/politics.json
node scripts/paired.ts --size 4 --a early-bird --b baseline --games 5000 --seeds 1100000
node scripts/paired.ts --size 4 --a early-bird --b baseline --against refuser --games 2000 --seeds 1110000
node scripts/table.ts --seats style-4,baseline,balancer,balancer --games 5000 --seeds 1120000
node scripts/table.ts --seats style-4,baseline,envoy,envoy --games 5000 --seeds 1140000
node scripts/table.ts --seats style-4,baseline,envoy,false-friend --games 5000 --seeds 1140000
node scripts/search-styles.ts --size 4 --politics --generations 10 --out $DATA_DIR/search/politics-4
```

## Gate

1. **The sheet tells the truth.** Over the probe's cells whose measured change for the buyer is clear of its interval, the deal sheet has the same sign in at least nine of ten, and across all cells its figure and the measured one have a rank correlation of at least 0.7.
2. **Each school shows its behaviour,** against the baseline in the same seat, with the interval of the difference excluding zero:

| School | Must show |
| --- | --- |
| Early bird | More early deals per game, at an earlier mean round. |
| Prober | More asks per purchase, and a lower price paid for early purchases than Early bird pays. |
| Warden | More denying deals per game. |
| Undertaker, Broker | A larger share of failing seats' property bought before the bankruptcy; for Broker, some of it what the strongest rival wanted. |
| Balancer | A smaller share of its deals with the seat ranked first, and at least four fifths as many deals per game as the baseline. |
| Patron | A larger share of its deals with the seat ranked last. |
| Grudger | A lower share accepted of offers from seats that have refused it. |
| Hunter | A larger creditor share. |
| Envoy | Invitations sent in most games, and a larger share of its deals with seats allied at the time. |
| Scavenger | More offers at a rival's debt than the baseline makes, and property bought there. |
| Debtor | A smaller share of its uncovered debts end in bankruptcy. |
| Statesman (both forms), Reference II | More early deals, more denying deals and more invitations than the baseline. |
| False friend | More invitations sent than the baseline sends. |

3. **Early buying pays.** At three and at four players, Early bird wins more than the baseline in the same seats over 5,000 paired games, with the interval of the difference above zero. Finding S16 says it should; if it does not, the finding or the pricing is wrong and the decision point below applies.
4. **The rest is recorded, whichever way it fell:** each school's paired difference against its base; each of the five named schools among refusers and among copies of the style line's holder; the tables of two with their leader conversion; the signals tables; and the level chosen in task 16a, at which the presets are then set.
5. **Nothing is broken:** the equivalence test, the blindness test, `npm test` and `npm run typecheck` pass; every table of the stage finishes at least 98% of its games.
6. **The environment** passes M4's tests at layout version 3.
7. **Reading is safe.** An Envoy seated beside a False friend wins no less than a Balancer in the same seat, by more than its interval: a seat that reads signals cannot be farmed by one that sends them and returns nothing.
8. **The style lines have been challenged:** the best school or found style of this stage has played its promotion match at three and four players, and the result is recorded.

Bars 3 and 4 are split on purpose. One behaviour has evidence behind it and is held to a result. The others are the author's and the plan's hypotheses, and the stage is done when they are measured, not when they win.

## Decision points

- **The sheet fails gate 1.** Read which kind of cell it gets wrong. If it overstates second streets where the third is with a seat that does not sell, set `earlyNeed` from the probe and keep the sheet. If it misprices denial, price denying asks from the probe's table by set, round and size in place of `denialWorth`, and record that V1 needs features for what a rival is about to gain (a matter for M1's next fit).
- **Early bird beats the baseline and loses among refusers.** Then it lives on the cheap seller of finding S5. Keep the school, write down what it exploits, and raise `earlyNeed` until its result among refusers is no worse than the baseline's there.
- **Early bird does not beat the baseline** (gate 3 fails). Check the price first: the measured worth of a second street falls from about 30 points at round 5 to about 7 at round 20, so an ask priced on the round-5 figure at round 15 overpays. Lower `earlyBefore`, then `maxShare`. If it still fails, the gap between a gift from the bank and a purchase from a rival is the finding, and S16 is restated.
- **Warden loses at three and four players.** The arithmetic expects it for a seat that is not a contender. Set `denyRank: 2` and measure again. The author's own habit stays in Reference II either way: a reference is recorded as it is played (R1).
- **Two Balancers do no better than two baselines.** Try `againstLeader` at 2 and three Balancers at four players. If the leader's conversion still does not fall, working against the leader does not pay among these agents; that is recorded, and the question passes to M8, where a learner can find when it pays.
- **Invitations go unanswered** (alliances formed near none). Try `giftEdge` at 1 and at 4: too small and an invitation cannot be told from an ordinary offer, too large and it costs too much to send. If readers still refuse because their own score is negative, the positions do not support alliances among these agents, and that is the finding.
- **A False friend gains from a reader** (gate 7 fails). Lower the bound on goodwill in the score from 5 points to 2, and count an invitation that was accepted and not returned within `allyTurns` rounds against the sender's goodwill.
- **The debt window stops bankruptcies and games run long.** A debtor may sell at one window in three rounds; if the finished share is still under 98%, `debtSales` is kept for schools and left out of the presets offered to a player.
- **Political schools stop games from ending** (finished share under 98%). Refusing the leader is refusing trade, and finding S7 says what that does. Lower `againstLeader` until the share recovers, and record the level.
- **A school floods the table with asks.** Raise `probeGap`; the person's check of M10 has the last word on how many offers are too many.
- **Two seats of one school pass property back and forth.** Refuse any deal whose score is negative for both sides by the sheet, and add the case to the tests.

## Feeds back into

- [ai.md](../ai.md): findings S16 to S19 restated with what was measured; requirement R11's check; workstream K; the reference style's table; the open questions on what a rival's missing street is worth and on how hard computer players should work against a person.
- [statistics.md](../statistics.md): a section on table politics, with the probe's table and the measures for every new school.
- [m05-supervised.md](m05-supervised.md): the teachers. [m08-league-training.md](m08-league-training.md): the conductor's schools, the league's tables and the thirteenth potential. [m09-trading.md](m09-trading.md): the suite's templates and the layout's version. [m10-in-the-client.md](m10-in-the-client.md): the person's check.
- [m02-schools.md](m02-schools.md): the list of fields and the note on the Reference preset.

## Out of scope

- **Speech, promises and side payments.** The rules have offers and answers and nothing else, and by the author's decision nothing is added: an alliance is asked for and answered with offers.
- **Offers out of turn, other than at a rival's debt.** The rules allow them at any time. Agents keep to their own turns, and to the debt window, until this stage has shown what the window is worth.
- **Deals among three seats.** The engine trades between two.
- **Hiding a lead.** Holding back so as not to look like the leader matters only at a table that works against leaders. It is designed once this stage has shown such a table exists: if leader conversion falls by 5 points or more at the tables of two, a field for it is specified and measured the same way.
- **Learned politics.** A learner meets these schools in M8 and makes its own offers in M9.

## Result

Designed on 18 November 2026; built the same day; run on the night of 18 to 19 November with the data disk, from the working tree on top of commit `ee8a9e1` (the uncommitted code saved first as `$DATA_DIR/code/2026-11-18-working-tree.patch` and `2026-11-18-untracked.tar`). The machine was shared by four queues, so times say nothing about the code's speed. Reports are under `$DATA_DIR`; the night's account is in [log.md](log.md#18-to-19-november-overnight-with-the-disk).

**The gate, as it stands.** Bars still waiting on runs are marked so.

| Bar | State | Figures |
| --- | --- | --- |
| 1. The sheet tells the truth | **Passed** | Of 136 cells whose measured change for the buyer is clear of its interval, the sheet's sign is right in 131 (96.3%, bar 90%); rank correlation 0.865 over 274 usable cells (bar 0.7). `probes/hands.md`, 13,595 positions. |
| 2. Each school shows its behaviour | **Passed by means; two bars not clear by interval** | 16 of 16 bars pass by their means (`study/m3b-gate.md`, 2,000 games a table, seeds from 1). Not clear by any interval: Debtor's survived debts, 80.5% against 80.2%; the price half of Prober's bar, 1.30 against 1.35 times list. `check-style.ts --gate` compares means only, where the bar asks for intervals: a fault of the check, not fixed. |
| 3. Early buying pays | **Met by a changed school** | As first specified Early bird failed: −2.8 points at three players, +0.1 at four (5,000 paired games, seeds from 1,100,000). The cause was in the pricing, not the early asks (below). With today's price for the last street (`completeBy: 'list'`) and early asks before round 5, it wins **+2.4 (0.5 to 4.3)** at three players and **+9.7 (7.9 to 11.4)** at four, 5,000 paired games. Kept as the preset `early-bird-2`. |
| 4. The rest is recorded | **Partly** | Recorded: every school against the baseline; the bases; the five named schools among copies of the style holders; Early bird among refusers. Also recorded: six value-pricing schools run again with `completeBy: 'list'`; Warden with `denyRank: 2` (+0.1 and +2.1, no better than at any rank); the seven tables of two; the eight signals tables, and two more for the decision point on unanswered invitations. Waiting: the other schools among refusers (1,000 games, cut from 2,000 because games among refusers seldom end), and the settings of task 16a (7 of its 48 tables made with the fixed Balancer when the runs stopped on 19 November at 15:31; the rest wait in `$DATA_DIR/queue/resume.sh`). The tables of two, the signals tables and task 16a are run with the fixed forms of Balancer, Envoy and the Statesman; eleven runs of 16a made with the flawed Balancer are kept as a record. |
| 5. Nothing is broken | **Code passes; one kind of table does not finish** | The equivalence check, run again on 19 November after `completeBy` was added, finds 2,035,760 decisions identical to today's agent (`checks/equivalence-2026-11-19.txt`); the blindness tests, `npm test` and `npm run typecheck` pass. Every table of the study finishes at least 98.95% of its games. Tables in which one seat sits among copies of found-4-b2t1p1c2 (Sky rush, as the search filed it) or among refusers do not: 1,457 to 1,479 of 2,000 at four players with the baseline or Early bird as the odd seat, 1,725 to 1,733 at three among refusers. The opponents stall those games, not the school measured, but the bar as written is not met for them. |
| 6. The environment at layout version 3 | **Passed** | M4's tests pass with the total pinned at 1,023. A fault in the Python model's reading of the table size (offsets 36 to 38 for 37 to 39) was found and fixed; see [m05-supervised.md](m05-supervised.md). |
| 7. Reading is safe | **Met at three players; not met at four** as specified, met narrowly with `giftEdge: 1` | Three players, 5,000 games from seed 1,140,000: the fixed Envoy beside a False friend wins 27.1%, the fixed Balancer in the same seat 27.0%, +0.0 (−1.7 to 1.8); the False friend +1.3 (−0.1 to 2.7). Four players, beside a False friend, at seeds from 1,140,000, 5,000 games: the fixed Envoy wins 23.8%, the fixed Balancer in the same seat 26.1%, −2.3 points (−4.0 to −0.6, treating the tables as independent: `table.ts` keeps no result by game). The False friend itself gains only +0.4 (−1.2 to 2.0); the baseline in seat 2 gains +1.7. The Envoy loses by giving to whoever accepts its invitations, more than by being farmed. By the decision point on unanswered invitations (about 7% answered): with `giftEdge: 1` −1.6 (−3.3 to 0.2), met narrowly; with `giftEdge: 4` −2.6 (−4.3 to −0.9). |
| 8. The style lines challenged | Waiting | The search with the new genome, cut to 6 generations a size: at four players generation 0 is saved (the Statesman best, 35.7%), the rest and three players wait in `$DATA_DIR/queue/resume.sh`, then admission and the promotion match. |

**What each school is worth** against the baseline in the same seats, paired, in points of win share (`paired/`, 2,000 games; Early bird and the Statesman 5,000; seeds from 1,100,000). Two, three, four players where the school plays that size.

| School | Two | Three | Four | With `completeBy: 'list'`: three | Four |
| --- | ---: | ---: | ---: | ---: | ---: |
| Statesman | | +12.6 | +7.2 | | |
| Statesman, playbook | | +10.2 | +7.5 | | |
| Hunter | | +11.4 | +6.7 | | |
| Grudger | +6.4 | +6.9 | +4.7 | | |
| Reference II | +4.4 | +3.3 | −2.4 | | |
| False friend | | +2.1 | 0.0 | | |
| Envoy | | +0.9 | −3.3 | **+7.5** (4.5 to 10.5) | **+3.2** (0.4 to 5.9) |
| Early bird | | −2.8 | +0.1 | **+2.4** (0.5 to 4.3), early asks before round 5 | **+9.7** (7.9 to 11.4) |
| Debtor | 0.0 | 0.0 | 0.0 | | |
| Balancer | | −1.6 | −3.6 | **+5.6** (2.6 to 8.6) | **+5.6** (2.9 to 8.4) |
| Patron | | −1.3 | −4.0 | **+5.6** (2.6 to 8.6) | **+5.6** (2.8 to 8.4) |
| Prober | | −4.9 | −0.9 | Not run | |
| Warden | +0.1 | −7.7 | −5.6 | 0.0 (−3.0 to 3.0) | **+4.0** (1.3 to 6.7) |
| Scavenger | +1.3 | −7.4 | −5.1 | +0.6 (−2.4 to 3.5) | **+3.6** (0.9 to 6.4) |
| Undertaker | | −6.4 | −4.8 | +1.1 (−1.9 to 4.1) | **+4.3** (1.6 to 7.0) |
| Broker | | −6.5 | −4.9 | Not run | |

Every school that prices by value carried the flaw found under bar 3, so its first figure understates it. With today's price for the last street (`paired/<school>_completeBy_list-<size>.txt`, the same seeds) each of the six run again gains 6.5 to 9.6 points, and at four players each beats the baseline by its interval. Six schools in this table answer by the sheet (Balancer, Patron, Envoy, Grudger, the Statesman and Reference II), and answering by the sheet alone is worth about 4 to 6 points (Grudger against its base), so much of their gain is that and not the politics; the tables of two are where the politics is measured.

**Against their own bases,** the same seeds: Hunter against the baseline with `mortgageToBuild` alone, +0.1 and +0.1, so hunting adds nothing and Hunter's strength is mortgaging to build. Grudger against the baseline answering by the sheet, +1.5, +1.1 and +0.4, so reading grudges adds nothing measurable and its strength is answering by the sheet. The playbook Statesman against the fixed one, −0.7 and −0.8. The Statesman against Sky rush, its base, −2.7 and −5.0 as specified, and +0.9 (−1.1 to 2.8) and +0.6 (−1.3 to 2.5) with the fix: level. **Reference II against the Reference, +6.1, +5.4 and +2.6, each interval above zero**: the author's trading, as told, improves his style at every size. With the fix, +4.3 (1.2 to 7.4), +3.8 (0.8 to 6.7) and +3.7 (1.1 to 6.2): above zero at every size either way.

**The flaw found under bar 3.** Pricing by value alone, without early asks, loses 5.7 points at three players and 6.9 at four; Early bird's early asks gain back +3.0 and +7.0 on top of it. A seat pricing by value asked for the last street of a group at about a third of what it was worth to the seat, where today's agent offers 1.7 to 2.2 times list, and so lost the completions that win games. The new field `completeBy` (`'value'`, the default, or `'list'`) keeps today's price for the street that completes a group. The decision point's own remedies, a later cut-off and a lower `maxShare`, did not help (round 10: −3.1 and +0.6; `maxShare` lowered: −5.1 and +0.1; with `earlyNeed: 0.3` as well: −5.0 and −4.8). The cut-off for early asks, once the price was fixed: three players +0.3 (round 20), +1.2 (12), +1.9 (8), +2.4 (5); four players +7.9 (20), +11.0 (8), +9.7 (5).

**Tables of two** (`tables/two-*`, 5,000 games; four players from seed 1,120,000, three from 1,130,000; the fixed Balancer and Statesman). Win shares; "the pair" is the two seats that hold the school, or the baselines in the control.

| Table | Holder | The pair | Leader at round 10 / 20 won | Finished |
| --- | ---: | ---: | --- | ---: |
| Four players: holder, three baselines (control) | 37.7% | 41.5% (seats 3, 4) | 53.1% / 71.2% | 99.8% |
| Holder, baseline, two Balancers | 34.2% | 46.7% | 48.8% / 65.8% | 96.7% |
| Holder, baseline, two Statesmen | 25.5% | 55.5% | 48.7% / 70.2% | 99.6% |
| Holder, three Balancers | 34.0% | 66.0% (all three) | 47.7% / 64.7% | 93.7% |
| Three players: holder, two baselines (control) | 57.2% | 42.8% | 55.3% / 69.1% | 100% |
| Holder, two Balancers | 65.7% | 34.3% | 56.4% / 69.8% | 98.8% |
| Holder, two Statesmen | 38.7% | 61.3% | 47.5% / 68.6% | 100% |

At four players two Balancers take 5.2 points from the table and cut the leader's conversion at round 20 by 5.4 points, past the 5 points at which "Hiding a lead" (Out of scope) is to be specified; a third Balancer adds nothing for them and the games run longer. At three players two Balancers do clearly worse than two baselines, 8.5 points, against this holder, and the leader's conversion does not move: the decision point on two Balancers applies there. The Statesmen's large gains at both sizes are mostly their strength as players (Sky rush's building and mortgaging to build), not politics.

**Signals, four players** (`tables/signals-4-*`, 5,000 games from seed 1,140,000). Two fixed Envoys win 46.5% together against 46.8% for two fixed Balancers in the same seats: level. They send 4.4 to 5.6 invitations a game; about a quarter are accepted and about 8% of those answered in kind; an alliance lasts about 7 rounds. The holder falls from 35.1% to 31.1% and the baseline in seat 2 rises from 18.1% to 22.4%, so the invitations move points from the leader to the seat that accepts them, not to the sender. **Three players** (`tables/signals-3-*`): two fixed Envoys win 40.4% together against 34.6% for two fixed Balancers (+5.8), and the holder falls from 65.5% to 59.7%. With the holder usually the strongest rival, an invitation there nearly always goes to the other Envoy, so the gift stays in the pair; 59% to 69% of invitations are accepted and about 16% answered in kind. Signals pay at three players and not at four, where a seat outside the pair takes the gift.

**Where nobody sells cheaply.** As the one among copies of the style holders, 2,000 games, seeds from 1,110,000, win share of finished games at three and four players: the baseline 19.8% and 11.0%; Early bird 24.7% and 33.4%; Warden 23.1% and 29.9%; Undertaker 23.0% and 28.3%; Balancer 26.1% and 41.8%; the Statesman 36.6% and 45.4%. Every difference with the baseline is above zero by its interval. Among today's agent, which sells cheaply (finding S5), the political schools mostly lose; among strong opponents that do not, they win by 3 to 34 points. The baseline's four-player tables finished 1,479 games against 1,848 to 1,983 for the others, so the comparison carries some bias in which games count. Among refusers Early bird drew: −1.4 and +0.2.

**Built,** on 18 November 2026 with the data disk away, so with tests and no runs: every task that is code (1 to 12, 9a, 10a, 13's script, 17's genome, 18).

| Task | State |
| --- | --- |
| 1, 2. The deal sheet; threat, distress, denial | `src/sim/deal.ts`, 9 tests. `applyDeal` agrees with the engine on a deal played through it. |
| 3. Relations | `src/sim/relations.ts`, 5 tests; in the style agent's memory and in the environment's ledger. |
| 4. The fields | Twenty-eight, with defaults, ranges and parts. Stored styles are completed with the baseline's values. |
| 5 to 10, 9a. The behaviours | In `src/sim/style-agent.ts`, 15 tests on hand-built positions. |
| 10a. The debt window | `src/sim/window.ts`, called from the study, the league's tables, the search, the preset check, `scripts/table.ts` and the environment; 5 tests, one of which confirms that the engine lets a third seat deal with a debtor and pays the creditor. |
| 11. Signals and presets | Twenty-five signals; fifteen presets and the playbook. Each plays 3 games at each of its sizes with no refused action and no broken invariant. |
| 12. The measures | `src/sim/politics.ts` and `scripts/table.ts`, 6 tests; in the study's report and tallies, the gate of `check-style.ts`, and the league report's mixed tables. |
| 13. The probe | `scripts/probe-hands.ts`, 4 tests of how it finds its cases and reads its results. Not run: the snapshots are on the disk. |
| 17. The genome | The table fields and signals behind `--politics`, 1 test. A search made before them repeats draw for draw. |
| 18. Layout version 3 and `threatDenial` | 1,023 numbers and thirteen potentials, 5 tests; the Python side reads the new record of 2,092 bytes and refuses a set of another size. |

*Checks:* `npm run typecheck` passes for both projects; `npm test` runs 245 tests and `python -m unittest` 21, all passing; the equivalence check at the full count finds 2,035,760 decisions identical between the baseline style and today's agent, the same count as M2's gate; all 53 presets finish 3 games at each of their sizes.

**Not done:** every run. The gate has not been read. Tasks 14 to 16b and the runs of 13 and 17 wait for the disk, in the order of [log.md](log.md#runs-waiting-for-the-disk). A smoke run of the study, 100 games a table for five schools, was made only to see the new report and the gate print; its figures are not results and are not kept.

**What differs from the specification above,** each for a reason found while building:

- A purchase from a seat is priced by cash that goes to that seat (see "Paying a rival is not paying the bank"). The first version priced it as if the cash left the game, and a test showed the buyer losing by its own deal.
- In a position that is already decided, with one seat above 95%, no deal moves any seat by a point, so no invitation and no denial clears its bar. The behaviours show only while a game is contested.
- With everything on at two players a seat sent about twenty offers a game and had nearly all refused: the flooding the decision points expect. `probeGap` is to be set from the runs.
- The probe is a script of its own. The Statesman's base is Sky rush at both sizes. Patron's bar is its share of deals with the seat ranked last.
