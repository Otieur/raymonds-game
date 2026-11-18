/**
 * Least squares from normal equations, shared by the simulation study and the valuation fit.
 */

/**
 * Fits a linear model of winning by least squares from its normal equations, whose first
 * feature is the constant. Returns each coefficient and its standard error (NaN for a feature
 * that was never non-zero), and the share of the variance in winning that the model explains.
 */
export function fitLinear(xtx: number[], xty: number[], rows: number, wins: number): { beta: number[]; error: number[]; explained: number } {
  const size = xty.length;
  const used = Array.from({ length: size }, (_, i) => i).filter((i) => xtx[i * size + i] > 0);
  const n = used.length;
  // Gauss-Jordan on [A | I], with a trace of ridge to keep it well-conditioned.
  const a = used.map((i, row) => [
    ...used.map((j, column) => xtx[i * size + j] + (row === column ? 1e-9 * rows : 0)),
    ...used.map((_, column) => (row === column ? 1 : 0)),
  ]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const scale = a[column][column];
    for (let k = 0; k < 2 * n; k++) a[column][k] /= scale;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = a[row][column];
      if (factor === 0) continue;
      for (let k = 0; k < 2 * n; k++) a[row][k] -= factor * a[column][k];
    }
  }
  const inverse = a.map((row) => row.slice(n));
  const solved = inverse.map((row) => row.reduce((sum, value, j) => sum + value * xty[used[j]], 0));
  const fitted = solved.reduce((sum, value, j) => sum + value * xty[used[j]], 0);
  const variance = (wins - fitted) / Math.max(1, rows - n);
  const centre = (wins * wins) / rows;

  const beta = new Array<number>(size).fill(Number.NaN);
  const error = new Array<number>(size).fill(Number.NaN);
  used.forEach((feature, j) => {
    beta[feature] = solved[j];
    error[feature] = Math.sqrt(Math.max(0, variance * inverse[j][j]));
  });
  return { beta, error, explained: (fitted - centre) / (wins - centre) };
}
