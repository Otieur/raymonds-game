"""The learner's own offers in training (M9, task 3): the share of turns it drafts, and the loss on draft decisions."""
import sys
import unittest
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import run as training  # noqa: E402
from model import ACTIONS, OBS_SIZE, Net  # noqa: E402
from opponents import Book  # noqa: E402
from ppo import DRAFT_FROM, PpoConfig, draft_decisions, losses  # noqa: E402


class Schedule(unittest.TestCase):
    def test_the_share_of_turns_drafted(self):
        cfg = {**training.DEFAULTS}
        self.assertEqual(training.draft_share(cfg, 0.5), 0.0)
        cfg["drafting"] = {"share": 0.5}
        self.assertEqual(training.draft_share(cfg, 0.9), 0.5)
        cfg["drafting"] = {"share": 0.5, "then": 1.0, "at": 0.3}
        self.assertEqual(training.draft_share(cfg, 0.29), 0.5)
        self.assertEqual(training.draft_share(cfg, 0.3), 1.0)

    def test_a_config_written_before_drafting_still_schedules(self):
        cfg = {k: v for k, v in training.DEFAULTS.items() if k not in ("drafting", "pull", "kappa_draft", "draft_entropy")}
        now = training.schedules(cfg, 0.2)
        self.assertEqual((now["draft_share"], now["kappa_draft"]), (0.0, 0.0))

    def test_the_pull_falls_to_zero(self):
        cfg = {**training.DEFAULTS, "pull": "/weights.pt", "kappa_draft": {"start": 1.0, "until": 0.5}}
        self.assertAlmostEqual(training.schedules(cfg, 0.0)["kappa_draft"], 1.0)
        self.assertAlmostEqual(training.schedules(cfg, 0.25)["kappa_draft"], 0.5)
        self.assertEqual(training.schedules(cfg, 0.6)["kappa_draft"], 0.0)

    def test_tables_draft_only_when_the_share_is_above_zero(self):
        cfg = {**training.DEFAULTS, "workers": 2}
        configs, _ = training.draw_tables(cfg, Book(), np.random.default_rng(0), share=0.0)
        self.assertTrue(all(not c["drafting"] and "draftShare" not in c for c in configs))
        configs, _ = training.draw_tables(cfg, Book(), np.random.default_rng(0), share=0.5)
        self.assertTrue(all(c["drafting"] and c["draftShare"] == 0.5 for c in configs))


class DraftLoss(unittest.TestCase):
    def batch(self):
        torch.manual_seed(0)
        mask = torch.zeros(4, ACTIONS, dtype=torch.bool)
        mask[:, 0:3] = True  # rolling, ending the turn, paying bail
        mask[2:, DRAFT_FROM + 5] = True  # rows 2 and 3 may start an offer
        return {
            "obs": torch.randn(4, OBS_SIZE), "mask": mask, "action": torch.zeros(4, dtype=torch.long), "logp": torch.full((4,), -1.0),
            "advantage": torch.zeros(4), "returns": torch.zeros(4), "kind": torch.zeros(4, dtype=torch.long),
        }

    def test_draft_decisions_are_those_where_drafting_is_legal(self):
        self.assertEqual(draft_decisions(self.batch()["mask"]).tolist(), [False, False, True, True])

    def test_the_entropy_bonus_is_scaled_on_draft_decisions(self):
        net, batch = Net(), self.batch()
        one = losses(net, batch, PpoConfig(entropy=1.0, draft_entropy=1.0, value_weight=0.0))["total"]
        two = losses(net, batch, PpoConfig(entropy=1.0, draft_entropy=2.0, value_weight=0.0))["total"]
        self.assertLess(float(two), float(one))  # a larger bonus lowers the loss

    def test_the_pull_reads_draft_decisions_only(self):
        torch.manual_seed(1)
        net, pull, batch = Net(), Net(), self.batch()
        out = losses(net, batch, PpoConfig(kappa_draft=1.0), pull=pull)
        self.assertIn("kl_draft", out)
        batch["mask"][:, DRAFT_FROM:] = False
        self.assertNotIn("kl_draft", losses(net, batch, PpoConfig(kappa_draft=1.0), pull=pull))


if __name__ == "__main__":
    unittest.main()
