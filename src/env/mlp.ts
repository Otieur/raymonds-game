/**
 * The network's forward pass in TypeScript: three dense layers with ReLU, a policy head and a value
 * head. The weights come from a module written by train/export.py, as 16-bit floats in base64.
 */
import { ACTIONS, ACTIONS_VERSION } from './actions.ts';
import { OBS_SIZE, OBS_VERSION } from './observe.ts';

export interface ModelWeights {
  name: string;
  obsVersion: number;
  actionsVersion: number;
  /** [inputs, outputs] of each layer: three trunk layers, the policy head, the value head. */
  shapes: [number, number][];
  data: string;
}

export interface Mlp {
  name: string;
  /** Policy logits over the 188 actions (not masked) and the value head's three outputs. */
  forward(input: Float32Array): { policy: Float32Array; value: Float32Array };
}

/** One IEEE half-precision float, from its 16 bits. */
function half(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/** Little-endian half floats from base64, decoded without Node's Buffer so that browsers can run it. */
function halves(base64: string): Float32Array {
  const text = atob(base64);
  const out = new Float32Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = half(text.charCodeAt(2 * i) | (text.charCodeAt(2 * i + 1) << 8));
  return out;
}

export function createMlp(weights: ModelWeights): Mlp {
  if (weights.obsVersion !== OBS_VERSION || weights.actionsVersion !== ACTIONS_VERSION) {
    throw new Error(`Model ${weights.name} was trained on observation version ${weights.obsVersion} and action version ${weights.actionsVersion}; this build uses ${OBS_VERSION} and ${ACTIONS_VERSION}.`);
  }
  if (weights.shapes[0][0] !== OBS_SIZE || weights.shapes[3][1] !== ACTIONS) throw new Error(`Model ${weights.name} has the wrong input or output size.`);
  const all = halves(weights.data);
  let at = 0;
  const layers = weights.shapes.map(([inputs, outputs]) => {
    const w = all.subarray(at, at + inputs * outputs);
    at += inputs * outputs;
    const b = all.subarray(at, at + outputs);
    at += outputs;
    return { inputs, outputs, w, b };
  });
  if (at !== all.length) throw new Error(`Model ${weights.name} has ${all.length} numbers, expected ${at}.`);
  const dense = (layer: (typeof layers)[number], x: Float32Array, relu: boolean): Float32Array => {
    const y = new Float32Array(layer.outputs);
    for (let o = 0; o < layer.outputs; o++) {
      let sum = layer.b[o];
      const row = o * layer.inputs;
      for (let i = 0; i < layer.inputs; i++) sum += layer.w[row + i] * x[i];
      y[o] = relu && sum < 0 ? 0 : sum;
    }
    return y;
  };
  return {
    name: weights.name,
    forward(input: Float32Array) {
      let h = dense(layers[0], input, true);
      h = dense(layers[1], h, true);
      h = dense(layers[2], h, true);
      return { policy: dense(layers[3], h, false), value: dense(layers[4], h, false) };
    },
  };
}
