/**
 * "What an opponent is doing" (M10): the rules a playbook opponent had on at its last decision, as a word
 * or two beside its seat. Shown only when the player turns it on. Words are kept per playbook, since one
 * rule name can mean different things in two playbooks ("ahead" refuses deals for the Opportunist and
 * courts the weak for the Statesman).
 *
 * Kept free of the browser so that the tests can run it.
 */
import type { Label } from '../../../src/sim/opponents.ts';

/** The words for each rule, by the preset whose playbook has it. */
export const INTENT_WORDS: Record<string, Record<string, Label>> = {
  opportunist: {
    opening: { zh: '圈地', en: 'buying up land' },
    'build out': { zh: '大兴土木', en: 'building out' },
    'under threat': { zh: '存钱防险', en: 'saving for danger' },
    'frozen table': { zh: '固守不卖', en: 'refusing to sell' },
    'one short': { zh: '重金求地', en: 'paying up for a street' },
    ambush: { zh: '设伏加盖', en: 'building up an ambush' },
    shortage: { zh: '囤积房屋', en: 'hoarding houses' },
    ahead: { zh: '领先自保', en: 'ahead: holding on' },
    behind: { zh: '落后求变', en: 'behind: dealing' },
    'heads up': { zh: '单挑', en: 'heads up' },
  },
  'statesman-book-2': {
    'nobody ahead': { zh: '局势均衡', en: 'an even table' },
    'a rival ahead': { zh: '合纵抗强', en: 'stopping the leader' },
    ahead: { zh: '扶弱收残', en: 'aiding the weak' },
    'ahead and worked against': { zh: '被围求援', en: 'seeking partners' },
  },
};

/**
 * How many rules to name for each playbook. A playbook applies its rules in order, a later one overriding an
 * earlier one, and a rule stays on for a few turns after it fires; so the Statesman's rules, a ladder from
 * "nobody ahead" to "ahead and worked against", are named by the last one on, and the Opportunist's, which
 * mostly change different parts, by the last two.
 */
const NAMED: Record<string, number> = { opportunist: 2, 'statesman-book-2': 1 };

/** The words for an opponent's rules, in `lang`, the later rules first; empty when it has none or none are known. */
export function intentWords(opponentId: string, rules: readonly string[], lang: 'zh' | 'en'): string {
  const preset = opponentId.replace(/^school-/, '');
  const words = INTENT_WORDS[preset];
  if (!words) return '';
  return rules
    .filter((rule) => words[rule])
    .slice(-(NAMED[preset] ?? 1))
    .reverse()
    .map((rule) => words[rule][lang])
    .join(lang === 'zh' ? '·' : ' · ');
}
