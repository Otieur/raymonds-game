import type {
  BoardDefinition,
  CardDefinition,
  CardEffect,
  CardId,
  DeckId,
  GroupId,
  Square,
  SquareId,
  StreetSquare,
} from '../types.ts';
import type { BoardPresentation, GroupStyle, SquareStyle } from './presentation.ts';

/*
 * A board set in the late Eastern Han and Three Kingdoms period.
 *
 * Money is counted in wuzhu coins. Prices, rents, building costs, salary and
 * starting cash follow the classic property-trading economy: the curve runs
 * from 60 to 400 for streets, rents climb with each building, and players start
 * with 1,500 and draw 200 each time they pass LuoYang.
 */

const PORTRAITS = 'assets/three-kingdoms/portraits';
const UNIT = 'wuzhu';

type Rents = StreetSquare['rents'];

const squareStyles: Record<SquareId, SquareStyle> = {};
const cardTexts: Record<CardId, { textZh: string }> = {};

function street(
  id: string,
  name: string,
  nameZh: string,
  group: GroupId,
  price: number,
  buildingCost: number,
  rents: Rents,
): StreetSquare {
  squareStyles[id] = { nameZh, portrait: `${PORTRAITS}/${id}.jpg` };
  return { kind: 'street', id, name, group, price, buildingCost, rents, mortgageValue: price / 2 };
}

function named<T extends Square>(square: T, nameZh: string): T {
  squareStyles[square.id] = { nameZh };
  return square;
}

function card(id: CardId, text: string, textZh: string, effect: CardEffect): CardDefinition {
  cardTexts[id] = { textZh };
  return { id, text, effect };
}

const POUCH: DeckId = 'pouch';
const EDICT: DeckId = 'edict';

const squares: Square[] = [
  named({ kind: 'start', id: 'luoyang', name: 'LuoYang' }, '洛阳'),
  street('dong-zhuo', 'Dong Zhuo', '董卓', 'han', 60, 50, [2, 10, 30, 90, 160, 250]),
  named({ kind: 'card', id: 'edict-1', name: 'Imperial Edict', deck: EDICT }, '诏书'),
  street('emperor-xian', 'Emperor Xian', '汉献帝', 'han', 60, 50, [4, 20, 60, 180, 320, 450]),
  named({ kind: 'tax', id: 'poll-tax', name: 'Poll Tax', amount: 200 }, '算赋'),
  named({ kind: 'transit', id: 'hulao-pass', name: 'Hulao Pass', price: 200, mortgageValue: 100 }, '虎牢关'),
  street('wang-yun', 'Wang Yun', '王允', 'chain', 100, 50, [6, 30, 90, 270, 400, 550]),
  named({ kind: 'card', id: 'pouch-1', name: 'Silk Pouch', deck: POUCH }, '锦囊'),
  street('diaochan', 'Diaochan', '貂蝉', 'chain', 100, 50, [6, 30, 90, 270, 400, 550]),
  street('lu-bu', 'Lü Bu', '吕布', 'chain', 120, 50, [8, 40, 100, 300, 450, 600]),

  named({ kind: 'jail', id: 'chibi', name: 'ChiBi' }, '赤壁'),
  street('yuan-shao', 'Yuan Shao', '袁绍', 'yuan', 140, 100, [10, 50, 150, 450, 625, 750]),
  named({ kind: 'utility', id: 'ironworks', name: 'Ironworks', price: 150, mortgageValue: 75 }, '铁官'),
  street('xu-you', 'Xu You', '许攸', 'yuan', 140, 100, [10, 50, 150, 450, 625, 750]),
  street('yan-liang-wen-chou', 'Yan Liang & Wen Chou', '颜良文丑', 'yuan', 160, 100, [12, 60, 180, 500, 700, 900]),
  named({ kind: 'transit', id: 'guandu-ford', name: 'Guandu Ford', price: 200, mortgageValue: 100 }, '官渡'),
  street('cao-cao', 'Cao Cao', '曹操', 'wei', 180, 100, [14, 70, 200, 550, 750, 950]),
  named({ kind: 'card', id: 'edict-2', name: 'Imperial Edict', deck: EDICT }, '诏书'),
  street('cao-pi', 'Cao Pi', '曹丕', 'wei', 180, 100, [14, 70, 200, 550, 750, 950]),
  street('xun-yu', 'Xun Yu', '荀彧', 'wei', 200, 100, [16, 80, 220, 600, 800, 1000]),

  named({ kind: 'rest', id: 'hanzhong', name: 'HanZhong' }, '汉中'),
  street('liu-bei', 'Liu Bei', '刘备', 'shu', 220, 150, [18, 90, 250, 700, 875, 1050]),
  named({ kind: 'card', id: 'pouch-2', name: 'Silk Pouch', deck: POUCH }, '锦囊'),
  street('guan-yu', 'Guan Yu', '关羽', 'shu', 220, 150, [18, 90, 250, 700, 875, 1050]),
  street('zhuge-liang', 'Zhuge Liang', '诸葛亮', 'shu', 240, 150, [20, 100, 300, 750, 925, 1100]),
  named({ kind: 'transit', id: 'changban-bridge', name: 'Changban Bridge', price: 200, mortgageValue: 100 }, '长坂桥'),
  street('sun-quan', 'Sun Quan', '孙权', 'wu', 260, 150, [22, 110, 330, 800, 975, 1150]),
  street('zhou-yu', 'Zhou Yu', '周瑜', 'wu', 260, 150, [22, 110, 330, 800, 975, 1150]),
  named({ kind: 'utility', id: 'salt-works', name: 'Salt Works', price: 150, mortgageValue: 75 }, '盐官'),
  street('lu-xun', 'Lu Xun', '陆逊', 'wu', 280, 150, [24, 120, 360, 850, 1025, 1200]),

  named({ kind: 'goToJail', id: 'yiling', name: 'YiLing' }, '夷陵'),
  street('jiang-wei', 'Jiang Wei', '姜维', 'conquest', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  street('deng-ai', 'Deng Ai', '邓艾', 'conquest', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  named({ kind: 'card', id: 'edict-3', name: 'Imperial Edict', deck: EDICT }, '诏书'),
  street('zhong-hui', 'Zhong Hui', '钟会', 'conquest', 320, 200, [28, 150, 450, 1000, 1200, 1400]),
  named({ kind: 'transit', id: 'jiange-pass', name: 'Jiange Pass', price: 200, mortgageValue: 100 }, '剑阁'),
  named({ kind: 'card', id: 'pouch-3', name: 'Silk Pouch', deck: POUCH }, '锦囊'),
  street('sima-yi', 'Sima Yi', '司马懿', 'sima', 350, 200, [35, 175, 500, 1100, 1300, 1500]),
  named({ kind: 'tax', id: 'war-levy', name: 'War Levy', amount: 100 }, '军赋'),
  street('sima-zhao', 'Sima Zhao', '司马昭', 'sima', 400, 200, [50, 200, 600, 1400, 1700, 2000]),
];

const pouch: CardDefinition[] = [
  card('pouch-sima-zhao', 'Summoned by Sima Zhao. Advance to Sima Zhao.', '司马昭召见。前进到司马昭。', {
    type: 'moveTo',
    square: 'sima-zhao',
  }),
  card(
    'pouch-luoyang',
    `Recalled to the capital. Advance to LuoYang and collect 200 ${UNIT}.`,
    '奉诏回京。前进到洛阳，领 200 钱。',
    { type: 'moveTo', square: 'luoyang' },
  ),
  card(
    'pouch-zhuge-liang',
    `Three visits to the thatched cottage. Advance to Zhuge Liang. If you pass LuoYang, collect 200 ${UNIT}.`,
    '三顾茅庐。前进到诸葛亮；经过洛阳领 200 钱。',
    { type: 'moveTo', square: 'zhuge-liang' },
  ),
  card(
    'pouch-yuan-shao',
    `The coalition gathers against Dong Zhuo. Advance to Yuan Shao. If you pass LuoYang, collect 200 ${UNIT}.`,
    '会盟讨董。前进到袁绍；经过洛阳领 200 钱。',
    { type: 'moveTo', square: 'yuan-shao' },
  ),
  card(
    'pouch-forced-march',
    `Forced march. Advance to the next pass. If it is unowned, you may buy it; if owned, pay the owner twice the toll. If you pass LuoYang, collect 200 ${UNIT}.`,
    '急行军。前进到下一处关隘：无主可买，有主付双倍过路费；经过洛阳领 200 钱。',
    { type: 'moveToNearest', kind: 'transit' },
  ),
  card(
    'pouch-night-crossing',
    `Cross by night. Advance to the next pass. If it is unowned, you may buy it; if owned, pay the owner twice the toll. If you pass LuoYang, collect 200 ${UNIT}.`,
    '夜渡。前进到下一处关隘：无主可买，有主付双倍过路费；经过洛阳领 200 钱。',
    { type: 'moveToNearest', kind: 'transit' },
  ),
  card(
    'pouch-requisition',
    `Requisition supplies. Advance to the next salt or iron office. If it is unowned, you may buy it; if owned, roll the dice and pay the owner ten times the roll. If you pass LuoYang, collect 200 ${UNIT}.`,
    '征调军需。前进到下一处盐铁官：无主可买；有主则重新掷骰，付点数的十倍；经过洛阳领 200 钱。',
    { type: 'moveToNearest', kind: 'utility' },
  ),
  card('pouch-granary', `The granaries overflow. Collect 50 ${UNIT}.`, '仓廪丰实。领 50 钱。', {
    type: 'collect',
    amount: 50,
  }),
  card(
    'pouch-huarong-trail',
    'Escape by the Huarong Trail. Leave ChiBi free. Keep this card until needed, or trade it.',
    '华容道脱身。可免费离开赤壁；保留此卡待用，可交易。',
    { type: 'jailFree' },
  ),
  card('pouch-feigned-retreat', 'Feigned retreat. Go back 3 spaces.', '佯装撤退。后退 3 格。', {
    type: 'moveBack',
    steps: 3,
  }),
  card(
    'pouch-fire-attack',
    `Your fleet is set ablaze. Go directly to ChiBi. Do not pass LuoYang, do not collect 200 ${UNIT}.`,
    '战船遭火攻。直接去赤壁，不经过洛阳，不领 200 钱。',
    { type: 'goToJail' },
  ),
  card(
    'pouch-city-walls',
    `Repair your defenses. Pay 25 ${UNIT} for each farmstead and 100 for each fortress.`,
    '修缮城防。每座田庄付 25 钱，每座坞堡付 100 钱。',
    { type: 'repairs', perHouse: 25, perHotel: 100 },
  ),
  card('pouch-trampled-wheat', `Your horse tramples the young wheat. Pay a fine of 15 ${UNIT}.`, '马踏麦田。罚 15 钱。', {
    type: 'pay',
    amount: 15,
  }),
  card(
    'pouch-hulao-pass',
    `March on Hulao Pass. Advance to Hulao Pass. If you pass LuoYang, collect 200 ${UNIT}.`,
    '兵发虎牢关。前进到虎牢关；经过洛阳领 200 钱。',
    { type: 'moveTo', square: 'hulao-pass' },
  ),
  card(
    'pouch-alliance-leader',
    `Chosen to lead the alliance. Pay each player 50 ${UNIT}.`,
    '被推为盟主。付给每位玩家 50 钱。',
    { type: 'payEach', amount: 50 },
  ),
  card('pouch-tuntian', `Your military farms bring in the harvest. Collect 150 ${UNIT}.`, '屯田丰收。领 150 钱。', {
    type: 'collect',
    amount: 150,
  }),
];

const edict: CardDefinition[] = [
  card(
    'edict-luoyang',
    `Summoned to court. Advance to LuoYang and collect 200 ${UNIT}.`,
    '奉诏入朝。前进到洛阳，领 200 钱。',
    { type: 'moveTo', square: 'luoyang' },
  ),
  card('edict-treasury-error', `The treasury errs in your favor. Collect 200 ${UNIT}.`, '府库算错，于你有利。领 200 钱。', {
    type: 'collect',
    amount: 200,
  }),
  card('edict-hua-tuo', `Hua Tuo treats your wounds. Pay 50 ${UNIT}.`, '华佗为你疗伤。付 50 钱。', {
    type: 'pay',
    amount: 50,
  }),
  card('edict-surplus-grain', `You sell your surplus grain. Collect 50 ${UNIT}.`, '出售余粮。领 50 钱。', {
    type: 'collect',
    amount: 50,
  }),
  card(
    'edict-amnesty',
    'A general amnesty. Leave ChiBi free. Keep this card until needed, or trade it.',
    '大赦天下。可免费离开赤壁；保留此卡待用，可交易。',
    { type: 'jailFree' },
  ),
  card(
    'edict-treason',
    `Accused of plotting against the throne. Go directly to ChiBi. Do not pass LuoYang, do not collect 200 ${UNIT}.`,
    '被告谋逆。直接去赤壁，不经过洛阳，不领 200 钱。',
    { type: 'goToJail' },
  ),
  card('edict-new-year', `New Year gifts from the court. Collect 100 ${UNIT}.`, '朝廷岁赐。领 100 钱。', {
    type: 'collect',
    amount: 100,
  }),
  card('edict-remission', `Your land tax is remitted. Collect 20 ${UNIT}.`, '蠲免田租。领 20 钱。', {
    type: 'collect',
    amount: 20,
  }),
  card(
    'edict-birthday-banquet',
    `You host a birthday banquet. Collect 10 ${UNIT} from every player.`,
    '设寿宴。每位玩家给你 10 钱。',
    { type: 'collectFromEach', amount: 10 },
  ),
  card('edict-veteran-stipend', `Your veteran's stipend comes due. Collect 100 ${UNIT}.`, '老兵俸禄到期。领 100 钱。', {
    type: 'collect',
    amount: 100,
  }),
  card('edict-wounded', `Care for the wounded after battle. Pay 100 ${UNIT}.`, '战后抚恤伤兵。付 100 钱。', {
    type: 'pay',
    amount: 100,
  }),
  card('edict-academy', `Fees for the Imperial Academy. Pay 50 ${UNIT}.`, '太学束脩。付 50 钱。', {
    type: 'pay',
    amount: 50,
  }),
  card('edict-counsel', `Rewarded for your counsel. Collect 25 ${UNIT}.`, '献策有赏。领 25 钱。', {
    type: 'collect',
    amount: 25,
  }),
  card(
    'edict-post-roads',
    `Repair the post roads. Pay 40 ${UNIT} for each farmstead and 115 for each fortress.`,
    '修整驿道。每座田庄付 40 钱，每座坞堡付 115 钱。',
    { type: 'repairs', perHouse: 40, perHotel: 115 },
  ),
  card(
    'edict-poetry',
    `Second place in the poetry contest at Bronze Sparrow Terrace. Collect 10 ${UNIT}.`,
    '铜雀台赋诗得第二。领 10 钱。',
    { type: 'collect', amount: 10 },
  ),
  card('edict-inheritance', `A distant kinsman leaves you his estate. Collect 100 ${UNIT}.`, '远房族亲遗赠家产。领 100 钱。', {
    type: 'collect',
    amount: 100,
  }),
];

export const threeKingdoms: BoardDefinition = {
  id: 'three-kingdoms',
  name: 'Three Kingdoms',
  squares,
  transitRents: [25, 50, 100, 200],
  utilityMultipliers: [4, 10],
  decks: { [POUCH]: pouch, [EDICT]: edict },
  economy: { startingCash: 1500, salary: 200, bail: 50, houses: 32, hotels: 12 },
};

const groups: Record<GroupId, GroupStyle> = {
  han: { name: 'Han Court', nameZh: '汉室', color: '#1E9AA0' },
  chain: { name: 'Chain Stratagem', nameZh: '连环计', color: '#8C8C8C' },
  yuan: { name: 'House of Yuan', nameZh: '袁氏', color: '#C8A04A' },
  wei: { name: 'Cao Wei', nameZh: '曹魏', color: '#2F5FB3' },
  shu: { name: 'Shu Han', nameZh: '蜀汉', color: '#C62828' },
  wu: { name: 'Eastern Wu', nameZh: '东吴', color: '#2E8B3E' },
  conquest: { name: 'Conquest of Shu', nameZh: '灭蜀之战', color: '#FFFFFF' },
  sima: { name: 'House of Sima', nameZh: '司马氏', color: '#6A3D9A' },
};

export const threeKingdomsPresentation: BoardPresentation = {
  board: threeKingdoms.id,
  currency: { name: UNIT, nameZh: '五铢钱', unitZh: '钱' },
  buildings: {
    house: { name: 'Farmstead', nameZh: '田庄' },
    hotel: { name: 'Fortress', nameZh: '坞堡' },
  },
  decks: {
    [POUCH]: { name: 'Silk Pouch', nameZh: '锦囊' },
    [EDICT]: { name: 'Imperial Edict', nameZh: '诏书' },
  },
  groups,
  squares: squareStyles,
  cards: cardTexts,
  portraitSize: { width: 750, height: 950 },
};
