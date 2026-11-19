"""Returns and advantages on sequences worked out by hand (step 0b of M6)."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rollout import Collector, gae, result_for, shaped_rewards  # noqa: E402


class Returns(unittest.TestCase):
    def test_result_sums_to_zero_over_a_table(self):
        for players in (2, 3, 4):
            final = [0] * players
            final[1] = 1
            self.assertAlmostEqual(sum(result_for(final, seat) for seat in range(players)), 0.0)
        self.assertEqual(result_for([0, 1, 0, 0], 1), 1.0)
        self.assertAlmostEqual(result_for([0, 1, 0, 0], 0), -1 / 3)

    def test_rewards_of_a_finished_game_by_hand(self):
        # Five decisions, one potential of weight 1, no discount, and a win.
        phi = np.array([[0.2], [0.3], [0.5], [0.4], [0.6]])
        rewards = shaped_rewards(phi, np.array([1.0]), 1.0, 1.0)
        np.testing.assert_allclose(rewards, [0.1, 0.2, -0.1, 0.2, 0.4])
        # The shaping terms sum to minus the first potential, whatever happened in between.
        self.assertAlmostEqual(rewards.sum(), 1.0 - 0.2)
        # With a discount each step counts the next potential a little less.
        discounted = shaped_rewards(phi, np.array([1.0]), 0.9, 1.0)
        np.testing.assert_allclose(discounted, [0.9 * 0.3 - 0.2, 0.9 * 0.5 - 0.3, 0.9 * 0.4 - 0.5, 0.9 * 0.6 - 0.4, 0.4])

    def test_two_potentials_are_weighted(self):
        phi = np.array([[0.2, 1.0], [0.4, 0.0]])
        rewards = shaped_rewards(phi, np.array([1.0, 0.5]), 1.0, -1.0)
        np.testing.assert_allclose(rewards, [(0.4 + 0.0) - (0.2 + 0.5), -0.4 - 1.0])

    def test_an_open_sequence_has_no_reward_for_its_last_decision(self):
        phi = np.array([[0.2], [0.3], [0.5]])
        np.testing.assert_allclose(shaped_rewards(phi, np.array([1.0]), 1.0, None), [0.1, 0.2])

    def test_advantages_by_hand(self):
        rewards = np.array([0.1, 0.2, -0.1, 0.2, 0.4])
        zeros = np.zeros(5)
        advantages, returns = gae(rewards, zeros, 0.0, 1.0, 1.0)
        np.testing.assert_allclose(advantages, [0.8, 0.7, 0.5, 0.6, 0.4])
        np.testing.assert_allclose(returns, advantages)
        # With a critic: delta_t = r_t + V_{t+1} - V_t, and with lambda 0 the advantage is the one-step error.
        values = np.array([0.5, 0.6, 0.4, 0.5, 0.3])
        one_step, _ = gae(rewards, values, 0.0, 1.0, 0.0)
        np.testing.assert_allclose(one_step, [0.1 + 0.6 - 0.5, 0.2 + 0.4 - 0.6, -0.1 + 0.5 - 0.4, 0.2 + 0.3 - 0.5, 0.4 + 0.0 - 0.3])
        # A sequence closed on the critic's value: the bootstrap stands in for everything after.
        cut, _ = gae(np.array([0.1, 0.2]), np.array([0.5, 0.6]), 0.7, 1.0, 1.0)
        np.testing.assert_allclose(cut, [0.1 + 0.2 + 0.7 - 0.5, 0.2 + 0.7 - 0.6])


class Collecting(unittest.TestCase):
    def fill(self, collector, env, seat, count):
        for t in range(count):
            collector.add(env, seat, np.full(3, t, dtype=np.float32), np.ones(4, dtype=bool), t % 4, -1.0, 0.1 * t, np.array([0.1 * (t + 1)]), 0)

    def test_a_finished_game_closes_every_decision(self):
        collector = Collector(np.array([1.0]), gamma=1.0, lam=1.0)
        self.fill(collector, 0, 1, 5)
        collector.finish(0, {"result": [0, 1], "learners": [1]}, False)
        data = collector.take()
        self.assertEqual(len(data["action"]), 5)
        # Returns are what was still to come: the result less the potential at each decision, since values enter and leave.
        np.testing.assert_allclose(data["returns"], [1 - 0.1, 1 - 0.2, 1 - 0.3, 1 - 0.4, 1 - 0.5], atol=1e-6)
        self.assertEqual(collector.results, [1.0])
        self.assertEqual(collector.open, {})

    def test_a_cut_off_game_drops_its_last_decision_and_stands_on_the_critic(self):
        collector = Collector(np.array([1.0]), gamma=1.0, lam=1.0)
        self.fill(collector, 0, 0, 4)
        collector.finish(0, {"result": [0, 0], "learners": [0]}, True)
        data = collector.take()
        self.assertEqual(len(data["action"]), 3)
        # The last return kept is the reward between decisions 2 and 3 plus the critic's value at decision 3.
        self.assertAlmostEqual(float(data["returns"][-1]), 0.1 + 0.3, places=6)
        self.assertEqual(collector.results, [])

    def test_a_sequence_open_at_an_update_holds_its_last_decision_over(self):
        collector = Collector(np.array([1.0]), gamma=1.0, lam=1.0)
        self.fill(collector, 3, 0, 4)
        collector.cut()
        self.assertEqual(collector.ready(), 3)
        self.assertEqual(len(collector.open[(3, 0)]), 1)
        first = collector.take()
        # The game then ends: the held decision opens the next stretch and is trained on then.
        collector.add(3, 0, np.zeros(3, dtype=np.float32), np.ones(4, dtype=bool), 0, -1.0, 0.0, np.array([0.9]), 0)
        collector.finish(3, {"result": [1, 0], "learners": [0]}, False)
        second = collector.take()
        self.assertEqual(len(first["action"]) + len(second["action"]), 5)
        np.testing.assert_allclose(second["obs"][0], np.full(3, 3.0))


if __name__ == "__main__":
    unittest.main()
