"""The value network's scoring: log loss, calibration, and the interval by games."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from value import bootstrap_difference, calibration, log_loss  # noqa: E402


class Scoring(unittest.TestCase):
    def test_log_loss_by_hand(self):
        np.testing.assert_allclose(log_loss(np.array([0.5, 0.9]), np.array([1.0, 0.0])), [np.log(2), -np.log(0.1)])
        self.assertTrue(np.isfinite(log_loss(np.array([0.0, 1.0]), np.array([1.0, 0.0]))).all())

    def test_calibration_of_a_calibrated_predictor(self):
        rng = np.random.default_rng(0)
        p = rng.random(200_000)
        y = (rng.random(200_000) < p).astype(float)
        rows = calibration(p, y)
        self.assertEqual(len(rows), 10)
        self.assertLess(max(abs(r["predicted"] - r["won"]) for r in rows if r["counted"]), 0.01)
        self.assertEqual(sum(r["n"] for r in rows), 200_000)

    def test_the_interval_is_by_games_and_contains_the_difference(self):
        rng = np.random.default_rng(1)
        games = np.repeat(np.arange(300), 50)
        a = rng.random(len(games)) + 0.1
        b = rng.random(len(games))
        diff, low, high = bootstrap_difference(a, b, games)
        self.assertLess(low, diff)
        self.assertLess(diff, high)
        self.assertGreater(low, 0)


if __name__ == "__main__":
    unittest.main()
