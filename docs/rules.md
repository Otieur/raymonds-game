# Rules

This is the game as the engine plays it. Every statement here is enforced by code in `src/engine/` and covered by a test in `test/`. The mechanics follow the classic Monopoly rule sheet (the 2016 edition where editions differ); the names, cards and art are this game's own. The few places where the game departs from that sheet are listed [at the end](#departures-from-the-classic-rules).

Money is counted in wuzhu (五铢钱). Houses are farmsteads (田庄) and hotels are fortresses (坞堡).

## The board

Forty squares, numbered clockwise from the start. The index in the first column is the position the engine stores for each player.

| # | Square | 中文 | Kind | Group | Price | Building | Rent: bare / 1 / 2 / 3 / 4 / fortress | Mortgage |
| ---: | --- | --- | --- | --- | ---: | ---: | --- | ---: |
| 0 | LuoYang | 洛阳 | Start |  |  |  |  |  |
| 1 | Dong Zhuo | 董卓 | Street | Han Court | 60 | 50 | 2 / 10 / 30 / 90 / 160 / 250 | 30 |
| 2 | Imperial Edict | 诏书 | Card |  |  |  | draw Imperial Edict |  |
| 3 | Emperor Xian | 汉献帝 | Street | Han Court | 60 | 50 | 4 / 20 / 60 / 180 / 320 / 450 | 30 |
| 4 | Poll Tax | 算赋 | Tax |  |  |  | pay 200 |  |
| 5 | Hulao Pass | 虎牢关 | Pass |  | 200 |  | by passes held | 100 |
| 6 | Wang Yun | 王允 | Street | Chain Stratagem | 100 | 50 | 6 / 30 / 90 / 270 / 400 / 550 | 50 |
| 7 | Silk Pouch | 锦囊 | Card |  |  |  | draw Silk Pouch |  |
| 8 | Diaochan | 貂蝉 | Street | Chain Stratagem | 100 | 50 | 6 / 30 / 90 / 270 / 400 / 550 | 50 |
| 9 | Lü Bu | 吕布 | Street | Chain Stratagem | 120 | 50 | 8 / 40 / 100 / 300 / 450 / 600 | 60 |
| 10 | ChiBi | 赤壁 | Jail |  |  |  |  |  |
| 11 | Yuan Shao | 袁绍 | Street | House of Yuan | 140 | 100 | 10 / 50 / 150 / 450 / 625 / 750 | 70 |
| 12 | Ironworks | 铁官 | Works |  | 150 |  | by dice | 75 |
| 13 | Xu You | 许攸 | Street | House of Yuan | 140 | 100 | 10 / 50 / 150 / 450 / 625 / 750 | 70 |
| 14 | Yan Liang & Wen Chou | 颜良文丑 | Street | House of Yuan | 160 | 100 | 12 / 60 / 180 / 500 / 700 / 900 | 80 |
| 15 | Guandu Ford | 官渡 | Pass |  | 200 |  | by passes held | 100 |
| 16 | Cao Cao | 曹操 | Street | Cao Wei | 180 | 100 | 14 / 70 / 200 / 550 / 750 / 950 | 90 |
| 17 | Imperial Edict | 诏书 | Card |  |  |  | draw Imperial Edict |  |
| 18 | Cao Pi | 曹丕 | Street | Cao Wei | 180 | 100 | 14 / 70 / 200 / 550 / 750 / 950 | 90 |
| 19 | Xun Yu | 荀彧 | Street | Cao Wei | 200 | 100 | 16 / 80 / 220 / 600 / 800 / 1000 | 100 |
| 20 | HanZhong | 汉中 | Rest |  |  |  |  |  |
| 21 | Liu Bei | 刘备 | Street | Shu Han | 220 | 150 | 18 / 90 / 250 / 700 / 875 / 1050 | 110 |
| 22 | Silk Pouch | 锦囊 | Card |  |  |  | draw Silk Pouch |  |
| 23 | Guan Yu | 关羽 | Street | Shu Han | 220 | 150 | 18 / 90 / 250 / 700 / 875 / 1050 | 110 |
| 24 | Zhuge Liang | 诸葛亮 | Street | Shu Han | 240 | 150 | 20 / 100 / 300 / 750 / 925 / 1100 | 120 |
| 25 | Changban Bridge | 长坂桥 | Pass |  | 200 |  | by passes held | 100 |
| 26 | Sun Quan | 孙权 | Street | Eastern Wu | 260 | 150 | 22 / 110 / 330 / 800 / 975 / 1150 | 130 |
| 27 | Zhou Yu | 周瑜 | Street | Eastern Wu | 260 | 150 | 22 / 110 / 330 / 800 / 975 / 1150 | 130 |
| 28 | Salt Works | 盐官 | Works |  | 150 |  | by dice | 75 |
| 29 | Lu Xun | 陆逊 | Street | Eastern Wu | 280 | 150 | 24 / 120 / 360 / 850 / 1025 / 1200 | 140 |
| 30 | YiLing | 夷陵 | Go to jail |  |  |  |  |  |
| 31 | Jiang Wei | 姜维 | Street | Conquest of Shu | 300 | 200 | 26 / 130 / 390 / 900 / 1100 / 1275 | 150 |
| 32 | Deng Ai | 邓艾 | Street | Conquest of Shu | 300 | 200 | 26 / 130 / 390 / 900 / 1100 / 1275 | 150 |
| 33 | Imperial Edict | 诏书 | Card |  |  |  | draw Imperial Edict |  |
| 34 | Zhong Hui | 钟会 | Street | Conquest of Shu | 320 | 200 | 28 / 150 / 450 / 1000 / 1200 / 1400 | 160 |
| 35 | Jiange Pass | 剑阁 | Pass |  | 200 |  | by passes held | 100 |
| 36 | Silk Pouch | 锦囊 | Card |  |  |  | draw Silk Pouch |  |
| 37 | Sima Yi | 司马懿 | Street | House of Sima | 350 | 200 | 35 / 175 / 500 / 1100 / 1300 / 1500 | 175 |
| 38 | War Levy | 军赋 | Tax |  |  |  | pay 100 |  |
| 39 | Sima Zhao | 司马昭 | Street | House of Sima | 400 | 200 | 50 / 200 / 600 / 1400 / 1700 / 2000 | 200 |

The four corners are LuoYang (start), ChiBi (jail), HanZhong (a resting place where nothing happens) and YiLing (go to jail).

### Groups

| Group | 中文 | Id | Color | Streets |
| --- | --- | --- | --- | --- |
| Han Court | 汉室 | `han` | `#1E9AA0` | Dong Zhuo, Emperor Xian |
| Chain Stratagem | 连环计 | `chain` | `#8C8C8C` | Wang Yun, Diaochan, Lü Bu |
| House of Yuan | 袁氏 | `yuan` | `#C8A04A` | Yuan Shao, Xu You, Yan Liang & Wen Chou |
| Cao Wei | 曹魏 | `wei` | `#2F5FB3` | Cao Cao, Cao Pi, Xun Yu |
| Shu Han | 蜀汉 | `shu` | `#C62828` | Liu Bei, Guan Yu, Zhuge Liang |
| Eastern Wu | 东吴 | `wu` | `#2E8B3E` | Sun Quan, Zhou Yu, Lu Xun |
| Conquest of Shu | 灭蜀之战 | `conquest` | `#FFFFFF` | Jiang Wei, Deng Ai, Zhong Hui |
| House of Sima | 司马氏 | `sima` | `#6A3D9A` | Sima Yi, Sima Zhao |

### Passes and works

| Kind | Squares | Rent |
| --- | --- | --- |
| Pass (`transit`) | Hulao Pass, Guandu Ford, Changban Bridge, Jiange Pass | 25, 50, 100 or 200, for 1, 2, 3 or 4 passes held by the owner. |
| Works (`utility`) | Ironworks, Salt Works | 4 times the dice if the owner holds one, 10 times if both. |

### Money and supplies

| Item | Amount |
| --- | ---: |
| Cash at the start | 1,500 |
| Salary for passing or landing on LuoYang | 200 |
| Bail to leave ChiBi | 50 |
| Poll Tax | 200 |
| War Levy | 100 |
| Farmsteads in the bank | 32 |
| Fortresses in the bank | 12 |

## Setup

- 2 to 4 players in the client, each taking one faction: Wei, Shu, Wu or Qun. The engine itself accepts 2 to 8.
- Each player picks one of four tokens. No two players share one. Tokens have no effect on play.
- Everyone starts on LuoYang with 1,500.

### The opening roll

The game opens with a roll for the order of play.

1. Every player throws both dice once, in seat order.
2. Players are ranked by total, highest first.
3. Players who tie throw again among themselves. Only their places relative to each other are at stake. This repeats until no tie is left.
4. The table is reseated in the final ranking, and that is the order of play for the rest of the game.

Nothing else may be done until the order is settled. Doubles in the opening roll mean nothing.

## A turn

1. **Roll.** Throw both dice and move that many squares clockwise.
2. **Resolve the square** you land on (see below).
3. **Doubles** give another roll after the square is resolved. A third double in one turn sends you straight to ChiBi without moving, and the turn is over.
4. **End the turn** once there is no roll left.

Building, selling buildings, mortgaging, redeeming and proposing trades are not tied to the turn: any player may do them whenever no decision is open, in any order. Selling buildings and mortgaging are also allowed while a purchase, a property auction or a debt is open, so that money can be raised for it.

## Landing on a square

| Square | What happens |
| --- | --- |
| Unowned street, pass or works | Buy it at its list price, or decline. If declined, it is auctioned at once. |
| Someone else's property | Pay rent, unless it is mortgaged. |
| Your own property | Nothing. |
| Poll Tax, War Levy | Pay the amount to the bank. |
| Silk Pouch, Imperial Edict | Draw the top card of that deck and do what it says. |
| YiLing | Go to ChiBi. Do not collect salary. The turn ends. |
| ChiBi | Just visiting. |
| HanZhong | Nothing. |
| LuoYang | Collect 200. Passing it pays the same. |

### Rent

- **Street without buildings:** the base rent. It doubles when the owner holds the whole group, even if another street of the group is mortgaged.
- **Street with buildings:** the rent listed for that number of farmsteads, or for a fortress.
- **Pass:** by the number of passes the owner holds.
- **Works:** the dice total that brought you there, times 4 or 10.
- **Mortgaged property:** no rent.

A card that sends you to the nearest pass doubles the fare. A card that sends you to the nearest works makes you roll again and pay ten times that roll.

## Auctions

A declined property is auctioned among every player still in the game, the one who declined included.

- The first bid must be at least 10. Each later bid must beat the standing one by at least 1.
- A bid may not exceed the bidder's cash.
- Bidding is open: anyone who does not hold the high bid may bid or pass at any time.
- Passing is final for that auction.
- The auction ends when only the high bidder is left, who pays the bank and takes the deed. If everyone passes without a bid, the property stays with the bank.

## Building

- You may build on a street only if you own its whole group and no street in the group is mortgaged.
- Build evenly: no street may be more than one building ahead of another in its group.
- A farmstead costs the group's building price. After four farmsteads on every street of the group, a fifth purchase turns a street's four farmsteads into a fortress. The four farmsteads return to the bank.
- The bank's supply is limited. With no farmstead left in the bank, none can be bought.
- Buildings sell back to the bank for half their cost, evenly, at any time the seller is free to act. Selling a fortress puts four farmsteads back on the street. If the bank cannot supply them, the group must be sold down further in one step.

### Building shortage

When the bank holds fewer buildings of a kind than all the players who could build one together want, a purchase becomes an auction among those players.

- The player who tried to buy opens as the high bidder at 10 (or the list price, if that is lower).
- Each rival may bid higher, naming one of their own streets that could take the building, or pass.
- The winner pays their bid and the building goes on the street they named. The bid may end up below the list price.

## Mortgages

- A property may be mortgaged for its mortgage value (half its price) once every building in its group has been sold.
- A mortgaged property earns no rent.
- Redeeming costs the mortgage value plus 10 percent, rounded up.
- Whoever receives a mortgaged property, by trade or by a bankruptcy, pays the 10 percent at once and then chooses: redeem it now for the mortgage value, or keep it mortgaged and pay the full redemption price later.

## ChiBi

You are sent to ChiBi by landing on YiLing, by a card, or by a third double. Your turn ends there.

On a later turn, before rolling, you may pay 50 or use a card that frees you, and then roll and move as usual. Otherwise you roll:

- **Doubles:** you leave and move by that roll. There is no extra roll.
- **No doubles:** you stay. After the third failed roll you must pay 50, or use a card if you hold one, and then move by that roll.

A player in ChiBi still collects rent, builds, mortgages, trades and bids.

## Cards

Two decks of 16 cards each, shuffled at the start. A drawn card takes effect at once and goes to the bottom of its deck. The two cards that free a player from ChiBi are kept until used or traded, then return to the bottom of their deck.

**Silk Pouch (锦囊)**

| Card | Effect |
| --- | --- |
| Summoned by Sima Zhao. Advance to Sima Zhao. | Advance to Sima Zhao |
| Recalled to the capital. Advance to LuoYang and collect 200 wuzhu. | Advance to LuoYang |
| Three visits to the thatched cottage. Advance to Zhuge Liang. If you pass LuoYang, collect 200 wuzhu. | Advance to Zhuge Liang |
| The coalition gathers against Dong Zhuo. Advance to Yuan Shao. If you pass LuoYang, collect 200 wuzhu. | Advance to Yuan Shao |
| Forced march. Advance to the next pass. If it is unowned, you may buy it; if owned, pay the owner twice the toll. If you pass LuoYang, collect 200 wuzhu. | Advance to the nearest pass |
| Cross by night. Advance to the next pass. If it is unowned, you may buy it; if owned, pay the owner twice the toll. If you pass LuoYang, collect 200 wuzhu. | Advance to the nearest pass |
| Requisition supplies. Advance to the next salt or iron office. If it is unowned, you may buy it; if owned, roll the dice and pay the owner ten times the roll. If you pass LuoYang, collect 200 wuzhu. | Advance to the nearest works |
| The granaries overflow. Collect 50 wuzhu. | Collect 50 |
| Escape by the Huarong Trail. Leave ChiBi free. Keep this card until needed, or trade it. | Keep: leave ChiBi free |
| Feigned retreat. Go back 3 spaces. | Go back 3 squares |
| Your fleet is set ablaze. Go directly to ChiBi. Do not pass LuoYang, do not collect 200 wuzhu. | Go to ChiBi |
| Repair your defenses. Pay 25 wuzhu for each farmstead and 100 for each fortress. | Pay 25 per farmstead and 100 per fortress |
| Your horse tramples the young wheat. Pay a fine of 15 wuzhu. | Pay 15 |
| March on Hulao Pass. Advance to Hulao Pass. If you pass LuoYang, collect 200 wuzhu. | Advance to Hulao Pass |
| Chosen to lead the alliance. Pay each player 50 wuzhu. | Pay each player 50 |
| Your military farms bring in the harvest. Collect 150 wuzhu. | Collect 150 |

**Imperial Edict (诏书)**

| Card | Effect |
| --- | --- |
| Summoned to court. Advance to LuoYang and collect 200 wuzhu. | Advance to LuoYang |
| The treasury errs in your favor. Collect 200 wuzhu. | Collect 200 |
| Hua Tuo treats your wounds. Pay 50 wuzhu. | Pay 50 |
| You sell your surplus grain. Collect 50 wuzhu. | Collect 50 |
| A general amnesty. Leave ChiBi free. Keep this card until needed, or trade it. | Keep: leave ChiBi free |
| Accused of plotting against the throne. Go directly to ChiBi. Do not pass LuoYang, do not collect 200 wuzhu. | Go to ChiBi |
| New Year gifts from the court. Collect 100 wuzhu. | Collect 100 |
| Your land tax is remitted. Collect 20 wuzhu. | Collect 20 |
| You host a birthday banquet. Collect 10 wuzhu from every player. | Collect 10 from each player |
| Your veteran's stipend comes due. Collect 100 wuzhu. | Collect 100 |
| Care for the wounded after battle. Pay 100 wuzhu. | Pay 100 |
| Fees for the Imperial Academy. Pay 50 wuzhu. | Pay 50 |
| Rewarded for your counsel. Collect 25 wuzhu. | Collect 25 |
| Repair the post roads. Pay 40 wuzhu for each farmstead and 115 for each fortress. | Pay 40 per farmstead and 115 per fortress |
| Second place in the poetry contest at Bronze Sparrow Terrace. Collect 10 wuzhu. | Collect 10 |
| A distant kinsman leaves you his estate. Collect 100 wuzhu. | Collect 100 |

## Trades

- A player may propose a trade to another whenever no decision is open. While a debt is open, only trades that involve the debtor may be proposed.
- Each side may put in cash, properties and cards that free a player from ChiBi. Both sides must hand something over.
- A street cannot be traded while any street of its group has buildings.
- The other player accepts or rejects. The proposer may withdraw the offer first.
- Mortgaged properties change hands under the [mortgage rule](#mortgages). A trade is not allowed if a side could not pay that interest.

## Debt and bankruptcy

When a payment is larger than the payer's cash, it becomes a debt that must be settled before play continues.

- The debtor may sell buildings, mortgage properties and trade. The debt is paid the moment their cash covers it.
- The debtor may declare bankruptcy only when everything they could raise by selling buildings and mortgaging would still not cover the debt.

On bankruptcy:

| Creditor | What happens |
| --- | --- |
| Another player | The buildings are sold to the bank at half cost. The cash, the properties and any cards that free a player go to the creditor, who settles each mortgaged property under the [mortgage rule](#mortgages). |
| The bank | The buildings are sold, the cards go back to their decks, and the properties are freed of their mortgages and auctioned one at a time. |

A bankrupt player is out of the game.

## Winning

The last player left wins.

### Net worth

Where the rules rank players by wealth, a player's net worth is their cash, plus each property at its list price (half for a mortgaged one), plus each building at what it cost. A fortress counts as the farmsteads it replaced plus one more building.

## The short game

An optional variant. In simulated four-player games it runs about three quarters the length of the full game (145 turns against 188 on average). With two or three players it is barely shorter, because the full game ends at the same bankruptcy; see [statistics.md](statistics.md#the-short-game). It changes three things:

1. **Dealt deeds.** Before the opening roll, each player is dealt two properties at random and pays the bank their list price.
2. **Faster fortresses.** Three farmsteads on every street of a group are enough before a fortress. Fortress rent is unchanged. A fortress then counts as four buildings for cost, resale and net worth.
3. **Early finish.** The game ends at the second bankruptcy. The bankrupt player hands everything to the creditor, buildings included when the creditor is a player, and the remaining players are ranked by net worth. The richest wins.

## Rule options

The engine takes the rules as data. `createEngine(board, rules)` merges the given options over these defaults (`src/rules.ts`):

| Option | Default | Meaning |
| --- | ---: | --- |
| `minPlayers`, `maxPlayers` | 2, 8 | Table sizes the engine accepts. |
| `doublesToJail` | 3 | Doubles in one turn that send the player to jail. |
| `maxJailRolls` | 3 | Failed rolls before bail is forced. |
| `mortgageInterestPercent` | 10 | Interest on redeeming or receiving a mortgage. |
| `buildingResalePercent` | 50 | What the bank pays for a building, as a share of its cost. |
| `groupRentMultiplier` | 2 | Rent multiplier for a whole group without buildings. |
| `nearestTransitRentMultiplier` | 2 | Fare multiplier after a card that moves to the nearest pass. |
| `buildingShortageAuction` | `true` | Whether a shortage of buildings is settled by auction. |
| `auctionOpeningBid` | 10 | Lowest first bid in any auction. |
| `startingDeeds` | 0 | Properties dealt to each player at setup. |
| `housesBeforeHotel` | 4 | Farmsteads on each street of a group before a fortress. |
| `endAfterBankruptcies` | `null` | End the game at this many bankruptcies and rank by net worth. |

`SHORT_GAME_RULES` sets `startingDeeds: 2`, `housesBeforeHotel: 3` and `endAfterBankruptcies: 2`.

## Departures from the classic rules

- **Order of play.** The classic rule gives the highest roller the first turn and passes play to the left. Here the opening roll ranks everyone and the whole order follows it.
- **Trades at any time.** Any player may propose a trade whenever no decision is open, not only the player whose turn it is.
- **Open bidding.** Auctions have no bidding order: any eligible player may bid or pass next.
- **No house rules.** HanZhong pays nothing, and landing on LuoYang pays the ordinary salary.
