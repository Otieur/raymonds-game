# Engine

The rules engine lives in `src/`. It has no dependencies and no build step: Node 22.18 or later runs the TypeScript files as they are, and the client imports the same files through Vite.

For what the rules say, see [rules.md](rules.md). This document is about how the engine is put together and how to call it.

## Design

Four properties hold everywhere, and the client, the tests, the simulator and any future training code all rely on them.

- **Pure.** `apply(state, action)` returns a new state and never changes the one it was given. There is no hidden state in the engine object.
- **Plain data.** A game state is JSON: it survives `JSON.stringify` and `structuredClone` unchanged. Boards and rules are data too.
- **Deterministic.** The random number generator's state is part of the game state. The same seed and the same actions give the same game, on any machine.
- **Closed.** The engine says who must act (`awaiting`) and what they may do (`legalActions`). A caller that only ever applies a listed action can never reach an illegal state, and `checkInvariants` can confirm it at any point.

## Modules

| File | Responsibility |
| --- | --- |
| `src/index.ts` | The public surface. Import from here. |
| `src/types.ts` | Boards, rules, state, actions, legal actions, events, errors. |
| `src/rules.ts` | `DEFAULT_RULES` and `SHORT_GAME_RULES`. |
| `src/context.ts` | Validates a board against the rules once and indexes it (squares by id, groups, decks). |
| `src/rng.ts` | The seeded generator, shuffling, and seeds from strings. |
| `src/engine/engine.ts` | `createEngine`, the dispatch of actions, and the settling loop that follows every action. |
| `src/engine/setup.ts` | `newGame`: players, decks, dealt deeds, the opening roll. |
| `src/engine/turn.ts` | Rolling, the opening roll, ending a turn, leaving jail. |
| `src/engine/movement.ts` | Moving, landing, rent, cards, jail. |
| `src/engine/auctions.ts` | Buying, declining, bidding, passing, closing an auction. |
| `src/engine/buildings.ts` | Building, the shortage auction, selling buildings. |
| `src/engine/mortgage.ts` | Mortgaging, redeeming, settling a received mortgage. |
| `src/engine/trade.ts` | Proposing, accepting, rejecting and withdrawing trades. |
| `src/engine/bankruptcy.ts` | Bankruptcy and the end of the game. |
| `src/engine/money.ts` | Transfers, and charges that become debts. |
| `src/engine/queries.ts` | Read-only questions about a state: ownership, rent, net worth, what may be built. |
| `src/engine/validate.ts` | Whether one action is allowed now. |
| `src/engine/legal.ts` | `awaiting` and `legalActions`. |
| `src/engine/invariants.ts` | Consistency checks over a whole state. |
| `src/boards/` | The Three Kingdoms board, and its presentation data (Chinese names, colors, art paths). |
| `src/sim/` | Agents and the simulator. See [ai.md](ai.md). |

## API

```ts
import { createEngine, SHORT_GAME_RULES, threeKingdoms } from './src/index.ts';

const engine = createEngine(threeKingdoms);                    // default rules
const short = createEngine(threeKingdoms, SHORT_GAME_RULES);   // any Partial<RuleConfig>
```

`createEngine` validates the board and the rules together and throws on a malformed pair (duplicate ids, a card square without its deck, a street without six rents, a deck with no card that returns to it, and so on).

| Member | Returns |
| --- | --- |
| `engine.board`, `engine.rules` | The board and the merged rules. |
| `engine.newGame(options)` | A fresh state. |
| `engine.awaiting(state)` | The ids of the players the game is waiting on. Empty once the game is over. |
| `engine.legalActions(state, player)` | Everything that player may do now. |
| `engine.validate(state, action)` | `null` if the action is allowed, otherwise a `RuleError`. |
| `engine.apply(state, action)` | `{ ok: true, state, events }` or `{ ok: false, error }`. |
| `engine.checkInvariants(state)` | A list of problems. Empty for a sound state. |
| `engine.netWorth(state, player)` | Cash plus properties and buildings, as [the rules](rules.md#net-worth) count them. |
| `engine.standings(state)` | The players still in, richest first. |

### Starting a game

```ts
engine.newGame({
  players: ['wei', 'shu', { id: 'wu', name: 'Wu' }],  // ids, or ids with display names
  seed: 7,                                            // number or string; random if omitted
  startingPlayer: 'shu',                              // optional
});
```

- Without `startingPlayer`, the game opens in the `order` phase and every player must roll for the order of play.
- With `startingPlayer`, the opening roll is skipped: that player starts and the rest follow in the order given. The tests use this to start from a known position.

## State

`GameState` (in `src/types.ts`) is the whole game.

| Field | Contents |
| --- | --- |
| `schema` | The state format, currently `1`. |
| `board` | The id of the board the state belongs to. |
| `players` | One entry per player, **in the order of play**: `id`, `name`, `cash`, `position` (0 to 39), `inJail`, `jailRolls`, `jailCards`, `bankrupt`. |
| `properties` | By property id: `owner` (a player id or `null`), `mortgaged`, `level`. |
| `bank` | Buildings left in the bank: `houses`, `hotels`. |
| `decks` | By deck id, the card ids from top to bottom. |
| `turn` | `player`, `number`, `phase`, `doubles`, `lastRoll`. |
| `opening` | The opening roll in progress: `round`, `groups`, `rolls`. `null` once play has begun. |
| `pending` | A stack of open decisions. The last entry is the one being decided. |
| `auctionQueue` | Properties waiting to be auctioned after a bankruptcy to the bank. |
| `rng` | The generator's state. |
| `diceQueue` | Dice to use before the generator is consulted. Empty in play; tests fill it to force rolls. |
| `winner` | The winner's id, or `null` while the game goes on. |

A street's `level` is its number of houses, or `HOTEL_LEVEL` (5) for a hotel, so `rents[level]` is always the rent to charge. This holds in the short game too, where a hotel follows three houses: the level jumps from 3 to 5.

**Hidden information.** A state contains things a player at the table could not know: the order of both decks, the generator's state and any queued dice. Code that plays on a player's behalf must not read `decks`, `rng` or `diceQueue`. The current agents do not.

## Whose move it is

Three things decide what can happen next, in this order of precedence:

1. `winner` is set: nothing.
2. `pending` is not empty: the top entry.
3. Otherwise `turn.phase`.

### Phases

| Phase | Meaning | Who acts |
| --- | --- | --- |
| `order` | The opening roll. | `turn.player` throws. Nothing else is allowed. |
| `preRoll` | The turn player has a roll left. | `turn.player`: roll, or deal with jail first. |
| `postRoll` | No roll left. | `turn.player`: end the turn. |

### Pending decisions

| `kind` | Opened when | Who acts | Closed by |
| --- | --- | --- | --- |
| `buy` | A player lands on an unowned property. | That player. | `BUY`, or `DECLINE` (which opens an `auction`). |
| `auction` | A purchase is declined, or a bankrupt player's property is sold. | Every bidder except the high bidder. | The last `PASS`. |
| `buildingAuction` | A `BUILD` meets a shortage. | Every bidder except the high bidder. | The last `PASS`. |
| `debt` | A payment exceeds the payer's cash. | The debtor. | Automatically, as soon as the debtor's cash covers it; or `DECLARE_BANKRUPTCY`. |
| `mortgageTransfer` | A player receives a mortgaged property. | That player. | `SETTLE_TRANSFER`. |
| `jailExit` | A third jail roll fails and the player holds a card. | That player. | `PAY_BAIL` or `USE_JAIL_CARD`. |
| `trade` | `PROPOSE_TRADE`. | The player the offer is made to. | `ACCEPT_TRADE`, `REJECT_TRADE`, or `CANCEL_TRADE` by the proposer. |

Decisions nest. A player who cannot afford the interest on a property received in a trade gets a `debt` on top of the `mortgageTransfer` that caused it, and the debt is settled first.

`awaiting(state)` can return several players: in an auction every bidder but the leader may act, in any order.

### Settling

After every action the engine runs a loop until nothing more can happen without a player:

- it skips a turn player who has gone bankrupt;
- it starts the next queued auction;
- it pays a debt the moment the debtor can afford it, and resumes whatever the debt interrupted;
- it closes an auction that has run its course.

A single `apply` can therefore produce a long list of events: a roll, a move, a card, a second move, a rent payment.

## Actions

All actions are `{ type, player, ... }`.

| Action | Extra fields | When |
| --- | --- | --- |
| `ROLL` | | Phase `order` or `preRoll`, no decision open, your turn. |
| `END_TURN` | | Phase `postRoll`, no decision open, your turn. |
| `PAY_BAIL`, `USE_JAIL_CARD` | | In jail before rolling, or to answer a `jailExit`. |
| `BUY`, `DECLINE` | | Top decision is your `buy`. |
| `BID` | `amount`, and `property` in a building auction | You are a bidder and do not hold the high bid. |
| `PASS` | | As `BID`. Final for that auction. |
| `BUILD` | `property` | No decision open. Not tied to the turn. |
| `SELL_BUILDING` | `property` | One building off one street. Allowed unless a trade or a building auction is open. |
| `SELL_BUILDINGS` | `levels` | Sells one group down to the given level per street. Same timing as `SELL_BUILDING`. |
| `MORTGAGE` | `property` | Same timing as `SELL_BUILDING`. |
| `UNMORTGAGE` | `property` | No decision open. |
| `SETTLE_TRANSFER` | `lift` | Top decision is your `mortgageTransfer`. |
| `PROPOSE_TRADE` | `to`, `give`, `receive` | No decision open, or a debt in which you or the other player is the debtor. |
| `ACCEPT_TRADE`, `REJECT_TRADE` | | The offer on top is made to you. |
| `CANCEL_TRADE` | | The offer on top is yours. |
| `DECLARE_BANKRUPTCY` | | Your debt is on top and selling and mortgaging everything would not cover it. |

A trade side is `{ cash, properties, jailCards }`: an amount, a list of property ids and a count of cards.

### Legal actions

`legalActions` returns ready-to-apply actions, with two exceptions that stand for a range of choices:

```ts
{ type: 'BID', player, min, max, targets? }      // any whole amount from min to max
{ type: 'PROPOSE_TRADE', player, partners }      // any valid offer to one of these players
```

In a building auction `targets` lists the streets the bidder could name, each with its own minimum. A caller builds the real action from these and may check it with `validate` before applying.

Everything else in the list can be passed to `apply` as it is.

## Events

`apply` returns the events of that action in the order they happened. The client animates them, the chronicle words them, and the simulator counts them. They carry no information that is not also in the state, apart from the history itself.

| Event | Meaning |
| --- | --- |
| `TURN_STARTED` | A turn begins. |
| `DICE_ROLLED` | `purpose` is `order`, `move`, `jail`, or `utility` (the extra roll for works reached by a card). |
| `ORDER_TIED`, `ORDER_DECIDED` | A tie in the opening roll; the final order of play. |
| `MOVED` | From one square to another, with whether the start was passed. |
| `SENT_TO_JAIL`, `JAIL_ROLL_FAILED`, `LEFT_JAIL` | Jail. |
| `CARD_DRAWN` | The deck and the card. |
| `PAID` | Money between two players or a player and the bank (`null`), with a `reason`. |
| `DEBT_INCURRED` | A payment the payer could not make at once. |
| `PROPERTY_OFFERED`, `PROPERTY_ACQUIRED` | A purchase offered; a deed changing hands, with how (`purchase`, `auction`, `trade`, `bankruptcy`). |
| `AUCTION_STARTED`, `BID_PLACED`, `AUCTION_PASSED`, `AUCTION_ENDED` | A property auction. |
| `BUILDING_AUCTION_STARTED` | A building shortage. Bids and passes use the events above. |
| `BUILT`, `BUILDINGS_SOLD` | Buildings going up and coming down. |
| `MORTGAGED`, `UNMORTGAGED`, `MORTGAGE_KEPT` | Mortgages. |
| `TRADE_PROPOSED`, `TRADE_ACCEPTED`, `TRADE_REJECTED`, `TRADE_CANCELLED` | Trades. |
| `BANKRUPT` | A player is out. |
| `GAME_OVER` | The winner, the reason and the final standings. |

## Errors

A refused action returns `{ code, message }`. The codes are a closed list in `src/types.ts` (`NOT_YOUR_TURN`, `WRONG_PHASE`, `DECISION_PENDING`, `INSUFFICIENT_CASH`, `UNEVEN_BUILD`, and so on). Messages are English; the client translates by code.

Rule violations are returned, never thrown. The engine throws only for programming errors: a malformed board, a malformed `newGame` call, or an internal inconsistency.

## Randomness

- The generator is a 32-bit mulberry32. Its state is `state.rng`.
- It is consulted for three things: shuffling the decks at setup, dealing deeds in the short game, and rolling dice.
- `seed` may be a number or a string. A string is hashed.
- `state.diceQueue` overrides the dice: each roll takes the first queued pair if there is one. This is how the tests put a player on a chosen square.

A complete game can be stored as its seed, its player list and its list of actions, and replayed exactly.

## Invariants

`checkInvariants(state)` checks, among other things, that:

- every building is accounted for between the board and the bank, and groups are built evenly;
- every card is in its deck or in a player's hand exactly once;
- only streets in a fully owned, unmortgaged group carry buildings;
- the turn belongs to a player still in the game, and the opening roll ranks every player once;
- pending decisions refer to players and properties that exist and can still act;
- a finished game has a winner who is still in, and no open decisions.

The simulator calls it after every action. The client calls it on a saved game before offering to resume it.

## Adding a board

A board is one `BoardDefinition` value (see `src/boards/three-kingdoms.ts`):

- `squares`, in order: square 0 is the one `start` square, and there is exactly one `jail`;
- streets with a `group`, a `price`, a `buildingCost`, six `rents` (bare, one to four houses, hotel) and a `mortgageValue`;
- `transitRents` and `utilityMultipliers`, one entry per pass and per works on the board, indexed by how many the owner holds;
- `decks` of cards, each card a text and one of ten effects;
- an `economy`: starting cash, salary, bail and the bank's building supply.

Names, translations, colors and art are kept apart in a `BoardPresentation` (`src/boards/presentation.ts`), so the rules never depend on them.

Export both from `src/index.ts`. `test/three-kingdoms.test.ts` shows the checks a new board should pass: it builds, its numbers add up, and simulated games on it finish without breaking an invariant.

## Tests

```bash
npm test
```

- Tests run on Node's built-in runner and import the `.ts` files directly.
- Most tests use a small fixture board (`test/fixture.ts`, 16 properties) so that positions are easy to reason about. `test/helpers.ts` provides the vocabulary: `newGame`, `play`, `rejects`, `landOn`, `roll`, `own`, `build`, `jail`.
- `play` asserts that the action is accepted and that the invariants hold afterwards, so every test checks consistency as a side effect.
- `test/simulation.test.ts` and `test/heuristic-agent.test.ts` play whole games with random and rule-based players and check that every listed action is accepted and no invariant breaks.

Two of those tests are statistical: they assert that rare events turn up, or that games finish, across a fixed set of seeds. A change to how the generator is consumed (as the opening roll was) can shift their outcomes without any rule being wrong. Widen the seed range rather than weakening what they assert.

## Performance

`node scripts/benchmark.ts 1000` on an Apple M4, one thread, Node 24, four rule-based players on the Three Kingdoms board:

| | Full game | Short game |
| --- | ---: | ---: |
| Games per second | 44 | 66 |
| Actions per second | 34,000 | 37,000 |
| Actions per game | 781 | 563 |
| Turns per game | 189 | 143 |

The figures include the agents' own work, which calls `legalActions` for every decision. Two costs dominate and are the first places to look if more speed is needed: `apply` clones the whole state with `structuredClone`, and `legalActions` validates every candidate action from scratch.

## Conventions

- TypeScript is written so that Node can strip the types: no enums, no parameter properties, no namespaces (`erasableSyntaxOnly`), type-only imports marked as such (`verbatimModuleSyntax`), and imports that name the `.ts` file.
- State is only ever changed inside `apply`, on a clone.
- Every rule lives in exactly one `check…` function (used by `validate`) and one `do…` function (used by `apply`).
