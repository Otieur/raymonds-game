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


class SuiteInChecks(unittest.TestCase):
    def test_a_check_with_a_suite_scores_it_and_its_line_is_kept(self):
        import subprocess
        import tempfile
        run = Path(tempfile.mkdtemp())
        cfg = {**training.DEFAULTS, "checks": {"size": 2, "suite": "offers-2.json"}}
        proc = training.start_check(run, cfg, 7)
        self.assertIn("--suite offers-2.json", proc.args)
        proc.kill()
        proc.wait()
        proc.stdout.close()
        lines = "Wrote x.ts\nm (offers by baseline) as the one among 1 baseline, seeds 1 to 2: 50.0% (1.3 to 98.7) of 2 finished games; 0 fallbacks in 9 decisions; 0.1 ms a decision; no refused action.\nsuite m: 60.0% (31.3 to 83.2) of 10 cases answered as measured; pass 3/5, second 3/5\n"
        fake = subprocess.Popen(["printf", "%s", lines], stdout=subprocess.PIPE, text=True)
        fake.wait()
        training.collect_checks(run, [(7, fake)])
        import json
        entry = json.loads((run / "checks.jsonl").read_text().splitlines()[-1])
        self.assertEqual(len(entry["output"]), 2)
        self.assertTrue(entry["output"][1].startswith("suite m: 60.0%"))


class MembersAndChecks(unittest.TestCase):
    def test_members_by_table_size(self):
        by_size = {"2": ["baseline", "refuser"], "4": ["baseline", "statesman-book-2", "statesman-book-2"]}
        cfg = {**training.DEFAULTS, "members": by_size, "workers": 4,
               "games": [{"players": 4, "rules": "short", "share": 0.5}, {"players": 2, "rules": "full", "share": 0.5}]}
        members = training.members_now(cfg, {"selves": []})
        self.assertEqual(members, by_size)
        self.assertEqual(training.members_for(members, 4), by_size["4"])
        self.assertEqual(training.members_for(["baseline"], 3), ["baseline"])
        with self.assertRaises(SystemExit):
            training.members_for(members, 3)
        configs, _ = training.draw_tables(cfg, Book(), np.random.default_rng(1), members)
        for c in configs:
            if "opponents" in c and c["opponents"] and c["opponents"][0]["member"] not in ("baseline",):
                names = [o["member"] for o in c["opponents"]]
                self.assertEqual(names, by_size[str(c["players"])])
        # Past selves join every size's list.
        cfg["past_selves"] = {"every": 200, "newest": 1, "spread": 0}
        self.assertEqual(training.members_now(cfg, {"selves": ["/r/a.ts"]})["2"], ["baseline", "refuser", "model:/r/a.ts"])

    def test_checks_of_a_drafting_run_in_the_short_game(self):
        import tempfile
        cfg = {**training.DEFAULTS, "drafting": {"share": 0.5}, "checks": [{"size": 4, "rules": "short"}, {"size": 2}]}
        proc = training.start_check(Path(tempfile.mkdtemp()), cfg, 3)
        proc.kill()
        proc.wait()
        proc.stdout.close()
        command = proc.args
        self.assertNotIn("--proposer", command)
        self.assertNotIn("--no-proposals", command)
        self.assertEqual(command.count("--rules short"), 1)
        cfg = {**training.DEFAULTS, "checks": {"size": 2}}
        proc = training.start_check(Path(tempfile.mkdtemp()), cfg, 3)
        proc.kill()
        proc.wait()
        proc.stdout.close()
        self.assertIn("--proposer baseline", proc.args)
        self.assertNotIn("--rules", proc.args)


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
