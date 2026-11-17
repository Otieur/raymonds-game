import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createEngine, simulateGame, threeKingdoms, threeKingdomsPresentation } from '../src/index.ts';
import type { StreetSquare } from '../src/index.ts';

const board = threeKingdoms;
const look = threeKingdomsPresentation;
const engine = createEngine(board);
const root = new URL('../', import.meta.url);
const streets = board.squares.filter((sq): sq is StreetSquare => sq.kind === 'street');

function indexOf(id: string): number {
  const index = board.squares.findIndex((sq) => sq.id === id);
  assert.ok(index >= 0, `No square "${id}".`);
  return index;
}

/** Reads width and height from a baseline or progressive JPEG frame header. */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  assert.ok(bytes[0] === 0xff && bytes[1] === 0xd8, 'Not a JPEG file.');
  let at = 2;
  while (at + 9 < bytes.length) {
    assert.equal(bytes[at], 0xff, `Bad JPEG marker at byte ${at}.`);
    const marker = bytes[at + 1];
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  throw new Error('No JPEG frame header found.');
}

test('the board has 40 spaces with the themed corners', () => {
  assert.equal(board.squares.length, 40);
  const corners = [0, 10, 20, 30].map((i) => board.squares[i]);
  assert.deepEqual(
    corners.map((sq) => [sq.kind, sq.name]),
    [
      ['start', 'LuoYang'],
      ['jail', 'ChiBi'],
      ['rest', 'HanZhong'],
      ['goToJail', 'YiLing'],
    ],
  );
});

test('streets follow the order of the portraits, two to three per group', () => {
  const order = streets.map((sq) => [indexOf(sq.id), sq.id, sq.group]);
  assert.deepEqual(order, [
    [1, 'dong-zhuo', 'han'],
    [3, 'emperor-xian', 'han'],
    [6, 'wang-yun', 'chain'],
    [8, 'diaochan', 'chain'],
    [9, 'lu-bu', 'chain'],
    [11, 'yuan-shao', 'yuan'],
    [13, 'xu-you', 'yuan'],
    [14, 'yan-liang-wen-chou', 'yuan'],
    [16, 'cao-cao', 'wei'],
    [18, 'cao-pi', 'wei'],
    [19, 'xun-yu', 'wei'],
    [21, 'liu-bei', 'shu'],
    [23, 'guan-yu', 'shu'],
    [24, 'zhuge-liang', 'shu'],
    [26, 'sun-quan', 'wu'],
    [27, 'zhou-yu', 'wu'],
    [29, 'lu-xun', 'wu'],
    [31, 'jiang-wei', 'conquest'],
    [32, 'deng-ai', 'conquest'],
    [34, 'zhong-hui', 'conquest'],
    [37, 'sima-yi', 'sima'],
    [39, 'sima-zhao', 'sima'],
  ]);
});

test('the economy keeps the classic price curve, rent ladder and starting cash', () => {
  assert.deepEqual(
    streets.map((sq) => sq.price),
    [60, 60, 100, 100, 120, 140, 140, 160, 180, 180, 200, 220, 220, 240, 260, 260, 280, 300, 300, 320, 350, 400],
  );
  assert.deepEqual(
    streets.map((sq) => sq.rents[5]),
    [250, 450, 550, 550, 600, 750, 750, 900, 950, 950, 1000, 1050, 1050, 1100, 1150, 1150, 1200, 1275, 1275, 1400, 1500, 2000],
  );
  for (const sq of streets) {
    assert.equal(sq.mortgageValue, sq.price / 2, sq.id);
    assert.ok(
      sq.rents.every((rent, i) => i === 0 || rent > sq.rents[i - 1]),
      `${sq.id} rents must rise with each building`,
    );
  }
  assert.deepEqual(board.transitRents, [25, 50, 100, 200]);
  assert.deepEqual(board.utilityMultipliers, [4, 10]);
  assert.deepEqual(board.economy, { startingCash: 1500, salary: 200, bail: 50, houses: 32, hotels: 12 });
  assert.deepEqual(
    board.squares.filter((sq) => sq.kind === 'tax').map((sq) => [sq.id, sq.amount]),
    [
      ['poll-tax', 200],
      ['war-levy', 100],
    ],
  );
});

test('card spaces sit on the expected squares and each deck holds 16 cards', () => {
  const cardSpaces = board.squares.flatMap((sq, i) => (sq.kind === 'card' ? [[i, sq.deck]] : []));
  assert.deepEqual(cardSpaces, [
    [2, 'edict'],
    [7, 'pouch'],
    [17, 'edict'],
    [22, 'pouch'],
    [33, 'edict'],
    [36, 'pouch'],
  ]);
  for (const deck of Object.values(board.decks)) {
    assert.equal(deck.length, 16);
    assert.equal(deck.filter((c) => c.effect.type === 'jailFree').length, 1);
    for (const c of deck) assert.ok(c.text.length > 0, `${c.id} needs text`);
  }
});

test('every advance card points at the square its text names', () => {
  const targets = Object.values(board.decks)
    .flat()
    .flatMap((c) => (c.effect.type === 'moveTo' ? [[c.id, indexOf(c.effect.square)]] : []));
  assert.deepEqual(targets, [
    ['pouch-sima-zhao', 39],
    ['pouch-luoyang', 0],
    ['pouch-zhuge-liang', 24],
    ['pouch-yuan-shao', 11],
    ['pouch-hulao-pass', 5],
    ['edict-luoyang', 0],
  ]);
});

test('the presentation covers every square, group, deck and card', () => {
  assert.deepEqual(Object.keys(look.squares).sort(), board.squares.map((sq) => sq.id).sort());
  assert.deepEqual(Object.keys(look.groups).sort(), [...new Set(streets.map((sq) => sq.group))].sort());
  assert.deepEqual(Object.keys(look.decks).sort(), Object.keys(board.decks).sort());
  const cardIds = Object.values(board.decks).flat().map((c) => c.id);
  assert.deepEqual(Object.keys(look.cards).sort(), cardIds.sort());
  for (const style of Object.values(look.groups)) assert.match(style.color, /^#[0-9A-F]{6}$/);
});

test('every street has a portrait, and all portraits share one frame size', () => {
  for (const sq of streets) {
    const portrait = look.squares[sq.id].portrait;
    assert.ok(portrait, `${sq.id} needs a portrait`);
    const size = jpegSize(readFileSync(new URL(portrait, root)));
    assert.deepEqual(size, look.portraitSize, portrait);
  }
});

test('random games on this board keep every rule invariant', () => {
  let finished = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const result = simulateGame(engine, { players: 4, seed, maxActions: 20000 });
    if (result.finished) finished += 1;
  }
  assert.ok(finished >= 1);
});
