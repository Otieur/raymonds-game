"""The tables a learner is given, and the schedules of a run."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from opponents import KINDS, SHARES, Book, sample_kind, table_config  # noqa: E402
from run import DEFAULTS, draw_tables, falling, schedules  # noqa: E402


class Tables(unittest.TestCase):
    def test_the_four_kinds_of_table_come_up_in_their_shares(self):
        rng = np.random.default_rng(5)
        drawn = [sample_kind(rng) for _ in range(1000)]
        for kind, share in zip(KINDS, SHARES):
            self.assertLess(abs(drawn.count(kind) / 1000 - share), 0.03, kind)

    def test_a_member_the_learner_seldom_beats_is_met_more_often(self):
        book = Book()
        for _ in range(100):
            book.record({"result": [1, 0, 0, 0], "learners": [0], "members": ["learner", "easy", "easy", "easy"]})
            book.record({"result": [0, 1, 0, 0], "learners": [0], "members": ["learner", "hard", "hard", "hard"]})
        self.assertEqual(book.share("easy"), 1.0)
        self.assertEqual(book.share("hard"), 0.0)
        self.assertAlmostEqual(book.weight("easy"), 0.02)
        self.assertAlmostEqual(book.weight("hard"), 1.02)
        self.assertEqual(book.share("never met"), 0.5)
        # A cut-off game is no result for anybody.
        before = len(book.results["easy"])
        book.record({"result": [0, 0, 0, 0], "learners": [0], "members": ["learner", "easy", "easy", "easy"]})
        self.assertEqual(len(book.results["easy"]), before)

    def test_only_the_latest_five_hundred_games_count(self):
        book = Book()
        for _ in range(600):
            book.record({"result": [0, 1], "learners": [0], "members": ["learner", "m"]})
        for _ in range(500):
            book.record({"result": [1, 0], "learners": [0], "members": ["learner", "m"]})
        self.assertEqual(book.share("m"), 1.0)

    def test_each_kind_of_table_seats_the_right_opponents(self):
        book = Book()
        base = {"players": 4, "rules": "full"}
        self.assertEqual(table_config("baselines", base, 4, ["a", "b"], book, None)["opponents"], [{"member": "baseline", "weight": 1}])
        self.assertEqual(table_config("self", base, 4, ["a", "b"], book, None)["learners"], 4)
        self.assertEqual(table_config("holder", base, 4, ["a", "b"], book, "main-4-holder")["opponents"][0]["member"], "main-4-holder")
        league = table_config("league", base, 4, ["a", "b"], book, None)["opponents"]
        self.assertEqual([o["member"] for o in league], ["a", "b"])
        self.assertTrue(all(o["weight"] > 0 for o in league))

    def test_a_worker_is_given_a_game_and_a_kind(self):
        cfg = {**DEFAULTS, "workers": 8, "games": [{"players": 4, "rules": "short", "share": 0.8}, {"players": 2, "rules": "full", "share": 0.2}]}
        configs, labels = draw_tables(cfg, Book(), np.random.default_rng(1))
        self.assertEqual(len(configs), 8)
        for config in configs:
            self.assertIn((config["players"], config["rules"]), [(4, "short"), (2, "full")])
            self.assertFalse(config["drafting"])
            self.assertEqual(config["proposer"], "baseline")
        self.assertEqual(len(labels), 8)


class Schedules(unittest.TestCase):
    def test_a_falling_value(self):
        self.assertEqual(falling(1.0, 0.2, 0.0), 1.0)
        self.assertAlmostEqual(falling(1.0, 0.2, 0.1), 0.5)
        self.assertEqual(falling(1.0, 0.2, 0.5), 0.0)
        self.assertAlmostEqual(falling(0.01, 1.0, 0.5, 0.001), 0.0055)

    def test_the_last_stretch_of_a_run_is_trained_on_the_result_alone(self):
        cfg = {**DEFAULTS, "start": "somewhere"}
        opening = schedules(cfg, 0.0)
        self.assertEqual(opening["weights"][0], 1.0)
        self.assertTrue(all(abs(w - 0.2) < 1e-12 for w in opening["weights"][1:]))
        self.assertEqual(opening["kappa"], 1.0)
        middle = schedules(cfg, 0.35)
        self.assertAlmostEqual(middle["weights"][0], 0.5)
        self.assertEqual(middle["weights"][1], 0.0)
        self.assertEqual(middle["kappa"], 0.0)
        late = schedules(cfg, 0.8)
        self.assertEqual(late["weights"], [0.0] * len(cfg["potentials"]))
        self.assertAlmostEqual(late["lr"], cfg["lr"] * 0.2)
        # Without a starting policy there is nothing to stay near.
        self.assertEqual(schedules(DEFAULTS, 0.0)["kappa"], 0.0)


if __name__ == "__main__":
    unittest.main()
