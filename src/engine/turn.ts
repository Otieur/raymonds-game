import type { Context } from '../context.ts';
import type { GameState, PlayerId, RuleError } from '../types.ts';
import { charge, transfer } from './money.ts';
import { advanceBy, releaseFromJail, rollDice, runResume, sendToJail } from './movement.ts';
import { mustPlayer } from './queries.ts';
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
  return checkTurn(s, playerId, 'preRoll');
}

export function doRoll(run: Run, playerId: PlayerId): void {
  const { ctx, s } = run;
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

function checkJailExit(s: GameState, playerId: PlayerId): RuleError | null {
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
  transfer(run, playerId, null, run.ctx.board.economy.bail, 'bail');
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
  const held = mustPlayer(run.s, playerId).jailCards.shift();
  if (!held) throw new Error('Internal error: no jail card to use.');
  run.s.decks[held.deck].push(held.card);
  releaseFromJail(run, playerId, 'card');
}
