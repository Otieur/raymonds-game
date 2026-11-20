/**
 * The network's forward pass in TypeScript: three dense layers with ReLU, a policy head and a value
 * head. The weights come from a module written by train/export.py, as 16-bit floats in base64.
 *
 * A model of observation version 3 and action version 2 is widened as it loads: zero weights on the
 * six inputs that version 4 appends, and zero rows for the three actions that version 3 appends. It
 * then plays exactly as before wherever the new actions are not offered (drafting off).
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
  /** Policy logits over the 191 actions (not masked) and the value head's three outputs. */
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

/** The sizes of the versions a model may have been trained on, and that this build can widen. */
const WIDENABLE = { obsVersion: 3, actionsVersion: 2, inputs: 1023, actions: 188 };

export function createMlp(weights: ModelWeights): Mlp {
  const current = weights.obsVersion === OBS_VERSION && weights.actionsVersion === ACTIONS_VERSION;
  const older = weights.obsVersion === WIDENABLE.obsVersion && weights.actionsVersion === WIDENABLE.actionsVersion;
  if (!current && !older) {
    throw new Error(`Model ${weights.name} was trained on observation version ${weights.obsVersion} and action version ${weights.actionsVersion}; this build uses ${OBS_VERSION} and ${ACTIONS_VERSION}.`);
  }
  const [inputs, actions] = current ? [OBS_SIZE, ACTIONS] : [WIDENABLE.inputs, WIDENABLE.actions];
  if (weights.shapes[0][0] !== inputs || weights.shapes[3][1] !== actions) throw new Error(`Model ${weights.name} has the wrong input or output size.`);
  const all = halves(weights.data);
  let at = 0;
  let layers = weights.shapes.map(([inputs, outputs]) => {
    const w = all.subarray(at, at + inputs * outputs);
    at += inputs * outputs;
    const b = all.subarray(at, at + outputs);
    at += outputs;
    return { inputs, outputs, w, b };
  });
  if (at !== all.length) throw new Error(`Model ${weights.name} has ${all.length} numbers, expected ${at}.`);
  if (older) layers = widen(layers);
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
      if (input.length !== OBS_SIZE) throw new Error(`The observation has ${input.length} numbers, not ${OBS_SIZE}.`);
      let h = dense(layers[0], input, true);
      h = dense(layers[1], h, true);
      h = dense(layers[2], h, true);
      return { policy: dense(layers[3], h, false), value: dense(layers[4], h, false) };
    },
  };
}

type Layer = { inputs: number; outputs: number; w: Float32Array; b: Float32Array };

/** Widens a model of the older versions: zero weights for the appended inputs, zero rows for the appended actions. */
function widen(layers: Layer[]): Layer[] {
  const out = [...layers];
  const first = layers[0];
  const w0 = new Float32Array(first.outputs * OBS_SIZE);
  for (let o = 0; o < first.outputs; o++) w0.set(first.w.subarray(o * first.inputs, (o + 1) * first.inputs), o * OBS_SIZE);
  out[0] = { inputs: OBS_SIZE, outputs: first.outputs, w: w0, b: first.b };
  const policy = layers[3];
  const w3 = new Float32Array(ACTIONS * policy.inputs);
  w3.set(policy.w);
  const b3 = new Float32Array(ACTIONS);
  b3.set(policy.b);
  out[3] = { inputs: policy.inputs, outputs: ACTIONS, w: w3, b: b3 };
  return out;
}
