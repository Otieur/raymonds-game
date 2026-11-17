import type { PaymentReason, Pending, PlayerId, Resume } from '../types.ts';
import { mustPlayer } from './queries.ts';
import type { Run } from './run.ts';

export function transfer(
  run: Run,
  from: PlayerId | null,
  to: PlayerId | null,
  amount: number,
  reason: PaymentReason,
): void {
  if (amount === 0) return;
  if (from !== null) {
    const payer = mustPlayer(run.s, from);
    if (payer.cash < amount) {
      throw new Error(`Internal error: ${from} cannot cover a transfer of ${amount}.`);
    }
    payer.cash -= amount;
  }
  if (to !== null) mustPlayer(run.s, to).cash += amount;
  run.events.push({ type: 'PAID', from, to, amount, reason });
}

function pushDebt(
  run: Run,
  debtor: PlayerId,
  creditor: PlayerId | null,
  amount: number,
  reason: PaymentReason,
  resume?: Resume,
): void {
  const debt: Pending = { kind: 'debt', debtor, creditor, amount, reason };
  if (resume) debt.resume = resume;
  run.s.pending.push(debt);
}

export function charge(
  run: Run,
  debtor: PlayerId,
  creditor: PlayerId | null,
  amount: number,
  reason: PaymentReason,
  resume?: Resume,
): boolean {
  if (amount <= 0) return true;
  if (mustPlayer(run.s, debtor).cash >= amount) {
    transfer(run, debtor, creditor, amount, reason);
    return true;
  }
  run.events.push({ type: 'DEBT_INCURRED', debtor, creditor, amount, reason });
  pushDebt(run, debtor, creditor, amount, reason, resume);
  return false;
}

export interface Charge {
  debtor: PlayerId;
  creditor: PlayerId | null;
  amount: number;
}

export function chargeAll(run: Run, charges: Charge[], reason: PaymentReason): void {
  const unpaid: Charge[] = [];
  for (const item of charges) {
    if (item.amount <= 0) continue;
    if (mustPlayer(run.s, item.debtor).cash >= item.amount) {
      transfer(run, item.debtor, item.creditor, item.amount, reason);
    } else {
      run.events.push({ type: 'DEBT_INCURRED', ...item, reason });
      unpaid.push(item);
    }
  }
  for (const item of unpaid.reverse()) {
    pushDebt(run, item.debtor, item.creditor, item.amount, reason);
  }
}
