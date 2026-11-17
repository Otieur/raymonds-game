import type { Context } from '../context.ts';
import type { ErrorCode, GameEvent, GameState, RuleError } from '../types.ts';

export interface Run {
  readonly ctx: Context;
  readonly s: GameState;
  readonly events: GameEvent[];
}

export function fail(code: ErrorCode, message: string): RuleError {
  return { code, message };
}
