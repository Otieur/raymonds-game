/**
 * Checks that the style agent with the baseline style makes exactly the decisions of today's
 * rule-based agent, drawing the same random numbers.
 *
 *   node scripts/check-style.ts [--games 1000]
 *   node scripts/check-style.ts --presets 200 [--only name,name]
 *   node scripts/check-style.ts --explain opportunist --size 4 --seed 17   which rules were on at each decision
 *   node scripts/check-style.ts --gate <study.json>[,<study.json>]          judges M2's behaviour bars
 *
 * At every decision of a game driven by `chooseHeuristicAction`, both agents are given the same
 * state and the same random stream. Their actions, the random numbers they draw, and the
 * proposals they remember must be equal.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chooseHeuristicAction, createAgentMemory, createEngine, threeKingdoms } from '../src/index.ts';
import type { Engine } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { BASELINE } from '../src/sim/style.ts';
import { chooseStyledAction, createStyleMemory, observe } from '../src/sim/style-agent.ts';
import { PRESETS, presetAgent } from '../src/sim/styles.ts';
import type { SeatAgent } from '../src/sim/styles.ts';

/** Plays one game and returns the first difference, or null. Also returns the decisions compared. */
export function compareWithBaseline(engine: Engine, players: number, seed: number): { difference: string | null; decisions: number } {
  const holder = { rng: seedFrom(`equivalence-${players}-${seed}`) };
  const memory = createAgentMemory();
  const styleMemory = createStyleMemory();
  let state = engine.newGame({ players: Array.from({ length: players }, (_, i) => `p${i + 1}`), seed });
  let decisions = 0;
  for (let actions = 0; state.winner === null && actions < 40000; actions++) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(nextFloat(holder) * waiting.length)];
    const start = holder.rng;
    const a = { rng: start };
    const b = { rng: start };
    const expected = chooseHeuristicAction(engine, state, actor, () => nextFloat(a), memory);
    const actual = chooseStyledAction(engine, state, actor, () => nextFloat(b), BASELINE, styleMemory);
    decisions += 1;
    const where = `${players} players, seed ${seed}, action ${actions + 1}`;
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      return { difference: `${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`, decisions };
    }
    if (a.rng !== b.rng) return { difference: `${where}: the agents drew different random numbers`, decisions };
    if (JSON.stringify(memory.proposedOn) !== JSON.stringify(styleMemory.proposedOn)) {
      return { difference: `${where}: the remembered proposals differ`, decisions };
    }
    holder.rng = a.rng;
    if (!expected) return { difference: `${where}: nobody can act`, decisions };
    const result = engine.apply(state, expected);
    if (!result.ok) return { difference: `${where}: the action was refused`, decisions };
    state = result.state;
    observe(styleMemory, result.events, state);
  }
  return { difference: null, decisions };
}

/**
 * Plays one game with the preset in the first seat and baselines in the rest, under the engine's
 * checks. Returns the problem, or null, and whether the game finished.
 */
export function playPreset(engine: Engine, name: string, players: number, seed: number): { problem: string | null; finished: boolean; won: boolean } {
  const holder = { rng: seedFrom(`preset-${name}-${players}-${seed}`) };
  const random = () => nextFloat(holder);
  const ids = Array.from({ length: players }, (_, i) => `p${i + 1}`);
  const agents = new Map<string, SeatAgent>(ids.map((id, i) => [id, presetAgent(i === 0 ? name : 'baseline')]));
  let state = engine.newGame({ players: ids, seed });
  for (let actions = 0; state.winner === null && actions < 40000; actions++) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(random() * waiting.length)];
    const action = agents.get(actor)?.choose(engine, state, actor, random);
    const where = `${name}, ${players} players, seed ${seed}, action ${actions + 1}`;
    if (!action) return { problem: `${where}: ${actor} has no action`, finished: false, won: false };
    const result = engine.apply(state, action);
    if (!result.ok) return { problem: `${where}: ${JSON.stringify(action)} was refused: ${result.error.message}`, finished: false, won: false };
    state = result.state;
    const broken = engine.checkInvariants(state);
    if (broken.length > 0) return { problem: `${where}: ${broken.join('; ')}`, finished: false, won: false };
    for (const agent of agents.values()) agent.observe(result.events, state);
  }
  return { problem: null, finished: state.winner !== null, won: state.winner === 'p1' };
}

/** One seat's behaviour summed over games, as the study saves it. */
type B = Record<string, number> & { acquiredBySet: number[]; heldAt20BySet: number[] };

/** M2's bars, each on the summed behaviour of the school and of an ordinary seat at the same tables. */
function gateBars(name: string, odd: B, ord: B, games: number, bankEmpty: number, baselineBankEmpty: number): { bar: string; measured: string; pass: boolean | null } {
  const per = (b: B, k: string) => b[k] / games;
  const at20 = (b: B, k: string) => b[k] / Math.max(1, b.seenAt20);
  const share = (num: number, den: number) => num / Math.max(1, den);
  const f = (v: number, d = 2) => v.toFixed(d);
  const SET = ['han', 'chain', 'yuan', 'wei', 'shu', 'wu', 'conquest', 'sima', 'passes', 'works'];
  const sets = (b: B, which: string[]) => which.reduce((t, w) => t + b.acquiredBySet[SET.indexOf(w)], 0);
  const heldShare = (b: B, which: string[]) => share(which.reduce((t, w) => t + b.heldAt20BySet[SET.indexOf(w)], 0), b.heldAt20BySet.reduce((t, v) => t + v, 0));
  const peak3 = (b: B) => share(b.peak3, b.builtGroups);
  const auctionShare = (b: B) => share(b.auctionBuys, b.auctionBuys + b.listBuys);
  const trades = (b: B) => per(b, 'acceptedAsProposer') + per(b, 'acceptedAsReceiver');
  const firstRound = (b: B) => share(b.firstBuildingRound, b.firstBuildings);
  switch (name) {
    case 'refuser':
      return { bar: 'No offer accepted as receiver', measured: `${odd.acceptedAsReceiver} accepted`, pass: odd.acceptedAsReceiver === 0 };
    case 'reference': {
      const banned = sets(odd, ['works', 'conquest']);
      return { bar: 'No works or Conquest of Shu bought; 60% of built groups peak at three', measured: `${banned} bought; ${f(peak3(odd) * 100, 0)}% at three`, pass: banned === 0 && peak3(odd) >= 0.6 };
    }
    case 'pass-baron':
      return { bar: '0.5 more passes at round 20', measured: `${f(at20(odd, 'passesAt20'))} against ${f(at20(ord, 'passesAt20'))}`, pass: at20(odd, 'passesAt20') - at20(ord, 'passesAt20') >= 0.5 };
    case 'rusher':
      return {
        bar: 'First building a round earlier; more mortgages out of debt',
        measured: `round ${f(firstRound(odd), 1)} against ${f(firstRound(ord), 1)}; ${f(per(odd, 'mortgagesOutOfDebt'))} against ${f(per(ord, 'mortgagesOutOfDebt'))}`,
        pass: firstRound(odd) <= firstRound(ord) - 1 && odd.mortgagesOutOfDebt > ord.mortgagesOutOfDebt,
      };
    case 'three-and-hold':
      return { bar: '60% of built groups peak at exactly three', measured: `${f(peak3(odd) * 100, 0)}%`, pass: peak3(odd) >= 0.6 };
    case 'hoarder':
      return { bar: 'Half as much cash again at round 20', measured: `${f(at20(odd, 'cashAt20'), 0)} against ${f(at20(ord, 'cashAt20'), 0)}`, pass: at20(odd, 'cashAt20') >= 1.5 * at20(ord, 'cashAt20') };
    case 'blocker':
      return { bar: 'No accepted offer that completes the proposer\'s group', measured: `${odd.completionsSold}`, pass: odd.completionsSold === 0 };
    case 'dealer':
      return { bar: 'Half as many accepted trades again', measured: `${f(trades(odd))} against ${f(trades(ord))} a game`, pass: trades(odd) >= 1.5 * trades(ord) };
    case 'shark':
      return { bar: 'Twice the auction share', measured: `${f(auctionShare(odd) * 100, 1)}% against ${f(auctionShare(ord) * 100, 1)}%`, pass: auctionShare(odd) >= 2 * auctionShare(ord) };
    case 'cornerer':
      return { bar: 'Bank out of farmsteads in 10 points more games', measured: `${f(bankEmpty * 100, 1)}% against ${f(baselineBankEmpty * 100, 1)}%`, pass: bankEmpty - baselineBankEmpty >= 0.1 };
    case 'cheap-side':
    case 'dear-side': {
      const avoided = name === 'cheap-side' ? ['shu', 'wu', 'conquest', 'sima'] : ['han', 'chain', 'yuan', 'wei'];
      return { bar: 'Nothing acquired from the bank on the side it avoids', measured: `${sets(odd, avoided)}`, pass: sets(odd, avoided) === 0 };
    }
    case 'warm-sides':
    case 'prestige':
    case 'orange-and-sky': {
      const preferred = { 'warm-sides': ['yuan', 'wei', 'shu', 'wu'], prestige: ['passes', 'sima'], 'orange-and-sky': ['passes', 'wei', 'chain'] }[name];
      return {
        bar: 'A larger share of its property in the sets it prefers',
        measured: `${f(heldShare(odd, preferred) * 100, 1)}% against ${f(heldShare(ord, preferred) * 100, 1)}%`,
        pass: heldShare(odd, preferred) > heldShare(ord, preferred),
      };
    }
    case 'sniper':
      return { bar: 'At most a third as many purchases at list price', measured: `${f(per(odd, 'listBuys'))} against ${f(per(ord, 'listBuys'))}`, pass: odd.listBuys <= ord.listBuys / 3 };
    case 'land-grabber':
      return {
        bar: 'More properties at round 10; more mortgages out of debt',
        measured: `${f(share(odd.propertiesAt10, odd.seenAt10))} against ${f(share(ord.propertiesAt10, ord.seenAt10))}; ${f(per(odd, 'mortgagesOutOfDebt'))} against ${f(per(ord, 'mortgagesOutOfDebt'))}`,
        pass: share(odd.propertiesAt10, odd.seenAt10) > share(ord.propertiesAt10, ord.seenAt10) && odd.mortgagesOutOfDebt > ord.mortgagesOutOfDebt,
      };
    case 'all-in':
      return {
        bar: 'Under half the cash at round 20; more mortgages out of debt',
        measured: `${f(at20(odd, 'cashAt20'), 0)} against ${f(at20(ord, 'cashAt20'), 0)}`,
        pass: at20(odd, 'cashAt20') < 0.5 * at20(ord, 'cashAt20') && odd.mortgagesOutOfDebt > ord.mortgagesOutOfDebt,
      };
    case 'slumlord':
      return {
        bar: 'Han Court or Chain Stratagem at a fortress in more games, and earlier',
        measured: `${f(per(odd, 'cheapFortress') * 100, 1)}% of games at round ${f(share(odd.cheapFortressRound, odd.cheapFortress), 1)}, against ${f(per(ord, 'cheapFortress') * 100, 1)}% at ${f(share(ord.cheapFortressRound, ord.cheapFortress), 1)}`,
        pass: odd.cheapFortress > ord.cheapFortress && share(odd.cheapFortressRound, odd.cheapFortress) < share(ord.cheapFortressRound, ord.cheapFortress),
      };
    case 'ambusher':
      return { bar: 'A larger share of buildings bought with a rival within one roll', measured: `${f(share(odd.buildsNear, odd.builds) * 100, 1)}% against ${f(share(ord.buildsNear, ord.builds) * 100, 1)}%`, pass: share(odd.buildsNear, odd.builds) > share(ord.buildsNear, ord.builds) };
    case 'turtle':
      return { bar: 'More turns in jail after round 20', measured: `${f(per(odd, 'jailTurnsAfter20'))} against ${f(per(ord, 'jailTurnsAfter20'))} a game`, pass: odd.jailTurnsAfter20 > ord.jailTurnsAfter20 };
    case 'driver':
      return {
        bar: 'Rivals pay more at auctions it bid in and lost',
        measured: `${f(share(odd.auctionsLostRatio, odd.auctionsLost))} against ${f(share(ord.auctionsLostRatio, ord.auctionsLost))} times list`,
        pass: share(odd.auctionsLostRatio, odd.auctionsLost) > share(ord.auctionsLostRatio, ord.auctionsLost),
      };
    case 'vulture':
      return {
        bar: 'Pays less at the auctions it wins; offers in most games',
        measured: `${f(share(odd.auctionsWonRatio, odd.auctionBuys))} against ${f(share(ord.auctionsWonRatio, ord.auctionBuys))} times list; ${f(per(odd, 'offersMade'))} offers a game`,
        pass: share(odd.auctionsWonRatio, odd.auctionBuys) < share(ord.auctionsWonRatio, ord.auctionBuys) && per(odd, 'offersMade') >= 0.5,
      };
    case 'hermit':
      return { bar: 'No offer made or accepted', measured: `${odd.offersMade} made, ${odd.acceptedAsReceiver + odd.acceptedAsProposer} accepted`, pass: odd.offersMade === 0 && odd.acceptedAsReceiver === 0 && odd.acceptedAsProposer === 0 };
    case 'open-hand': {
      const a = share(odd.acceptedAsReceiver, odd.receivedOffers);
      const b = share(ord.acceptedAsReceiver, ord.receivedOffers);
      return { bar: 'Twice the share of received offers accepted', measured: `${f(a * 100, 1)}% against ${f(b * 100, 1)}%`, pass: a >= 2 * b };
    }
    case 'big-spender':
      return { bar: 'Pays more in its accepted offers', measured: `${f(share(odd.proposerPaid, odd.proposerList))} against ${f(share(ord.proposerPaid, ord.proposerList))} times list`, pass: share(odd.proposerPaid, odd.proposerList) > share(ord.proposerPaid, ord.proposerList) };
    case 'squeezer':
      return { bar: 'Offers its own property', measured: `${f(per(odd, 'ownPropertyOffers'))} a game against ${f(per(ord, 'ownPropertyOffers'))}`, pass: per(odd, 'ownPropertyOffers') >= 0.5 && odd.ownPropertyOffers > ord.ownPropertyOffers };
    case 'two-stage':
      return { bar: 'Its first group on the cheap side in most games', measured: `${f(share(odd.firstGroupCheap, odd.firstGroups) * 100, 0)}% against ${f(share(ord.firstGroupCheap, ord.firstGroups) * 100, 0)}%`, pass: share(odd.firstGroupCheap, odd.firstGroups) > 0.5 && share(odd.firstGroupCheap, odd.firstGroups) > share(ord.firstGroupCheap, ord.firstGroups) };
    case 'duelist':
      return { bar: 'Declines nothing it can pay for; accepts no offer', measured: `${odd.declinedAffordable} declined, ${odd.acceptedAsReceiver} accepted`, pass: odd.declinedAffordable === 0 && odd.acceptedAsReceiver === 0 };
    case 'sky-rush':
      return { bar: "All in's mortgages out of debt; Blocker's refusals", measured: `${f(per(odd, 'mortgagesOutOfDebt'))} against ${f(per(ord, 'mortgagesOutOfDebt'))}; ${odd.completionsSold} completions sold`, pass: odd.mortgagesOutOfDebt > ord.mortgagesOutOfDebt && odd.completionsSold === 0 };
    case 'iron-bank':
      return {
        bar: "Refuser's answers; Pass baron's passes; Hoarder's cash",
        measured: `${odd.acceptedAsReceiver} accepted; passes ${f(at20(odd, 'passesAt20'))} against ${f(at20(ord, 'passesAt20'))}; cash ${f(at20(odd, 'cashAt20'), 0)} against ${f(at20(ord, 'cashAt20'), 0)}`,
        pass: odd.acceptedAsReceiver === 0 && at20(odd, 'passesAt20') > at20(ord, 'passesAt20') && at20(odd, 'cashAt20') > at20(ord, 'cashAt20'),
      };
    case 'opportunist':
      return { bar: 'Three different rules on in most games; less cash and more mortgages', measured: `${f(per(odd, 'rulesOn'), 1)} rules a game; cash ${f(at20(odd, 'cashAt20'), 0)} against ${f(at20(ord, 'cashAt20'), 0)}`, pass: per(odd, 'rulesOn') >= 3 && odd.mortgagesOutOfDebt > ord.mortgagesOutOfDebt };
    case 'baseline':
      return { bar: 'None (the reference point)', measured: '', pass: null };
    default:
      return { bar: 'Not measured by the study', measured: '', pass: null };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && process.argv.includes('--gate')) {
  const files = process.argv[process.argv.indexOf('--gate') + 1].split(',');
  type T = { key: string; tally: { games: number; finished: number; wins: Record<string, number>; styles?: { odd: B; ordinary: B; bankEmpty: number } } };
  const tables: T[] = files.flatMap((f) => (JSON.parse(readFileSync(f, 'utf8')) as { tables: T[] }).tables).filter((t) => t.tally.styles);
  const add = (a: B, b: B): B => {
    const out = { ...a } as B;
    for (const [k, v] of Object.entries(b)) (out as Record<string, unknown>)[k] = Array.isArray(v) ? (v as number[]).map((x, i) => x + ((a[k] as unknown as number[])?.[i] ?? 0)) : (a[k] ?? 0) + (v as number);
    return out;
  };
  const byName = new Map<string, { odd: B; ord: B; games: number; bankEmpty: number; wins: string[] }>();
  for (const t of tables) {
    const name = t.key.replace(/^style-/, '').replace(/-\d$/, '');
    const size = Number(t.key.slice(-1));
    const entry = byName.get(name) ?? { odd: {} as B, ord: {} as B, games: 0, bankEmpty: 0, wins: [] };
    entry.odd = add(entry.odd, t.tally.styles!.odd);
    entry.ord = add(entry.ord, t.tally.styles!.ordinary);
    entry.games += t.tally.games;
    entry.bankEmpty += t.tally.styles!.bankEmpty;
    const w = t.tally.wins[`style:${name}`] / Math.max(1, t.tally.finished);
    entry.wins.push(`${size}p ${(w * 100).toFixed(1)}%`);
    byName.set(name, entry);
  }
  const base = byName.get('baseline');
  const baseBank = base ? base.bankEmpty / base.games : 0;
  // As the plan says, a school is compared with the baseline in the same seat: the baseline as the
  // odd player at the same table sizes. Without a baseline table, with an ordinary seat at its own tables.
  const baselineBySize = new Map<number, { odd: B; games: number }>();
  for (const t of tables) {
    if (!t.key.startsWith('style-baseline-')) continue;
    baselineBySize.set(Number(t.key.slice(-1)), { odd: t.tally.styles!.odd, games: t.tally.games });
  }
  const sizesOf = new Map<string, number[]>();
  for (const t of tables) {
    const name = t.key.replace(/^style-/, '').replace(/-\d$/, '');
    sizesOf.set(name, [...(sizesOf.get(name) ?? []), Number(t.key.slice(-1))]);
  }
  const control = (name: string, fallback: B, games: number): { b: B; games: number } => {
    const sizes = sizesOf.get(name) ?? [];
    if (name === 'baseline' || !sizes.every((n) => baselineBySize.has(n))) return { b: fallback, games };
    let b = {} as B;
    let g = 0;
    for (const n of sizes) {
      b = add(b, baselineBySize.get(n)!.odd);
      g += baselineBySize.get(n)!.games;
    }
    // Scale the control's sums to the school's number of games, so that sums compare as rates.
    const scaled = {} as B;
    for (const [k, v] of Object.entries(b)) (scaled as Record<string, unknown>)[k] = Array.isArray(v) ? (v as number[]).map((x) => (x * games) / g) : ((v as number) * games) / g;
    return { b: scaled, games };
  };
  console.log('| School | Win share as the odd player | Bar | Measured | Passes |');
  console.log('| --- | --- | --- | --- | --- |');
  let passed = 0;
  let judged = 0;
  for (const [name, e] of byName) {
    const c = control(name, e.ord, e.games);
    const r = gateBars(name, e.odd, c.b, e.games, e.bankEmpty / e.games, baseBank);
    if (r.pass !== null) {
      judged += 1;
      if (r.pass) passed += 1;
    }
    console.log(`| ${name} | ${e.wins.join(', ')} | ${r.bar} | ${r.measured} | ${r.pass === null ? 'n/a' : r.pass ? 'yes' : 'no'} |`);
  }
  console.log(`\n${passed} of ${judged} judged bars pass.`);
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && process.argv.includes('--explain')) {
  const name = process.argv[process.argv.indexOf('--explain') + 1];
  const players = Number(process.argv.includes('--size') ? process.argv[process.argv.indexOf('--size') + 1] : 4);
  const seed = Number(process.argv.includes('--seed') ? process.argv[process.argv.indexOf('--seed') + 1] : 1);
  const engine = createEngine(threeKingdoms);
  const holder = { rng: seedFrom(`preset-${name}-${players}-${seed}`) };
  const random = () => nextFloat(holder);
  const ids = Array.from({ length: players }, (_, i) => `p${i + 1}`);
  const agents = new Map<string, SeatAgent>(ids.map((id, i) => [id, presetAgent(i === 0 ? name : 'baseline')]));
  let state = engine.newGame({ players: ids, seed });
  let last = '';
  for (let actions = 0; state.winner === null && actions < 40000; actions++) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(random() * waiting.length)];
    const agent = agents.get(actor) as SeatAgent;
    const action = agent.choose(engine, state, actor, random);
    if (!action) throw new Error('No action.');
    if (actor === 'p1') {
      const on = agent.rules().last.join(', ') || '(none)';
      if (on !== last) console.log(`turn ${state.turn.number}: rules on: ${on}`);
      last = on;
      console.log(`  turn ${state.turn.number} ${JSON.stringify(action)}`);
    }
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
    for (const a of agents.values()) a.observe(result.events, state);
  }
  console.log(`Winner: ${state.winner}${state.winner === 'p1' ? ` (${name})` : ''}`);
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && process.argv.includes('--presets')) {
  const games = Number(process.argv[process.argv.indexOf('--presets') + 1]);
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : Object.keys(PRESETS);
  const engine = createEngine(threeKingdoms);
  let failed = false;
  for (const name of only) {
    const preset = PRESETS[name];
    const started = performance.now();
    const line: string[] = [];
    for (const players of preset.sizes) {
      let finished = 0;
      let won = 0;
      for (let seed = 1; seed <= games; seed++) {
        const result = playPreset(engine, name, players, seed);
        if (result.problem) {
          console.log(`PROBLEM: ${result.problem}`);
          failed = true;
          break;
        }
        if (result.finished) finished += 1;
        if (result.won) won += 1;
      }
      line.push(`${players}p ${finished}/${games} finished, won ${won}`);
    }
    console.log(`${name}: ${line.join('; ')} (${((performance.now() - started) / 1000).toFixed(0)} s)`);
  }
  process.exit(failed ? 1 : 0);
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const at = process.argv.indexOf('--games');
  const games = at === -1 ? 1000 : Number(process.argv[at + 1]);
  const engine = createEngine(threeKingdoms);
  const started = performance.now();
  let total = 0;
  for (const players of [2, 3, 4]) {
    for (let seed = 1; seed <= games; seed++) {
      const { difference, decisions } = compareWithBaseline(engine, players, seed);
      total += decisions;
      if (difference) {
        console.log(`DIFFERENT: ${difference}`);
        process.exit(1);
      }
    }
    console.log(`${players} players: ${games} games identical`);
  }
  console.log(`${total} decisions compared in ${((performance.now() - started) / 1000).toFixed(0)} s. The baseline style is today's agent.`);
}
