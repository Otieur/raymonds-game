/**
 * A conditional logit with weights that move in straight lines between knot rounds: each seat of a
 * snapshot gets a score, a weighted sum of its features, and its chance of winning is its share of
 * exp(score) among the seats of that snapshot. Fitted by L-BFGS on the penalized negative
 * log-likelihood. Used by `scripts/fit-valuation.ts`.
 */

/** Snapshots grouped into seat rows. */
export interface Grouped {
  start: Int32Array;
  count: Int8Array;
  winner: Int8Array;
  round: Int16Array;
  seatRows: number;
}

/** Which knots a round falls between, and how far along. */
export function knotOf(knots: readonly number[], round: number): { k: number; t: number } {
  if (round <= knots[0]) return { k: 0, t: 0 };
  const last = knots.length - 1;
  if (round >= knots[last]) return { k: last - 1, t: 1 };
  let k = 0;
  while (round > knots[k + 1]) k++;
  return { k, t: (round - knots[k]) / (knots[k + 1] - knots[k]) };
}

export interface Features {
  values: Float32Array;
  width: number;
  offset: number;
}


/** The penalized negative log-likelihood per snapshot over `rows`, and its gradient. */
export function objective(
  knots: readonly number[],
  data: Grouped,
  feats: Features,
  fw: number,
  rows: Int32Array,
  w: Float64Array,
  lambda: number,
  mu: number,
): { value: number; grad: Float64Array } {
  const K = knots.length;
  const grad = new Float64Array(K * fw);
  // Weights in force at each round seen, and the gradient with respect to them.
  const byRound = new Map<number, { wr: Float64Array; gr: Float64Array; k: number; t: number }>();
  const forRound = (r: number) => {
    let entry = byRound.get(r);
    if (!entry) {
      const { k, t } = knotOf(knots, r);
      const wr = new Float64Array(fw);
      for (let f = 0; f < fw; f++) wr[f] = (1 - t) * w[k * fw + f] + t * w[(k + 1) * fw + f];
      entry = { wr, gr: new Float64Array(fw), k, t };
      byRound.set(r, entry);
    }
    return entry;
  };
  const scores = new Float64Array(8);
  let nll = 0;
  const { values, width, offset } = feats;
  for (let n = 0; n < rows.length; n++) {
    const s = rows[n];
    const { wr, gr } = forRound(data.round[s]);
    const first = data.start[s];
    const c = data.count[s];
    let top = -Infinity;
    for (let i = 0; i < c; i++) {
      const base = (first + i) * width + offset;
      let score = 0;
      for (let f = 0; f < fw; f++) score += values[base + f] * wr[f];
      scores[i] = score;
      if (score > top) top = score;
    }
    let sum = 0;
    for (let i = 0; i < c; i++) {
      scores[i] = Math.exp(scores[i] - top);
      sum += scores[i];
    }
    const win = data.winner[s];
    nll -= Math.log(scores[win] / sum);
    for (let i = 0; i < c; i++) {
      const delta = scores[i] / sum - (i === win ? 1 : 0);
      if (delta === 0) continue;
      const base = (first + i) * width + offset;
      for (let f = 0; f < fw; f++) gr[f] += delta * values[base + f];
    }
  }
  for (const { gr, k, t } of byRound.values()) {
    for (let f = 0; f < fw; f++) {
      grad[k * fw + f] += (1 - t) * gr[f];
      grad[(k + 1) * fw + f] += t * gr[f];
    }
  }
  let penalty = 0;
  for (let i = 0; i < w.length; i++) {
    penalty += lambda * w[i] * w[i];
    grad[i] += 2 * lambda * w[i];
  }
  for (let f = 0; f < fw; f++) {
    for (let k = 1; k < K - 1; k++) {
      const d = w[(k + 1) * fw + f] - 2 * w[k * fw + f] + w[(k - 1) * fw + f];
      penalty += mu * d * d;
      grad[(k + 1) * fw + f] += 2 * mu * d;
      grad[k * fw + f] -= 4 * mu * d;
      grad[(k - 1) * fw + f] += 2 * mu * d;
    }
  }
  const scale = 1 / rows.length;
  for (let i = 0; i < grad.length; i++) grad[i] *= scale;
  return { value: (nll + penalty) * scale, grad };
}

/** Minimizes by L-BFGS with a backtracking line search. */
export function lbfgs(f: (w: Float64Array) => { value: number; grad: Float64Array }, start: Float64Array, maxIterations = 400): Float64Array {
  const m = 10;
  let w: Float64Array = Float64Array.from(start);
  const first = f(w);
  let value = first.value;
  let grad: Float64Array = first.grad;
  const ss: Float64Array[] = [];
  const ys: Float64Array[] = [];
  const dot = (a: Float64Array, b: Float64Array) => {
    let total = 0;
    for (let i = 0; i < a.length; i++) total += a[i] * b[i];
    return total;
  };
  let calm = 0;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Two-loop recursion for the search direction.
    const q = Float64Array.from(grad);
    const alphas: number[] = [];
    for (let i = ss.length - 1; i >= 0; i--) {
      const rho = 1 / dot(ys[i], ss[i]);
      const alpha = rho * dot(ss[i], q);
      alphas[i] = alpha;
      for (let j = 0; j < q.length; j++) q[j] -= alpha * ys[i][j];
    }
    const gamma = ss.length > 0 ? dot(ss[ss.length - 1], ys[ys.length - 1]) / dot(ys[ys.length - 1], ys[ys.length - 1]) : 1 / Math.max(1e-12, Math.sqrt(dot(grad, grad)));
    for (let j = 0; j < q.length; j++) q[j] *= gamma;
    for (let i = 0; i < ss.length; i++) {
      const rho = 1 / dot(ys[i], ss[i]);
      const beta = rho * dot(ys[i], q);
      for (let j = 0; j < q.length; j++) q[j] += ss[i][j] * (alphas[i] - beta);
    }
    const direction = q.map((v) => -v);
    let slope = dot(grad, direction);
    if (slope >= 0) {
      // Not a descent direction: restart from the gradient.
      ss.length = 0;
      ys.length = 0;
      for (let j = 0; j < direction.length; j++) direction[j] = -grad[j];
      slope = dot(grad, direction);
    }
    let step = 1;
    let next: Float64Array;
    let result: { value: number; grad: Float64Array };
    for (;;) {
      next = w.map((v, j) => v + step * direction[j]);
      result = f(next);
      if (result.value <= value + 1e-4 * step * slope || step < 1e-10) break;
      step *= 0.5;
    }
    const s = next.map((v, j) => v - w[j]);
    const y = result.grad.map((v, j) => v - grad[j]);
    if (dot(s, y) > 1e-12) {
      ss.push(s);
      ys.push(y);
      if (ss.length > m) {
        ss.shift();
        ys.shift();
      }
    }
    const improvement = value - result.value;
    w = next;
    value = result.value;
    grad = result.grad;
    calm = improvement < 1e-9 ? calm + 1 : 0;
    if (calm >= 3 || Math.sqrt(dot(grad, grad)) < 1e-7) break;
  }
  return w;
}

/** Chances of every seat row of the given snapshots under weights w. */
export function chances(knots: readonly number[], data: Grouped, feats: Features, fw: number, rows: Int32Array, w: Float64Array): Float64Array {
  const out = new Float64Array(data.seatRows);
  const { values, width, offset } = feats;
  for (let n = 0; n < rows.length; n++) {
    const s = rows[n];
    const { k, t } = knotOf(knots, data.round[s]);
    const first = data.start[s];
    const c = data.count[s];
    let top = -Infinity;
    const scores: number[] = [];
    for (let i = 0; i < c; i++) {
      const base = (first + i) * width + offset;
      let score = 0;
      for (let f = 0; f < fw; f++) score += values[base + f] * ((1 - t) * w[k * fw + f] + t * w[(k + 1) * fw + f]);
      scores.push(score);
      top = Math.max(top, score);
    }
    const exp = scores.map((v) => Math.exp(v - top));
    const sum = exp.reduce((a, b) => a + b, 0);
    for (let i = 0; i < c; i++) out[first + i] = exp[i] / sum;
  }
  return out;
}
