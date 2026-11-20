# M2. Schools of play

## Purpose

To turn the rule-based agent's frozen settings into data, so that a way of playing is a value that can be named, measured, searched and handed to a learner as an opponent. It answers requirements R1 and R2 of [ai.md](../ai.md): no single style is the target, and the system must hold several distinct, competent schools. It acts on findings S5, S8, S9, S10 and S11: the price of the last street, which sets to buy, how far to build, what passes are worth and how to bid all become parameters, each with its own value for each table size.

The stage ends with thirty-seven named schools that demonstrably play differently. Eleven were in the first draft of this plan; twenty-three were added after a survey of published strategy, listed under Sources; three more show how schools combine. Whether any of them is strong is the next stage's question.

A school is not a cage. A good player takes the buying habits of one school and the trading habits of another, and changes both when the table changes. So this stage also makes schools into ingredients: a style is cut into parts that can be taken from different schools, two styles can be blended, and a playbook of rules swaps parts in and out as the position changes, looked at again at every decision. That is requirement R10.

## Deliverables

| File | Contents |
| --- | --- |
| `src/sim/style.ts` | The `Style` type, its defaults, validation, and how overrides by table size and by mode are merged. |
| `src/sim/style-agent.ts` | `chooseStyledAction`, `StyleMemory`, `observe`. |
| `src/sim/parts.ts` | The parts of a style; `compose` and `blend`. |
| `src/sim/signals.ts` | The numbers that describe a position to a playbook. |
| `src/sim/playbook.ts` | The `Playbook` type and how its rules are applied at each decision. |
| `src/sim/styles.ts` | The named presets: styles, composed styles and playbooks. |
| `scripts/study.ts` | The odd player of a table can be any preset: `--styles name,name`. Behaviour descriptors in the report. `--explain <seed>` prints which rules were on at each decision of a game. |
| `scripts/check-style.ts` | Runs the equivalence test at its full count, outside `npm test`. |
| `test/style-agent.test.ts` | Equivalence with today's agent; one test for each new behaviour. |

`src/sim/heuristic-agent.ts` is not touched. The client keeps calling it until M10.

## Specification

### The agent

```ts
export function chooseStyledAction(
  engine: Engine,
  state: GameState,
  actor: PlayerId,
  random: () => number,
  style: Style,
  memory: StyleMemory,
): Action | null;

export interface StyleMemory {
  proposedOn: Record<PlayerId, number>;    // as today
  answers: boolean[];                      // the table's latest answers to offers, newest last
  refused: Record<string, number>;         // offer key -> the turn it was last refused
}
export function createStyleMemory(): StyleMemory;
/** Feeds the events of an applied action to the memory. Callers do this after every apply. */
export function observe(memory: StyleMemory, events: GameEvent[]): void;
```

Today's agent sees only the state. A style that reads the table's mood must also see what happened, so whoever drives the game (the simulator, the study, the environment, the client) passes each action's events to `observe`.

### The style

Every constant in `heuristic-agent.ts` becomes a field, with today's value as its default. `SetId` is a group id, `'passes'` or `'works'`.

```ts
export interface Style {
  name: string;

  // What a property is worth to the seat
  valuation: 'factors' | 'v1';            // 'factors'
  partFactor: number;                     // 1.3   holds part of the group
  completeFactor: number;                 // 2.2   the property completes the group
  passStep: number;                       // 0.25  for each other pass held
  worksStep: number;                      // 0.3   if the other works is held
  prefer: Partial<Record<SetId, number>>; // {}    a multiplier on the valuation by factors, for a set

  // Cash kept in hand
  reserve: number;                        // 150
  reserveBuilt: number;                   // 300   once any rival has a building
  reserveThreat: number;                  // 0     plus this share of the largest rent within one roll

  // Buying on landing
  buy: Record<SetId, number>;             // 1 for every set
  buyKeep: number;                        // 0.5   of the reserve must be left
  mortgageToBuy: boolean;                 // false mortgages idle property to afford a purchase
  declinePoor: number | null;             // null  declines when no rival holds this multiple of the price in cash

  // Property auctions
  bidCap: Record<SetId, number>;          // 0.85  of the seat's own valuation
  bidCeiling: Partial<Record<SetId, number>>;  // none; an absolute ceiling in coins
  blockBonus: number;                     // 1.294 (today: 110% against 85%)
  bidKeep: number;                        // 0.333 of the reserve must be left
  bidStep: number;                        // 12    raises by the minimum plus 0 to bidStep - 1
  driveUp: number;                        // 0     on a property it does not want, bids up to this share of
                                          //       what it reckons the keenest rival will pay

  // Building
  buildTarget: 1 | 2 | 3 | 4 | 5;         // 5
  buildBeyond: number | null;             // 0     spare cash needed to build past the target; null is never
  buildOrder: 'gain' | 'landing';         // 'gain'
  buildSpread: 'even' | 'one';            // 'even' 'one' takes one group to the target before the next
  buildNear: number | null;               // null  builds on a group only while a rival stands within
                                          //       this many squares before one of its streets
  mortgageToBuild: boolean;               // false
  holdHouses: boolean;                    // false
  buildingBid: number;                    // 1.15  of the building's cost, in a building auction

  // Mortgages and jail
  redeemSpare: number;                    // 0.5   of a salary, above the reserve, before redeeming
  jailStay: number;                       // 0.667 share of property owned before staying in jail
  jailStayBuilt: boolean;                 // false also stays once any rival has a group at three or more

  // Trading
  proposeRate: number;                    // 1     chance of proposing on a turn where it could
  offerLow: number;                       // 1.7   cash offered for a missing street, times its list price
  offerHigh: number;                      // 2.2
  offerFloor: number;                     // 1.3   below this it does not offer at all
  swaps: boolean;                         // false
  acceptMargin: number;                   // 1.1   Infinity never accepts
  completionPenalty: number;              // 0.8   extra asked for the street that completes the proposer's group
  neverSell: SetId[];                     // []
  leaveCash: number | null;               // null
  sellOffers: boolean;                    // false offers its own property for cash
  distressOffers: boolean;                // false offers cash at or under list price to a rival in debt
  shunLeader: boolean;                    // false makes and takes no deal with the seat ranked first
  giveUpBelow: number | null;             // null  below this chance of winning, sells out to the weakest rival

  // Reading the table
  moodWindow: number;                     // 0     offers watched; 0 never changes mode
  moodFloor: number;                      // 0     acceptance rate below which the table "does not trade"
  blockMode: Partial<Style> | null;       // null  overrides applied while the table does not trade

  // By stage of its own game
  afterFirstGroup: Partial<Style> | null; // null  overrides once its first group stands at the build target

  // By table size
  bySize: Partial<Record<2 | 3 | 4, Partial<Style>>>;   // {}
}
```

`resolve(playbook, signals, memory): Style` gives the style in force at this decision; the next section says how. A plain style is a playbook with no rules, and its `bySize`, `afterFirstGroup` and `blockMode` fields are shorthand for three rules. Every decision reads the resolved style.

Ten of these fields are new behaviour that today's agent does not have: `mortgageToBuy`, `declinePoor`, `driveUp`, `buildSpread`, `buildNear`, `jailStayBuilt`, `sellOffers`, `distressOffers`, `shunLeader` with `giveUpBelow`, and `afterFirstGroup`. Each exists because a school below cannot be written without it.

**Added after this stage.** [M3b](m03b-table-politics.md) specifies twenty-two more fields, for table politics: asks priced by value and made again, asks for a second street, denying, estates, answers by the deal sheet, and hunting. With each at its default the agent is still today's agent. The Reference preset below holds only the outline of the author's play, as it was told on 17 November 2026; his trading, told on 18 November, is in M3b's Reference II, and the Reference preset is kept unchanged as the record of this stage's runs.

### Mixing schools, and playing the position

**Parts.** Every field of a style belongs to exactly one of seven parts.

| Part | Fields |
| --- | --- |
| `value` | `valuation`, `partFactor`, `completeFactor`, `passStep`, `worksStep`, `prefer` |
| `buy` | `buy`, `buyKeep`, `mortgageToBuy`, `declinePoor` |
| `bid` | `bidCap`, `bidCeiling`, `blockBonus`, `bidKeep`, `bidStep`, `driveUp`, `buildingBid` |
| `build` | `buildTarget`, `buildBeyond`, `buildOrder`, `buildSpread`, `buildNear`, `mortgageToBuild`, `holdHouses` |
| `cash` | `reserve`, `reserveBuilt`, `reserveThreat`, `redeemSpare`, `jailStay`, `jailStayBuilt` |
| `offer` | `proposeRate`, `offerLow`, `offerHigh`, `offerFloor`, `swaps`, `sellOffers`, `distressOffers`, `leaveCash`, `giveUpBelow` |
| `answer` | `acceptMargin`, `completionPenalty`, `neverSell`, `shunLeader` |

```ts
export type Part = 'value' | 'buy' | 'bid' | 'build' | 'cash' | 'offer' | 'answer';
export const PARTS: Record<Part, (keyof Style)[]>;

/** A style that takes each named part from the style given for it, and the rest from `base`. */
export function compose(base: Style, parts: Partial<Record<Part, Style>>): Style;

/** A style between two: t = 0 is a, t = 1 is b. */
export function blend(a: Style, b: Style, t: number): Style;
```

`blend` moves every number in a straight line, set by set where a field has a value for each set. A switch, a choice of two or a `null` is taken from the nearer style. `neverSell` is the union once t reaches one half.

**Signals.** What a playbook can look at. Each is one number for the seat that decides, computed from the position, the valuation of M1 and the agent's memory.

| Signal | Value |
| --- | --- |
| `tableSize` | Seats at the start: 2, 3 or 4. |
| `players` | Seats still in. |
| `round` | Rounds played. |
| `owned` | The share of the 28 properties that anyone owns. |
| `chance` | The seat's chance of winning by the valuation, over an even share among those still in. 1 is level. |
| `rank` | Its place by that chance. 1 is the best. |
| `leader` | The highest rival's chance, over an even share. |
| `rentShare` | Its share of the table's rent roll within reach. |
| `groups` | Complete groups it holds. |
| `unbuilt` | Of those, how many stand below its build target. |
| `nearSets` | Groups in which it lacks one street. |
| `needs` | Of those, how many have that street in a rival's hands. |
| `wanted` | Sets in which it holds the one property a rival lacks. |
| `passes` | Passes it holds. |
| `spare` | Spare cash, over the starting cash. |
| `danger` | The largest rent it could owe on its next roll, over its cash. |
| `rivalLevel` | The highest building level on any rival's street. |
| `rivalNear` | 1 when a rival stands 2 to 12 squares before a street of one of its complete groups. |
| `rivalPoor` | 1 when some rival's cash is below the largest rent that rival could owe on its next roll. |
| `bankHouses` | Farmsteads left in the bank. |
| `mood` | The share accepted of the table's latest `moodWindow` offers. 0.5 until the window is full. |

Most are the measures of standing of M1 under another name. `signalsOf(ctx, state, seat, memory, valuation): Signals` computes all twenty-one.

**Playbooks.**

```ts
export interface Rule {
  name: string;
  when: { signal: keyof Signals; is: '<' | '>=' | '='; value: number }[];   // all must hold
  take?: { part: Part; from: string }[];    // parts taken from named schools
  set?: Partial<Style>;                     // and single fields set outright
  hold: number;                             // stays on for this many of the seat's own turns after it last held
}
export interface Playbook {
  name: string;
  base: Style;
  rules: Rule[];
}
```

At every decision the agent computes the signals and walks the rules in order. A rule is on when all its conditions hold now, or held within its last `hold` own turns. The style in force is the base with every rule that is on applied over it in order, so a later rule wins where two touch the same field. `hold` keeps a plan from flickering when a signal hovers at a threshold. The memory records, for each rule, the turn it last held.

The three shorthand fields become rules: `bySize[n]` is `when tableSize = n`; `afterFirstGroup` is `when groups >= 1 and unbuilt < 1`; `blockMode` is `when mood < moodFloor`, held for `moodWindow` turns.

Nothing here is random and nothing is hidden: for any decision the agent can say which rules were on and which school each part came from. The study prints it, and the client can show it.

### What each decision does

Where a rule is not stated it is today's rule with the field in place of the constant.

| Decision | Rule |
| --- | --- |
| **Valuing a property** | With `factors`: list price times `completeFactor`, `partFactor` or 1, or for a pass or works 1 plus the step for each other one held; less the cost of redeeming if mortgaged. With `v1`: `priceOf` from M1, for the state in which the seat holds the property. |
| **The reserve** | `reserveBuilt` if any rival has a building, else `reserve`; plus `reserveThreat` times the largest rent or tax the seat could owe on its next roll. |
| **Buying on landing** | Buys when the seat's valuation times `buy[set]` is at least the price, and either the property completes the seat's group or denies a rival theirs, or `buyKeep` of the reserve would be left. With `buy[set]` at 1 this is today's rule. At 0.8 a seat buys only where it already holds part of the group; at 0.5 only what completes one; at 0 never. |
| **Bidding on property** | Up to the least of: the valuation times `bidCap[set]`, times `blockBonus` if the property would complete a rival's group; `bidCeiling[set]` if there is one; and its cash less `bidKeep` of the reserve. Raises by the minimum plus a random 0 to `bidStep` − 1. |
| **Building** | Candidates are the legal builds. A street is skipped while its group stands at `buildTarget` or above and another complete group of the seat stands below it. Order: by extra rent per coin (`gain`), or by that figure times the street's landing rate (`landing`). Up to the target a build needs the reserve left over; past it, the reserve plus `buildBeyond`, or never. With `holdHouses`, no fortress is built while the bank holds fewer than eight farmsteads, since a fortress hands four back. |
| **Mortgaging to build** | On its own free turn, if a complete, unmortgaged group stands below the target and the cash above the reserve does not cover a building there: mortgage the property outside its complete groups that it values least, provided the cash that all such mortgages would raise covers at least one building. While any of its groups is below the target the seat does not redeem, so that it cannot mortgage and redeem in turn. |
| **Redeeming** | The most valuable mortgage first, when the reserve plus `redeemSpare` of a salary would be left. |
| **Building auction** | Up to `buildingBid` times the building's cost, on the street where rent grows most, keeping half the reserve. |
| **Jail** | Leaves at once (a card, or bail if the reserve would be left) while less than `jailStay` of the property is owned. After that it stays and rolls. |
| **Proposing** | With chance `proposeRate`, once on its own turn after rolling. For a group in which it lacks one street held by a rival, unmortgaged: offers cash between `offerLow` and `offerHigh` times the list price, capped at its cash above the reserve, and not at all below `offerFloor`. With `swaps`, if that rival lacks one street of some group and the seat holds it, offers that street instead, with cash added on either side to even out the two valuations. An offer refused this turn or last is not repeated. |
| **Leaving the partner short** | With `leaveCash` set, in a deal that completes a group for the partner: the seat asks for enough cash that the partner is left with no more than `leaveCash` buildings' worth on that group. If the partner would not accept by the seat's estimate of their margin, the offer is not made. |
| **Answering** | Refuses anything that takes a property of a set in `neverSell`. Otherwise accepts when what it receives is worth at least `acceptMargin` times what it gives, counting `completionPenalty` times the list price against a street that completes the proposer's group. |
| **The mood of the table** | `observe` appends true or false to `answers` for every offer accepted or rejected at the table, keeping the latest `moodWindow`. The table "does not trade" when the window is full and the share accepted is below `moodFloor`. |
| **Mortgaging to buy** | With `mortgageToBuy`, a purchase at list price that the cash floor would forbid is made after mortgaging the properties outside its complete groups that it values least, as few as cover it. Never to buy a property it values below its price. |
| **Declining to force an auction** | With `declinePoor` set to m, the seat declines a property that does not complete its group when no rival holds m times the price in cash, and then bids as usual. It expects to take it for less. |
| **Driving a price up** | With `driveUp` above 0, in an auction for a property it would not bid on, the seat keeps raising by the minimum while the bid is below `driveUp` times the keenest rival's limit. That limit is reckoned as the rival's cash or the rival's valuation by factors times 0.85, whichever is less, for the rival still bidding who holds most of the set. It stops at once when no such rival is left in the auction. |
| **One group at a time** | With `buildSpread: 'one'`, builds only on the complete group that already has the most buildings until it stands at the target, then the next. |
| **Building near** | With `buildNear` set to k, a build needs a rival standing 2 to k squares before a street of that group. Otherwise the cash is held. |
| **Jail, once rivals have built** | With `jailStayBuilt`, stays and rolls as soon as any rival has a group at three buildings or more, whatever share of the property is owned. |
| **Selling** | With `sellOffers`, once on its own turn, offers a property outside its complete groups to the rival who holds most of that set, for the rival's valuation by factors times `offerHigh`, capped at the rival's cash. Never a property in `neverSell`. With `leaveCash` set, only when the price leaves the rival short of that many buildings. |
| **Distress offers** | With `distressOffers`, when a rival is in debt or holds less cash than the largest rent it could owe on its next roll, offers that rival cash between 0.6 and 1.0 times the list price for a property it wants. |
| **The leader** | With `shunLeader`, at a table of three or four, makes no offer to the seat with the highest chance by the valuation and refuses that seat's offers, unless it is that seat. |
| **Giving up** | With `giveUpBelow` set, at a table of three or four, once its own chance by the valuation is below that figure, it offers its properties one a turn to the rival with the lowest chance, at list price. |
| **In debt, receiving a mortgage, the jail roll** | As today. |

### The named schools

Thirty-seven presets in six families. Each is the baseline with the changes listed. The values are first guesses, there to produce a recognisable behaviour; M3 searches for better ones, and a preset that turns out weak is still a kind of opponent. "From" says where the idea comes from: P is this plan, A the author's style, and S1 to S4 the sources listed below.

**What to buy**

| School | Changes from the baseline | Sizes | From |
| --- | --- | --- | --- |
| Baseline | None. It buys whatever it can afford. | all | P |
| Cheap side | `buy` and `bidCap` 0 for Shu Han, Eastern Wu, Conquest of Shu and House of Sima. | all | S1 |
| Dear side | `buy` and `bidCap` 0 for Han Court, Chain Stratagem, House of Yuan and Cao Wei. | all | S1 |
| Warm sides | `prefer` 1.4 for House of Yuan, Cao Wei, Shu Han and Eastern Wu, the two sides landed on most; `buy` 0.8 elsewhere. | all | A, S3 |
| Sniper | `buy` 0.5 for every group, so that it buys only what completes a group or blocks one; `buy.passes: 1`; `buy.works: 0`. | all | S4 |
| Prestige | `prefer` 1.5 for the passes and 1.6 for House of Sima; `buy.works: 0.5`. | all | S2 |
| Orange and sky | `prefer` 1.3 for the passes and 1.5 for Cao Wei and Chain Stratagem. The strongest fixed agent of S2. | all | S2 |
| Pass baron | `buy.passes: 1`, `bidCap.passes: 2.5`, `neverSell: ['passes']`; `buy` 0.8 for every group; `buildTarget: 3`. | all | P, S1 |
| Land-grabber | `mortgageToBuy: true`, `buyKeep: 0`, `reserve: 50`. It buys everything and mortgages to keep buying. | all | P |

**How to build**

| School | Changes from the baseline | Sizes | From |
| --- | --- | --- | --- |
| Three and hold | `buildTarget: 3`, `buildBeyond: null`, `reserveThreat: 1`. | all | P, S1, S4 |
| Rusher | `buy` 1 for the four cheap groups and 0.5 for the rest; `mortgageToBuild: true`; `reserve: 50`, `reserveBuilt: 100`. | all | P |
| All in | `reserve: 0`, `reserveBuilt: 0`, `mortgageToBuild: true`, `jailStay: 0.5`. No spare cash, ever. The best of the eight agents of S1. | all | S1 |
| Slumlord | `buy` 1 for Han Court and Chain Stratagem and 0.5 elsewhere; `completeFactor: 3`; `mortgageToBuild: true`. | all | S3 |
| Concentrator | `buildSpread: 'one'`, `buildTarget: 4`. | all | S3 |
| Ambusher | `buildNear: 12`, `reserve: 100`. It holds cash until a rival is within one roll, then builds. | all | S3 |
| Cornerer | `holdHouses: true`, `buildTarget: 4`. | all | P, S3 |

**How much cash to keep**

| School | Changes from the baseline | Sizes | From |
| --- | --- | --- | --- |
| Hoarder | `reserve: 400`, `reserveBuilt: 600`, `buy` 0.8 for every set, `bidCap` 1.1 for every set. | all | P, S1 |
| Turtle | `reserve: 300`, `reserveBuilt: 500`, `reserveThreat: 1`, `jailStayBuilt: true`, `buildTarget: 3`. | all | S3, S4 |

**How to bid**

| School | Changes from the baseline | Sizes | From |
| --- | --- | --- | --- |
| Shark | `buy` 0.5 for every set, `bidCap` 1.0 for every set, `reserve: 100`. | all | P |
| Driver | `driveUp: 0.8`. It bids rivals up on what they need. | 3, 4 | S3 |
| Vulture | `declinePoor: 1.5`, `distressOffers: true`, `reserve: 300`. It waits for others to run short. | all | S3 |

**How to trade**

| School | Changes from the baseline | Sizes | From |
| --- | --- | --- | --- |
| Refuser | `acceptMargin: Infinity`. It still makes offers. | all | P |
| Hermit | `acceptMargin: Infinity`, `proposeRate: 0`. No deal of any kind. | all | S1 |
| Open hand | `acceptMargin: 0.8`, `completionPenalty: 0`. It takes nearly any offer. A weak opponent on purpose. | all | S1 |
| Blocker | `completionPenalty: 5`, `blockBonus: 2`, `acceptMargin: 1.5`. | all | P |
| Dealer | `swaps: true`, `acceptMargin: 1.0`, `offerLow: 1.5`, `offerHigh: 2.5`. | all | P, S3 |
| Big spender | `offerLow: 2.5`, `offerHigh: 3.5`, `completeFactor: 3.5`. It pays up to three times the price for the street that completes a group. | all | S1 |
| Squeezer | `sellOffers: true`, `leaveCash: 1`, `offerHigh: 3`. It sells the last street of a group to a rival who will then be too poor to build on it. | all | A, S3 |
| Icebreaker | `moodWindow: 8`, `moodFloor: 0.15`, `blockMode: { offerLow: 2.5, offerHigh: 3.5, acceptMargin: 0.9 }`. When the table stops trading it pays more, where the reference style digs in. | 3, 4 | S3 |
| Leveller | `shunLeader: true`, `swaps: true`. | 3, 4 | P |
| Kingmaker | `giveUpBelow: 0.05`, `sellOffers: true`. | 3, 4 | S3 |

**Whole plans**

| School | Changes from the baseline | Sizes | From |
| --- | --- | --- | --- |
| Reference | The style of the project's author, below. It reads the table and changes plan. | all | A |
| Two-stage | Before its first built group: `buy` 1 for the four cheap groups and the passes, 0.5 for the dear groups, 0 for the works; `swaps: true`; `buildTarget: 3`. `afterFirstGroup: { prefer: 1.5 for Shu Han, Eastern Wu and House of Sima, buildTarget: 3 }`. A cheap group first, then a dear one paid for by it. | all | S4 |
| Duelist | `bySize[2]: { bidCap: 1.3 for every set, buyKeep: 0, mortgageToBuy: true, acceptMargin: Infinity }`. Finding S11 as a style: with one rival, never let a property go to auction cheaply, and never help the only opponent. | 2 | P |
| Sky rush | Composed: `buy` and `value` from Orange and sky, `build` and `cash` from All in, `answer` from Blocker. | all | P |
| Iron bank | Composed: `buy` from Pass baron, `cash` from Hoarder, `bid` from Vulture, `answer` from Refuser. | all | P |
| Opportunist | A playbook, below. It holds no plan for longer than the position supports it. | all | P |

**The Opportunist.** Its base is the baseline with `valuation: 'v1'` and `buildTarget: 3`. Its rules, in order:

| Rule | When | Then | Hold |
| --- | --- | --- | ---: |
| Opening | `owned < 0.6` | `buy` from Land-grabber | 0 |
| Build out | `unbuilt >= 1` | `build` and `cash` from All in | 2 |
| Under threat | `rivalLevel >= 3` and `danger >= 0.5` | `cash` from Turtle | 2 |
| Frozen table | `mood < 0.15` | `answer` from Blocker, `buy` from Pass baron | 6 |
| One short | `needs >= 1` and `mood >= 0.15` | `offer` from Big spender | 0 |
| Ambush | `rivalNear = 1` and `groups >= 1` | `buildTarget: 5`, `buildBeyond: 0` | 0 |
| Shortage | `bankHouses < 8` and `groups >= 1` | `holdHouses: true` | 4 |
| Ahead | `rank = 1` and `chance >= 1.5` | `answer` from Refuser, `cash` from Hoarder | 3 |
| Behind | `chance < 0.5` and `players >= 3` | `offer` from Dealer, `build` from All in | 3 |
| Heads up | `players = 2` | `answer` from Refuser, `bid` and `buy` from Duelist | 99 |

The thresholds are guesses. M3 searches them, and searches for playbooks nobody wrote.

**Sources.** The numbers each source reports are its own and were not reproduced here.

| | Source | What was taken from it |
| --- | --- | --- |
| S1 | A simulation of eight strategy agents at tables of four, described in a video and read here from a third-party transcript, ["The Best Monopoly Strategy, Tested on 300 Million Games"](https://sozai.app/transcript/monopoly-strategy-tested-300-million-games/index.md). Its figures could not be checked against the original. | The agents All In, Buy Everything, Three Houses, Cheap Side, Expensive Side, Saver, Never Trades and Railroad Baron. It reports All In as the strongest and Railroad Baron as the weakest, that leaving the works alone costs nothing, and that with trading switched off more than half of its games end with no group completed. The last two agree with this project's own study. |
| S2 | T. Bonjour and others, "Decision Making in Monopoly using a Hybrid Deep Reinforcement Learning Approach" ([arXiv:2103.00683](https://arxiv.org/abs/2103.00683)). | Its three fixed agents, which differ only in which properties they put first: all equally; the stations and the dearest pair; the stations, the orange group and the sky-blue group. The third was the strongest against every learned agent. |
| S3 | Wikibooks, ["Monopoly/Strategy"](https://en.wikibooks.org/wiki/Monopoly/Strategy). | A catalogue of tactics: buying at auction when rivals are short of cash, selling the last street of a group to a rival who cannot afford to build, concentrating buildings on one group, building just ahead of an approaching rival, the shortage of houses, leaving jail early and staying late, deciding the winner when one cannot win oneself, and breaking a deadlock with a generous trade. |
| S4 | T. Darling, ["How to Win at Monopoly: a Surefire Strategy"](http://amnesta.net/other/monopoly/). | A staged plan: always the stations, never the utilities, other property only to complete a group or to block one, exactly three houses, a cheap group first and a dear group later. |

Three things in those sources are left out because this game does not have them: hiding one's cash from the table, the choice between a flat tax and a tenth of one's worth, and deals that grant freedom from rent.

**The reference style,** from the table in ai.md:

| Field | Value |
| --- | --- |
| `buy` | 1 for every set except `works: 0` and `conquest: 0`. |
| `bidCeiling` | `han: 250`, `chain: 250`, `yuan: 350`, `wei: 350`, `shu: 400`, `wu: 350`, `sima: 550`, `passes: 450`, `conquest: 0`, `works: 0`. |
| `bidCap` | 3 for every set, so that the ceilings are what binds. |
| `prefer` | `wei: 1.2`, `shu: 1.15`, `yuan: 1.15`, `chain: 1.1`: Cao Wei first, then Shu Han and House of Yuan, then Chain Stratagem. |
| `buildTarget`, `buildBeyond` | 3, and 600. |
| `buildOrder` | `landing`, which already favours the streets that cards send players to. |
| `mortgageToBuild` | `true`. |
| `reserve`, `reserveBuilt`, `reserveThreat` | 200, 200, 0.5. |
| `swaps`, `leaveCash` | `true`, 4. |
| `moodWindow`, `moodFloor` | 8, 0.15. |
| `blockMode` | `bidCeiling.passes: 450` kept; `buy` 1 for the first street of any group and 0.8 after; `acceptMargin: Infinity` for a street that completes the proposer's group (`completionPenalty: 99`); `neverSell: ['passes']`. |
| `bySize` | Empty. The author's account does not differ by table size; the search will. |

### Behaviour descriptors

The study prints, for the odd player of a table and for an ordinary player of the same table:

| Descriptor | Definition |
| --- | --- |
| Building share | Money spent on buildings over all money spent on property and buildings. |
| Trades | Offers made, offers accepted as proposer, offers accepted as receiver, each per game. |
| Passes at round 20 | Mean number held. |
| Cash at round 20 | Mean. |
| Highest level | The share of its built groups whose highest level was 3, 4, a fortress. |
| Auction share | The share of its acquisitions from the bank that were auctions. |
| First building | The mean round of its first building. |
| Mortgages | Taken per game, and the share taken while not in debt. |
| Bank empty | The share of games in which the bank ran out of farmsteads. |
| Changes of plan | For a playbook: rules that came on per game; the share of its own turns spent under each rule; the share of its decisions made with each part from each school. |

These are also the descriptors by which M3 files a style in its archive.

## Tasks

1. **`Style`, defaults, `resolve`, validation.** *Check:* the default style validates; an out-of-range value is rejected with the field's name.
2. **Port today's agent** into `style-agent.ts`, reading every constant from the style. *Check:* the equivalence test.
3. **Memory and `observe`.** Wire `observe` into `simulateGame` and the study. *Check:* a test that a window of answers fills and rolls over.
4. **New behaviours,** one at a time, each behind its field and each with its test: `buy` and `bidCap` by set, `prefer`, `bidCeiling`, `reserveThreat`, `buildTarget` and `buildBeyond`, `buildOrder`, `buildSpread`, `buildNear`, `mortgageToBuild`, `mortgageToBuy`, `holdHouses`, `declinePoor`, `driveUp`, `jailStayBuilt`, `neverSell`, `swaps`, `sellOffers`, `distressOffers`, `leaveCash`, `shunLeader`, `giveUpBelow`, the mood and `blockMode`, `afterFirstGroup`, `bySize`, `valuation: 'v1'`. *Check:* with every new field at its default the equivalence test still passes after each one.
5. **Parts, `compose`, `blend`.** *Check:* every field of `Style` is in exactly one part; `blend(a, b, 0)` equals a and `blend(a, b, 1)` equals b; a composed style validates.
6. **Signals and playbooks.** *Check:* the tests under Tests; a style written with `bySize`, `afterFirstGroup` and `blockMode` plays the same games as the same style written as three rules.
7. **Presets.** *Check:* every preset validates and plays 200 games at each size without a refused action or a broken invariant.
8. **Study.** `--styles`, and the descriptors. *Check:* `--styles baseline` reproduces an even share within its interval.
9. **Run the study** with every preset as the odd player. *Check:* every table finishes at least 99% of its games; the baseline as the odd player wins an even share within its interval; every preset has a row at each of its sizes.
10. **Open the style lines.** The baseline holds `style-2`, `-3` and `-4` in `assets/lines.json`. Challengers are put forward in M3, once the league exists to supply the rule's third test ([README.md](README.md#new-against-best)). *Check:* `assets/lines.json` has the three style lines, each held by `baseline`.
11. **Write up.** *Check:* every figure quoted in the documents can be found in a report under the data directory, the Result section names the command, seeds and commit, and the link check passes.

## Tests

- **Equivalence.** Over 1,000 games at each table size (seeds 1 to 1,000), at every decision both agents are given the same state and random streams at the same position. They must return equal actions, draw the same number of random numbers, and leave equal memories. One difference fails the test and prints the seed, the action number and both actions.
- **No loops.** With `mortgageToBuild`, no state repeats within a turn over 500 games.
- **No runaway bidding.** With `driveUp`, a seat never ends an auction holding a property it valued below the price in more than one auction in ten, over 500 games; the figure is reported.
- **Each behaviour** on a hand-built position: a seat with `buy.works: 0` declines a works; with `bidCeiling.passes: 450` it stops at 450; with `buildTarget: 3` it leaves a group at three while another is below; with `holdHouses` it does not take a fortress when the bank holds five farmsteads; with `neverSell: ['passes']` it refuses any price for a pass; the mood flips after `moodWindow` refusals and flips back.
- **The ten later switches,** each on a hand-built position: with `mortgageToBuy` a seat short of cash mortgages an idle property and buys; with `declinePoor: 1.5` it declines when no rival could pay one and a half times the price, and buys when one could; with `buildSpread: 'one'` the second group gets nothing while the first is below target; with `buildNear: 12` it builds with a rival seven squares before the group and not with the rival just past it; with `jailStayBuilt` it stays in jail once a rival's group is at three; with `sellOffers` it offers an idle street to the rival who holds the rest; with `distressOffers` it offers under list price to a rival in debt; with `shunLeader` it refuses the leader's offer and accepts the same offer from another seat; with `giveUpBelow` it sells to the weakest rival only once its chance is under the figure; with `afterFirstGroup` its preferences change when its first group reaches the target.
- **No loops with `mortgageToBuy`.** A seat never redeems on the turn it mortgaged in order to buy, over 500 games.
- **Parts.** As in task 5.
- **Playbook order.** Two rules that set the same field: the later one wins while both are on, and the earlier one's value returns when the later goes off.
- **Hold.** A rule whose condition held three turns ago is on with `hold: 3` and off with `hold: 2`.
- **Signals.** Each of the twenty-one on a hand-built position, and unchanged when the seats are relabelled.
- **A playbook explains itself.** For any decision, the list of rules that were on and the school each part came from can be printed, and replaying the game gives the same list.
- **Legality.** Every preset, 200 games at each size, under `simulateGame`'s checks.

## Experiments and cost

| Run | Games | Engine time |
| --- | --- | --- |
| Equivalence | 1,000 at each size, each decision made twice | About two minutes of one core. Part of `npm test` only if it stays under 30 seconds at a reduced count; the full count runs from a script. |
| Each preset as the odd player | 20,000 at each size it is meant for, thirty-seven presets | About 20 core-minutes for a preset; about an hour and a half for all on eight processes. A playbook computes the valuation at every decision and costs more; it is timed on 1,000 games first. |

## Gate

1. The baseline preset reproduces today's agent exactly: the equivalence test passes at the full count.
2. Every preset shows the behaviour it is named for, against the baseline in the same seat, with the interval of the difference excluding zero:

| School | Must show |
| --- | --- |
| Refuser | No offer accepted as receiver. |
| Reference | No works and no street of Conquest of Shu bought at list price or at auction; at least 60% of its built groups peak at exactly three. |
| Pass baron | At least 0.5 more passes at round 20. |
| Rusher | Its first building at least one round earlier; more mortgages taken while not in debt. |
| Three and hold | At least 60% of its built groups peak at exactly three. |
| Hoarder | At least half as much cash again at round 20. |
| Blocker | No offer accepted that completes the proposer's group. |
| Dealer | At least half as many accepted trades again. |
| Shark | At least twice the auction share. |
| Cornerer | The bank empty of farmsteads in at least 10 points more games. |
| Cheap side, Dear side | Nothing acquired from the bank on the side it leaves alone. |
| Warm sides, Prestige, Orange and sky | A larger share of its property, by list price, in the sets it prefers. |
| Sniper | At most a third as many purchases at list price. |
| Land-grabber | More properties held at round 10, and more mortgages taken while not in debt. |
| All in | Less than half the cash at round 20; more mortgages taken while not in debt. |
| Slumlord | Han Court or Chain Stratagem at a fortress in more games, and earlier. |
| Concentrator | Of its games with two complete groups, more in which one stands at four while the other has no building. *Replaced on 20 November by the author's decision:* a smaller share of first buildings on a new group made while another buildable group stands below four. |
| Ambusher | A larger share of its buildings bought while a rival stood within twelve squares before the group. |
| Turtle | More turns spent in jail after round 20. |
| Driver | A higher mean price paid by rivals at auctions it bid in and did not win. |
| Vulture | A lower mean price paid at the auctions it wins; at least one distress offer made in most games. |
| Hermit | No offer made and none accepted. |
| Open hand | At least twice the share of received offers accepted. |
| Big spender | A higher mean price paid in its accepted offers. |
| Squeezer | Offers of its own property made; after its sales, the buyer's cash below one building's cost in most cases. |
| Icebreaker | Higher offers in the turns after the table's acceptance rate falls below its floor. |
| Leveller | No deal with the seat ranked first at the time. |
| Kingmaker | Sales at list price to the weakest rival once its own chance is below 5%. |
| Two-stage | Its first complete group on the cheap side in most games; a larger share of its later acquisitions on the dear side. |
| Duelist | No property let go to auction when it could pay; no offer accepted. |
| Sky rush, Iron bank | For each part, the behaviour of the school it was taken from: the row above for that school, restricted to that part's decisions. |
| Opportunist | At least three different rules come on in most games. In the turns after it completes a group, less cash and more mortgages than the baseline. In the turns after the table's acceptance rate falls below 0.15, no accepted offer that completes a proposer's group. |

## Commands

```sh
node scripts/check-style.ts --equivalence --games 1000        # the baseline preset against today's agent
node scripts/study.ts 20000 --styles opportunist,all-in        # presets as the odd player, with descriptors
node scripts/study.ts 2000 --styles opportunist --explain 17   # prints, for seed 17, which rules were on at each decision
```

## Decision points

- **The equivalence test fails on a rare branch.** Fix the port; today's agent is the definition. If the difference exposes a bug in today's agent, record it, keep the behaviour in the baseline preset, and fix it in a new preset.
- **A preset does not show its behaviour.** Change its values until it does. A school that cannot be told from the baseline is not a school.
- **A preset is very weak** (well under an even share). Keep it. It is still a kind of opponent, and M3 will find the strong version of its kind.

## Feeds back into

- [statistics.md](../statistics.md): the table of one odd player gains a row for each preset at each size, and a table of descriptors.
- [ai.md](../ai.md): the baselines table; the reference-style table, whose "not tested" rows (mortgaging to build, leaving the partner short) now have figures.

## Out of scope

- Finding strong styles. That is M3.
- Offering schools in the client. That is M10.
- Offers of more than one property on a side. M9 decides whether a learner needs them.

## Result

Done on 18 November 2026, unattended; the details are in [log.md](log.md).

- **Gate 1 passed.** `node scripts/check-style.ts --games 1000` compared 2,035,760 decisions over 1,000 games at each table size: the baseline style's actions, random draws and remembered proposals equal today's agent's at every one.
- **Gate 2 not met in full.** All 36 schools with a bar are judged, and 33 pass, after three rounds of retuning for the eight that first missed (as the decision points direct). Two miss narrowly after four rounds: Pass baron holds 0.42 more passes at round 20 than the baseline in the same seat (bar 0.5), and All in holds 53% of its cash (bar under half). The last four bars were measured once the study counted them (`presets-four.md`, `presets-conc.md`): Icebreaker offers 1.98 times list once the table goes cold against 1.80 otherwise (the baseline 1.78 and 1.79); Leveller made none of its 12,458 deals with the seat V1 ranked first (the baseline 36.5%); Kingmaker made 3,147 sales at list price to the weakest rival in 2,659 games where its chance fell under 5% (the baseline none). Concentrator misses as written: one group at four with another bare in 87.4% of its games with two complete groups against the baseline's 87.6%, because the baseline also builds its first group to a hotel before it holds a second. A proposed bar that measures the school's idea directly, the share of first buildings on a new group made while another buildable group stands below four, gives 27.4% against 42.9%; it is not counted, and adopting it is the author's decision. **Adopted on 20 November:** the Concentrator is judged by that measure (27.4% against 42.9%; the interval of the difference is to be computed from the saved run). Pass baron and All in get one more round of retuning when the disk is back.
- **Changes made while retuning:** Three and hold mortgages to build; All in mortgages to buy and bids and offers far higher; Cornerer never builds past four; Hoarder keeps 700 and 900; Dealer also sells and makes distress offers; Reference never builds past three (the reference-style table in ai.md had read "build to three" as building on with 600 to spare); Pass baron values passes at twice their price; Vulture bids at most 0.6 of its valuation.
- **Win shares** of every school are in [statistics.md](../statistics.md#the-named-schools). The study was run at 2,000 games a table instead of 20,000, for time.

Commands: `node scripts/study.ts 10000 --only style --styles <names>`; `node scripts/check-style.ts --gate <runs>`. Runs in `$DATA_DIR/study/presets-*.json`; the latest run of each preset gathered in `presets-final.json`. Commits `e0f441c` and the retuning commit after it.
