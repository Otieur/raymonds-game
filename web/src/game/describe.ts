import { HOTEL_LEVEL } from '../../../src/index.ts';
import type { GameEvent, PlayerId } from '../../../src/index.ts';
import type { Tongue } from '../i18n.tsx';

/** One line of the chronicle for an event, or null for events that need no line. */
export function describe(event: GameEvent, tg: Tongue, name: (id: PlayerId) => string): string | null {
  const zh = tg.lang === 'zh';
  switch (event.type) {
    case 'TURN_STARTED':
      return zh ? `${name(event.player)} 的回合` : `${name(event.player)}'s turn`;
    case 'DICE_ROLLED': {
      const [a, b] = event.dice;
      const pair = a === b ? (zh ? '（双点）' : ' (doubles)') : '';
      if (event.purpose === 'order') {
        return zh
          ? `${name(event.player)} 掷骰定先后：${a} + ${b} = ${a + b}`
          : `${name(event.player)} rolls ${a} + ${b} = ${a + b} for the order`;
      }
      if (event.purpose === 'utility') return zh ? `掷骰定租：${a} + ${b}` : `Roll for the rent: ${a} + ${b}`;
      return zh ? `${name(event.player)} 掷出 ${a} + ${b}${pair}` : `${name(event.player)} rolls ${a} + ${b}${pair}`;
    }
    case 'ORDER_TIED': {
      const tied = event.players.map(name);
      return zh ? `${tied.join('、')} 同为 ${event.total} 点，重掷` : `${tied.join(' and ')} tie on ${event.total} and roll again`;
    }
    case 'ORDER_DECIDED': {
      const order = event.order.map(name).join(' → ');
      return zh ? `行动顺序：${order}` : `Order of play: ${order}`;
    }
    case 'MOVED': {
      const square = tg.square(tg.squareIdAt(event.to));
      const via = event.passedStart ? (zh ? '，途经洛阳' : ', passing LuoYang') : '';
      return zh ? `${name(event.player)} 行至${square}${via}` : `${name(event.player)} moves to ${square}${via}`;
    }
    case 'SENT_TO_JAIL':
      return zh ? `${name(event.player)} 兵困赤壁` : `${name(event.player)} is held at ChiBi`;
    case 'JAIL_ROLL_FAILED':
      return zh
        ? `${name(event.player)} 突围未成（第 ${event.attempt} 次）`
        : `${name(event.player)} fails to break out (try ${event.attempt})`;
    case 'LEFT_JAIL':
      return zh ? `${name(event.player)} 脱困而出` : `${name(event.player)} leaves ChiBi`;
    case 'CARD_DRAWN':
      return zh
        ? `${name(event.player)} 抽到${tg.deck(event.deck)}：${tg.card(event.card)}`
        : `${name(event.player)} draws ${tg.deck(event.deck)}: ${tg.card(event.card)}`;
    case 'PAID': {
      const why = tg.reason(event.reason);
      const sum = event.amount.toLocaleString('en-US');
      if (event.from === null) {
        return zh ? `${name(event.to ?? '')} 得 ${sum} 钱（${why}）` : `${name(event.to ?? '')} receives ${sum} (${why})`;
      }
      if (event.to === null) {
        return zh ? `${name(event.from)} 付 ${sum} 钱（${why}）` : `${name(event.from)} pays ${sum} (${why})`;
      }
      return zh
        ? `${name(event.from)} 付给 ${name(event.to)} ${sum} 钱（${why}）`
        : `${name(event.from)} pays ${name(event.to)} ${sum} (${why})`;
    }
    case 'DEBT_INCURRED': {
      const creditor = event.creditor === null ? tg.t('bank') : name(event.creditor);
      return zh
        ? `${name(event.debtor)} 欠${creditor} ${event.amount} 钱，正在筹款`
        : `${name(event.debtor)} owes ${creditor} ${event.amount} and must raise it`;
    }
    case 'PROPERTY_OFFERED':
      return null;
    case 'PROPERTY_ACQUIRED':
      if (event.via === 'auction') return null;
      return zh ? `${name(event.player)} 取得${tg.square(event.property)}` : `${name(event.player)} takes ${tg.square(event.property)}`;
    case 'AUCTION_STARTED':
      return zh ? `开拍：${tg.square(event.property)}` : `Auction: ${tg.square(event.property)}`;
    case 'BUILDING_AUCTION_STARTED': {
      const kind = tg.building(event.building === 'hotel');
      return zh ? `${kind}紧缺，竞价开始` : `Short of ${kind}s: bidding opens`;
    }
    case 'BID_PLACED':
      return zh ? `${name(event.player)} 出价 ${event.amount}` : `${name(event.player)} bids ${event.amount}`;
    case 'AUCTION_PASSED':
      return zh ? `${name(event.player)} 放弃竞价` : `${name(event.player)} passes`;
    case 'AUCTION_ENDED':
      if (event.winner === null) return zh ? `${tg.square(event.property)}流拍` : `${tg.square(event.property)} goes unsold`;
      return zh
        ? `${name(event.winner)} 以 ${event.amount} 钱拍得${tg.square(event.property)}`
        : `${name(event.winner)} wins ${tg.square(event.property)} for ${event.amount}`;
    case 'BUILT': {
      const kind = tg.building(event.level === HOTEL_LEVEL);
      return zh
        ? `${name(event.player)} 在${tg.square(event.property)}修建${kind}`
        : `${name(event.player)} builds a ${kind} on ${tg.square(event.property)}`;
    }
    case 'BUILDINGS_SOLD':
      return zh ? `${name(event.player)} 变卖建筑，得 ${event.refund} 钱` : `${name(event.player)} sells buildings for ${event.refund}`;
    case 'MORTGAGED':
      return zh ? `${name(event.player)} 抵押${tg.square(event.property)}` : `${name(event.player)} mortgages ${tg.square(event.property)}`;
    case 'UNMORTGAGED':
      return zh ? `${name(event.player)} 赎回${tg.square(event.property)}` : `${name(event.player)} redeems ${tg.square(event.property)}`;
    case 'MORTGAGE_KEPT':
      return null;
    case 'TRADE_PROPOSED':
      return zh
        ? `${name(event.offer.from)} 向 ${name(event.offer.to)} 提议交易`
        : `${name(event.offer.from)} offers ${name(event.offer.to)} a trade`;
    case 'TRADE_ACCEPTED':
      return zh ? `交易达成：${name(event.offer.from)} 与 ${name(event.offer.to)}` : `Trade agreed: ${name(event.offer.from)} and ${name(event.offer.to)}`;
    case 'TRADE_REJECTED':
      return zh ? `${name(event.offer.to)} 拒绝了交易` : `${name(event.offer.to)} turns the trade down`;
    case 'TRADE_CANCELLED':
      return zh ? `${name(event.offer.from)} 撤回了交易` : `${name(event.offer.from)} withdraws the trade`;
    case 'BANKRUPT':
      return zh ? `${name(event.player)} 兵败破产` : `${name(event.player)} is bankrupt`;
    case 'GAME_OVER':
      return zh ? `${name(event.winner)} 问鼎天下` : `${name(event.winner)} takes the realm`;
  }
}
