"""Branching a run from another run's checkpoint (M7, task 1), and the past selves of the training loop."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import branch  # noqa: E402
import run as training  # noqa: E402
from model import ACTIONS, OBS_SIZE, Net  # noqa: E402
from opponents import Book  # noqa: E402

CHECKS = {"size": 2, "games": 10, "seeds": 2500000, "against": "baseline"}


def make_parent(root: Path) -> Path:
    """A parent run with checkpoints at updates 20 and 40, as run.py would leave them."""
    parent = root / "parent"
    parent.mkdir()
    cfg = {**training.DEFAULTS, "name": "parent", "lr": 3e-4, "critic_warmup": 2_000_000, "checks": CHECKS}
    (parent / "config.json").write_text(json.dumps(cfg))
    for update, seed in ((20, 1), (40, 2)):
        torch.manual_seed(seed)
        net = Net()
        optimizer = torch.optim.Adam(net.parameters(), lr=3e-4)
        logits, value, _ = net(torch.randn(3, OBS_SIZE), torch.ones(3, ACTIONS, dtype=torch.bool))
        (logits.sum() + value.sum()).backward()
        optimizer.step()
        book = Book()
        book.record({"members": ["baseline", "learner"], "result": [0, 1], "learners": [1]})
        state = {"update": update, "decisions": update * 100_000, "games": update * 10, "next_seed": 10_000_000 + update * 5120, "selves": ["/runs/a.ts", "/runs/b.ts"]}
        training.save(parent, net, optimizer, state, book, np.random.default_rng(seed))
    return parent


def load(run: Path) -> dict:
    return torch.load(run / "checkpoints" / "00000.pt", map_location="cpu", weights_only=False)


class Branching(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.parent = make_parent(self.root)
        self.parent_saved = torch.load(self.parent / "checkpoints" / "00040.pt", map_location="cpu", weights_only=False)

    def test_a_branch_keeps_the_weights_and_changes_only_what_it_names(self):
        overlay = {"name": "child", "budget": 150_000_000, "lr": 1e-4}
        cfg = branch.branch(self.parent, overlay, self.root / "child")
        parent_cfg = json.loads((self.parent / "config.json").read_text())
        changed = {key for key in cfg if cfg[key] != parent_cfg.get(key)}
        self.assertEqual(changed, {"name", "budget", "lr", "branch"})
        self.assertEqual(cfg["branch"]["checkpoint"], "00040.pt")
        self.assertEqual(cfg["branch"]["update"], 40)
        saved = load(self.root / "child")
        for key, value in self.parent_saved["net"].items():
            self.assertTrue(torch.equal(saved["net"][key], value), key)
        weights = torch.load(self.root / "child" / "weights.pt", map_location="cpu")
        self.assertTrue(all(torch.equal(weights[k], v) for k, v in self.parent_saved["net"].items()))
        # The optimizer's moments, the book and the past selves go with the weights.
        self.assertEqual(saved["optimizer"]["state"][0]["exp_avg"].tolist(), self.parent_saved["optimizer"]["state"][0]["exp_avg"].tolist())
        self.assertEqual(saved["book"], self.parent_saved["book"])
        self.assertEqual(saved["state"]["selves"], ["/runs/a.ts", "/runs/b.ts"])
        # The branch is a run of its own, and its training seeds follow on from the parent's.
        self.assertEqual((saved["state"]["update"], saved["state"]["decisions"], saved["state"]["games"]), (0, 0, 0))
        self.assertEqual(saved["state"]["next_seed"], self.parent_saved["state"]["next_seed"])

    def test_the_branch_checkpoint_loads_as_run_py_resumes_it(self):
        branch.branch(self.parent, {"name": "child"}, self.root / "child")
        saved = load(self.root / "child")
        self.assertEqual(set(saved), {"net", "optimizer", "state", "book", "rng"})
        net = Net()
        net.load_state_dict(saved["net"])
        optimizer = torch.optim.Adam(net.parameters(), lr=1e-4)
        optimizer.load_state_dict(saved["optimizer"])
        Book().load(saved["book"])
        rng = np.random.default_rng(0)
        rng.bit_generator.state = saved["rng"]
        self.assertEqual(training.latest(self.root / "child").name, "00000.pt")

    def test_resets_and_seeds_named_by_the_file(self):
        branch.branch(self.parent, {"reset": ["optimizer", "book", "selves"], "seeds": 40_000_000}, self.root / "child")
        saved = load(self.root / "child")
        self.assertEqual(saved["optimizer"]["state"], {})
        self.assertEqual(saved["book"], {})
        self.assertEqual(saved["state"]["selves"], [])
        self.assertEqual(saved["state"]["next_seed"], 40_000_000)

    def test_past_selves_from_the_parents_exports(self):
        exports = self.parent / "exports"
        exports.mkdir()
        for update in (20, 200, 220, 400, 600):
            (exports / f"{update:05d}.ts").write_text("export const MODEL = {};\n")
        (exports / "notes.ts").write_text("")
        parent_cfg = json.loads((self.parent / "config.json").read_text())
        saved = torch.load(self.parent / "checkpoints" / "00040.pt", weights_only=False)
        saved["state"]["selves"] = []
        saved["state"]["update"] = 500
        torch.save(saved, self.parent / "checkpoints" / "00500.pt")
        (self.parent / "config.json").write_text(json.dumps(parent_cfg))
        branch.branch(self.parent, {"past_selves": {"every": 200, "newest": 4, "spread": 4, "from_parent": True}}, self.root / "child")
        selves = load(self.root / "child")["state"]["selves"]
        self.assertEqual([Path(p).name for p in selves], ["00200.ts", "00400.ts"])
        # Selves carried from the parent are kept as they are.
        branch.branch(self.parent, {"past_selves": {"every": 200, "from_parent": True}}, self.root / "other", number=40)
        self.assertEqual(load(self.root / "other")["state"]["selves"], ["/runs/a.ts", "/runs/b.ts"])

    def test_a_named_checkpoint(self):
        cfg = branch.branch(self.parent, {}, self.root / "child", number=20)
        self.assertEqual(cfg["branch"]["update"], 20)
        earlier = torch.load(self.parent / "checkpoints" / "00020.pt", map_location="cpu", weights_only=False)
        self.assertTrue(all(torch.equal(load(self.root / "child")["net"][k], v) for k, v in earlier["net"].items()))
        with self.assertRaises(SystemExit):
            branch.branch(self.parent, {}, self.root / "other", number=30)

    def test_refusals(self):
        with self.assertRaises(SystemExit):
            branch.branch(self.parent, {"reset": ["weights"]}, self.root / "child")
        branch.branch(self.parent, {}, self.root / "child")
        with self.assertRaises(SystemExit):
            branch.branch(self.parent, {}, self.root / "child")

    def test_settings_left_to_the_parent_are_named(self):
        cfg = branch.merged_config(json.loads((self.parent / "config.json").read_text()), {"lr": 1e-4})
        self.assertEqual(branch.left_to_parent({"lr": 1e-4}, cfg), ["entropy", "shaping", "kappa", "critic_warmup"])
        cfg = branch.merged_config(json.loads((self.parent / "config.json").read_text()), {"critic_warmup": 0})
        self.assertNotIn("critic_warmup", branch.left_to_parent({"critic_warmup": 0}, cfg))


class Checks(unittest.TestCase):
    LINE = "{name} (offers by baseline) as the one among 1 baseline, seeds 2500000 to 2500499: 86.6% (83.6 to 89.6) of 500 finished games; 0 fallbacks in {n} decisions; {ms} ms a decision; no refused action."

    def test_the_comparison_reads_the_play_and_not_the_name_or_the_time(self):
        mine = [self.LINE.format(name="00000", n=123456, ms="0.11")]
        same = [self.LINE.format(name="00040", n=123456, ms="0.09")]
        other = [self.LINE.format(name="00040", n=123457, ms="0.09")]
        self.assertTrue(branch.compare(mine, same).startswith("The first check reproduces"))
        self.assertTrue(branch.compare(mine, other).startswith("The first check differs"))
        self.assertTrue(branch.compare(mine, None).startswith("The parent has no check"))
        self.assertTrue(branch.compare(["exit 1"], same).startswith("One of the two"))

    def test_the_first_check_reproduces_the_parents_check_end_to_end(self):
        # The exported weights are scored by evaluate.ts over a few games, for the parent at update 40 and the branch at 0.
        root = Path(tempfile.mkdtemp())
        parent = make_parent(root)
        torch.save(torch.load(parent / "checkpoints" / "00040.pt", weights_only=False)["net"], parent / "weights.pt")
        cfg = json.loads((parent / "config.json").read_text())
        proc = training.start_check(parent, cfg, 40)
        proc.wait()
        training.collect_checks(parent, [(40, proc)])
        child = root / "child"
        branch.main(["--from", str(parent), "--config", str(self.write({"name": "child"}, root)), "--run", str(child), "--no-train"])
        mine = json.loads((child / "checks.jsonl").read_text().splitlines()[-1])["output"]
        theirs = branch.parent_check(parent, 40)
        self.assertEqual(len(branch.figures(mine)), 1, mine)
        self.assertEqual(branch.figures(mine), branch.figures(theirs))

    def test_a_check_at_several_sizes_compares_every_size(self):
        two = self.LINE.format(name="x", n=1000, ms="0.1")
        four = two.replace("among 1 baseline", "among 3 baseline").replace("1000 decisions", "2000 decisions")
        self.assertEqual(len(branch.figures([two, four])), 2)
        self.assertTrue(branch.compare([two, four], [two, four]).startswith("The first check reproduces"))
        self.assertTrue(branch.compare([two, four], [two, two]).startswith("The first check differs"))
        self.assertEqual(training.check_list({"checks": None}), [])
        self.assertEqual(training.check_list({"checks": {"size": 2}}), [{"size": 2}])
        self.assertEqual(training.check_list({"checks": [{"size": 2}, {"size": 4}]}), [{"size": 2}, {"size": 4}])

    @staticmethod
    def write(overlay: dict, root: Path) -> Path:
        path = root / "overlay.json"
        path.write_text(json.dumps(overlay))
        return path


class Resuming(unittest.TestCase):
    def test_a_checkpoint_restores_the_generator_that_samples_actions(self):
        run = Path(tempfile.mkdtemp())
        torch.manual_seed(5)
        net = Net()
        optimizer = torch.optim.Adam(net.parameters(), lr=3e-4)
        state = {"update": 3, "decisions": 300, "games": 1, "next_seed": 7, "selves": []}
        training.save(run, net, optimizer, state, Book(), np.random.default_rng(0))
        expected = torch.rand(4)
        torch.manual_seed(99)
        saved = torch.load(run / "checkpoints" / "00003.pt", map_location="cpu", weights_only=False)
        rng = np.random.default_rng(1)
        self.assertEqual(training.restore(saved, Net(), torch.optim.Adam(Net().parameters()), Book(), rng)["update"], 3)
        self.assertTrue(torch.equal(torch.rand(4), expected))

    def test_older_checkpoints_without_the_generator_still_load(self):
        run = Path(tempfile.mkdtemp())
        net = Net()
        training.save(run, net, torch.optim.Adam(net.parameters()), {"update": 1, "decisions": 1, "games": 0, "next_seed": 1}, Book(), np.random.default_rng(0))
        saved = torch.load(run / "checkpoints" / "00001.pt", map_location="cpu", weights_only=False)
        del saved["torch_rng"]
        self.assertEqual(training.restore(saved, Net(), torch.optim.Adam(Net().parameters()), Book(), np.random.default_rng(0))["update"], 1)


class PastSelves(unittest.TestCase):
    def test_the_newest_and_an_even_spread_of_the_rest(self):
        history = [f"s{i}" for i in range(20)]
        kept = training.kept_selves(history, 4, 4)
        self.assertEqual(kept, ["s0", "s5", "s10", "s15", "s16", "s17", "s18", "s19"])
        self.assertEqual(training.kept_selves(history[:6], 4, 4), history[:6])
        self.assertEqual(training.kept_selves([], 4, 4), [])
        self.assertEqual(training.kept_selves(history, 2, 1), ["s0", "s18", "s19"])
        self.assertEqual(training.kept_selves(history, 0, 0), [])

    def test_members_with_and_without_selves(self):
        cfg = {**training.DEFAULTS, "members": ["baseline", "refuser"]}
        self.assertEqual(training.members_now(cfg, {"selves": ["/r/a.ts"]}), ["baseline", "refuser"])
        cfg["past_selves"] = {"every": 200, "newest": 1, "spread": 0}
        self.assertEqual(training.members_now(cfg, {"selves": ["/r/a.ts", "/r/b.ts"]}), ["baseline", "refuser", "model:/r/b.ts"])


if __name__ == "__main__":
    unittest.main()
