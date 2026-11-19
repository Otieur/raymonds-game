import type { Context } from '../context.ts';
import type { Dice, GameState, OpeningState, Pending, PlayerId, RuleError } from '../types.ts';
import { charge, transfer } from './money.ts';
import { advanceBy, releaseFromJail, rollDice, runResume, sendToJail } from './movement.ts';
import { mustPlayer, topPending } from './queries.ts';
import { fail } from './run.ts';
import type { Run } from './run.ts';

function checkTurn(s: GameState, playerId: PlayerId, phase: 'preRoll' | 'postRoll'): RuleError | null {
  if (s.pending.length > 0) {
    return fail('DECISION_PENDING', 'Another decision must be resolved first.');
  }
  if (s.turn.player !== playerId) return fail('NOT_YOUR_TURN', `It is ${s.turn.player}'s turn.`);
  if (s.turn.phase !== phase) {
    return fail(
      'WRONG_PHASE',
      phase === 'preRoll' ? 'There is no roll left this turn.' : 'The dice must be rolled first.',
    );
  }
  return null;
}

export function checkRoll(s: GameState, playerId: PlayerId): RuleError | null {
  if (s.turn.phase === 'order') {
    return s.turn.player === playerId ? null : fail('NOT_YOUR_TURN', `${s.turn.player} rolls next.`);
  }
  return checkTurn(s, playerId, 'preRoll');
}

/** Who throws next in the opening roll: in seat order, the first tied player yet to throw this round. */
function nextOpeningRoller(s: GameState, opening: OpeningState): PlayerId | null {
  const tied = new Set(opening.groups.filter((group) => group.length > 1).flat());
  return s.players.find((p) => tied.has(p.id) && !(p.id in opening.rolls))?.id ?? null;
}

/** One throw of the opening roll. Once a round is complete, ties are split or the order is settled. */
function doOpeningRoll(run: Run, playerId: PlayerId, opening: OpeningState): void {
  const { s } = run;
  const dice = rollDice(run);
  s.turn.lastRoll = [dice[0], dice[1]];
  opening.rolls[playerId] = [dice[0], dice[1]];
  run.events.push({ type: 'DICE_ROLLED', player: playerId, dice: [dice[0], dice[1]], purpose: 'order' });

  const waiting = nextOpeningRoller(s, opening);
  if (waiting !== null) {
    s.turn.player = waiting;
    return;
  }

  const total = (id: PlayerId) => opening.rolls[id][0] + opening.rolls[id][1];
  opening.groups = opening.groups.flatMap((group) => {
    if (group.length === 1) return [group];
    const totals = [...new Set(group.map(total))].sort((a, b) => b - a);
    return totals.map((value) => group.filter((id) => total(id) === value));
  });
  for (const group of opening.groups) {
    if (group.length > 1) run.events.push({ type: 'ORDER_TIED', players: [...group], total: total(group[0]) });
  }
  opening.rolls = {};
  opening.round += 1;

  const again = nextOpeningRoller(s, opening);
  if (again !== null) {
    s.turn.player = again;
    return;
  }

  // Settled: the table sits in the order of play from here on.
  const order = opening.groups.flat();
  s.players.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  s.opening = null;
  s.turn = { player: order[0], number: 1, phase: 'preRoll', doubles: 0, lastRoll: null };
  run.events.push({ type: 'ORDER_DECIDED', order });
  run.events.push({ type: 'TURN_STARTED', player: order[0], turn: 1 });
}

export function doRoll(run: Run, playerId: PlayerId): void {
  const { ctx, s } = run;
  if (s.turn.phase === 'order' && s.opening) {
    doOpeningRoll(run, playerId, s.opening);
    return;
  }
  const player = mustPlayer(s, playerId);
  const dice = rollDice(run);
  const isDouble = dice[0] === dice[1];
  s.turn.lastRoll = [dice[0], dice[1]];

  if (player.inJail) {
    run.events.push({ type: 'DICE_ROLLED', player: playerId, dice: [dice[0], dice[1]], purpose: 'jail' });
    s.turn.phase = 'postRoll';
    if (isDouble) {
      releaseFromJail(run, playerId, 'doubles');
      advanceBy(run, playerId, dice);
      return;
    }
    player.jailRolls += 1;
    run.events.push({ type: 'JAIL_ROLL_FAILED', player: playerId, attempt: player.jailRolls });
    if (player.jailRolls >= ctx.rules.maxJailRolls) {
      if (player.jailCards.length > 0) {
        s.pending.push({ kind: 'jailExit', player: playerId, dice: [dice[0], dice[1]] });
        return;
      }
      const resume = { kind: 'jailMove', dice } as const;
      if (charge(run, playerId, null, ctx.board.economy.bail, 'bail', resume)) {
        runResume(run, playerId, resume);
      }
    }
    return;
  }

  run.events.push({ type: 'DICE_ROLLED', player: playerId, dice: [dice[0], dice[1]], purpose: 'move' });
  if (isDouble) {
    s.turn.doubles += 1;
    if (s.turn.doubles >= ctx.rules.doublesToJail) {
      sendToJail(run, playerId, 'doubles');
      return;
    }
    s.turn.phase = 'preRoll';
  } else {
    s.turn.phase = 'postRoll';
  }
  advanceBy(run, playerId, dice);
}

export function checkEndTurn(s: GameState, playerId: PlayerId): RuleError | null {
  return checkTurn(s, playerId, 'postRoll');
}

export function advanceTurn(run: Run): void {
  const { s } = run;
  const seat = s.players.findIndex((p) => p.id === s.turn.player);
  for (let step = 1; step <= s.players.length; step++) {
    const next = s.players[(seat + step) % s.players.length];
    if (next.bankrupt) continue;
    s.turn = { player: next.id, number: s.turn.number + 1, phase: 'preRoll', doubles: 0, lastRoll: null };
    run.events.push({ type: 'TURN_STARTED', player: next.id, turn: s.turn.number });
    return;
  }
}

/** The choice left after a final failed jail roll: pay bail or use a card, then move by that roll. */
function forcedExit(s: GameState, playerId: PlayerId): Extract<Pending, { kind: 'jailExit' }> | null {
  const top = topPending(s);
  return top?.kind === 'jailExit' && top.player === playerId ? top : null;
}

function takeForcedExit(run: Run, playerId: PlayerId): Dice | null {
  const exit = forcedExit(run.s, playerId);
  if (!exit) return null;
  run.s.pending.pop();
  return exit.dice;
}

function checkJailExit(s: GameState, playerId: PlayerId): RuleError | null {
  if (forcedExit(s, playerId)) return null;
  const blocked = checkTurn(s, playerId, 'preRoll');
  if (blocked) return blocked;
  if (!mustPlayer(s, playerId).inJail) return fail('NOT_IN_JAIL', `${playerId} is not in jail.`);
  return null;
}

export function checkPayBail(ctx: Context, s: GameState, playerId: PlayerId): RuleError | null {
  const blocked = checkJailExit(s, playerId);
  if (blocked) return blocked;
  if (mustPlayer(s, playerId).cash < ctx.board.economy.bail) {
    return fail('INSUFFICIENT_CASH', `Bail costs ${ctx.board.economy.bail}.`);
  }
  return null;
}

export function doPayBail(run: Run, playerId: PlayerId): void {
  const dice = takeForcedExit(run, playerId);
  transfer(run, playerId, null, run.ctx.board.economy.bail, 'bail');
  if (dice) {
    runResume(run, playerId, { kind: 'jailMove', dice });
    return;
  }
  releaseFromJail(run, playerId, 'bail');
}

export function checkUseJailCard(s: GameState, playerId: PlayerId): RuleError | null {
  const blocked = checkJailExit(s, playerId);
  if (blocked) return blocked;
  if (mustPlayer(s, playerId).jailCards.length === 0) {
    return fail('NO_JAIL_CARD', `${playerId} holds no card that opens the jail.`);
  }
  return null;
}

export function doUseJailCard(run: Run, playerId: PlayerId): void {
  const dice = takeForcedExit(run, playerId);
  const held = mustPlayer(run.s, playerId).jailCards.shift();
  if (!held) throw new Error('Internal error: no jail card to use.');
  run.s.decks[held.deck].push(held.card);
  releaseFromJail(run, playerId, 'card');
  if (dice) advanceBy(run, playerId, dice);
}
