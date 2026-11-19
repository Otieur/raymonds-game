/**
 * What a playbook can see of a position: one number for each signal, for the seat that decides.
 */
import type { Engine } from '../engine/engine.ts';
import { buildingStep, ownsGroup } from '../engine/queries.ts';
import type { GameState, PlayerId } from '../types.ts';
import { duesInReach, holds, nearSets, reachRoll, viewOf, wanted } from './measures.ts';
import { distressOf, isFailing, threatOf } from './deal.ts';
import { shunnedShare } from './relations.ts';
import { BASELINE } from './style.ts';
import { contextOf, moodOf } from './style-agent.ts';
import type { StyleMemory } from './style-agent.ts';
import { v1 } from './valuation.ts';

export interface Signals {
  tableSize: number;
  players: number;
  round: number;
  owned: number;
  chance: number;
  rank: number;
  leader: number;
  rentShare: number;
  groups: number;
  unbuilt: number;
  nearSets: number;
  needs: number;
  wanted: number;
  passes: number;
  spare: number;
  danger: number;
  rivalLevel: number;
  rivalNear: number;
  rivalPoor: number;
  bankHouses: number;
  mood: number;
  /** The strongest rival's chance after the one acquisition that would raise it most, over an even share. */
  threat: number;
  /** The seat's chance less the highest rival's, both over an even share. */
  gap: number;
  /** 1 when some rival is failing: a chance under 0.4 of an even share, and short of cash or falling. */
  failing: number;
  /** The share refused of the seat's latest six offers; 0.5 until there are six. */
  shunned: number;
}

export const SIGNAL_NAMES: readonly (keyof Signals)[] = [
  'tableSize', 'players', 'round', 'owned', 'chance', 'rank', 'leader', 'rentShare', 'groups', 'unbuilt', 'nearSets',
  'needs', 'wanted', 'passes', 'spare', 'danger', 'rivalLevel', 'rivalNear', 'rivalPoor', 'bankHouses', 'mood',
  'threat', 'gap', 'failing', 'shunned',
];

/** The signals for `actor`. `moodWindow` is how many of the table's latest offers the mood counts. */
export function signalsOf(engine: Engine, state: GameState, actor: PlayerId, memory: StyleMemory, buildTarget: number, moodWindow = 8): Signals {
  const ctx = contextOf(engine);
  const view = viewOf(ctx, state);
  const seat = state.players.findIndex((p) => p.id === actor);
  const me = state.players[seat];
  const alive = state.players.filter((p) => !p.bankrupt);
  const even = 1 / alive.length;
  const chances = v1(state.players.length).chances(ctx, state);
  const mine = chances[seat];
  const rank = 1 + chances.filter((c, i) => i !== seat && !state.players[i].bankrupt && c > mine).length;
  const leader = Math.max(0, ...chances.filter((_, i) => i !== seat));
  const reach = alive.map((p) => reachRoll(view, p));
  const reachTotal = reach.reduce((a, b) => a + b, 0);
  const myGroups = [...ctx.groups.keys()].filter((group) => ownsGroup(ctx, state, actor, group));
  const stepOf = (group: string) => Math.min(...(ctx.groups.get(group) ?? []).map((sq) => buildingStep(ctx, state.properties[sq.id].level)));
  const rivals = alive.filter((p) => p.id !== actor);
  let rivalLevel = 0;
  for (const sq of ctx.propertyOrder) {
    const owner = state.properties[sq.id].owner;
    if (owner && owner !== actor && sq.kind === 'street') rivalLevel = Math.max(rivalLevel, buildingStep(ctx, state.properties[sq.id].level));
  }
  const rivalNear = rivals.some((p) =>
    myGroups.some((group) =>
      (ctx.groups.get(group) ?? []).some((sq) => {
        const ahead = ((ctx.squareIndex.get(sq.id) ?? 0) - p.position + 40) % 40;
        return ahead >= 2 && ahead <= 12;
      }),
    ),
  );
  const rivalPoor = rivals.some((p) => p.cash < duesInReach(view, p).largest);
  const owned = ctx.propertyOrder.filter((sq) => state.properties[sq.id].owner !== null).length / ctx.propertyOrder.length;
  const dues = duesInReach(view, me).largest;
  const valuation = v1(state.players.length);
  // The two signals that cost several readings of the valuation are worked out only when a rule reads them.
  let threat: number | undefined;
  let failing: number | undefined;
  return {
    tableSize: state.players.length,
    players: alive.length,
    round: (state.turn.number - 1) / state.players.length,
    owned,
    chance: mine / even,
    rank,
    leader: leader / even,
    rentShare: reachTotal > 0 ? reach[alive.indexOf(me)] / reachTotal : 0,
    groups: myGroups.length,
    unbuilt: myGroups.filter((group) => stepOf(group) < buildTarget).length,
    nearSets: nearSets(view, me, false),
    needs: nearSets(view, me, true),
    wanted: wanted(view, me),
    passes: holds(view, 'passes', actor),
    spare: Math.max(0, me.cash - dues) / ctx.board.economy.startingCash,
    danger: me.cash > 0 ? dues / me.cash : dues > 0 ? 10 : 0,
    rivalLevel,
    rivalNear: rivalNear ? 1 : 0,
    rivalPoor: rivalPoor ? 1 : 0,
    bankHouses: state.bank.houses,
    mood: moodOf(memory, moodWindow) ?? 0.5,
    get threat() {
      threat ??= Math.max(0, ...rivals.map((p) => threatOf(ctx, state, p.id, valuation, chances).potential));
      return threat;
    },
    gap: (mine - leader) / even,
    get failing() {
      failing ??= rivals.some((p) => isFailing(distressOf(ctx, state, p.id, valuation, memory.relations.chances[p.id] ?? [], chances), BASELINE.failBelow)) ? 1 : 0;
      return failing;
    },
    shunned: shunnedShare(memory.relations, actor),
  };
}
