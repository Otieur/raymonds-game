"""The update on a toy problem (step 0a of M6), and the pieces of the loss."""
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model import ACTIONS, OBS_SIZE, Net  # noqa: E402
from ppo import PpoConfig, act, losses, masked_entropy, normalize_by_kind, ppo_update  # noqa: E402

LEGAL = [13, 14, 15, 16]
PAYS = 14


def toy_batch(count: int):
    obs = np.zeros((count, OBS_SIZE), dtype=np.float32)
    obs[:, 936 + 37] = 1.0  # a two-player table
    mask = np.zeros((count, ACTIONS), dtype=bool)
    mask[:, LEGAL] = True
    return obs, mask


class Toy(unittest.TestCase):
    def test_the_policy_finds_the_one_action_that_pays(self):
        torch.manual_seed(0)
        rng = np.random.default_rng(0)
        net = Net(hidden=64)
        optimizer = torch.optim.Adam(net.parameters(), lr=3e-3)
        cfg = PpoConfig(epochs=4, minibatch=128, entropy=0.0)
        obs, mask = toy_batch(512)
        for _ in range(50):
            action, logp, value = act(net, obs, mask)
            reward = (action == PAYS).astype(np.float32)
            data = {"obs": obs, "mask": mask, "action": action, "logp": logp, "advantage": reward - value, "returns": reward, "kind": np.zeros(512, dtype=np.int64)}
            ppo_update(net, optimizer, data, cfg, rng=rng)
        with torch.no_grad():
            logits, _, _ = net(torch.as_tensor(obs[:1]), torch.as_tensor(mask[:1]))
            p = torch.softmax(logits, dim=1)[0]
        self.assertGreater(float(p[PAYS]), 0.95)
        self.assertEqual(float(p[0]), 0.0)  # an illegal action never has any probability

    def test_a_frozen_policy_does_not_move_while_the_critic_warms_up(self):
        torch.manual_seed(1)
        net = Net(hidden=32)
        optimizer = torch.optim.SGD(net.policy.parameters(), lr=0.1)
        obs, mask = toy_batch(64)
        before = net.policy.weight.detach().clone()
        action, logp, value = act(net, obs, mask)
        data = {"obs": obs, "mask": mask, "action": action, "logp": logp, "advantage": np.ones(64, dtype=np.float32), "returns": np.ones(64, dtype=np.float32), "kind": np.zeros(64, dtype=np.int64)}
        ppo_update(net, optimizer, data, PpoConfig(epochs=1, minibatch=64, policy_weight=0.0))
        torch.testing.assert_close(net.policy.weight.detach(), before)


class Pieces(unittest.TestCase):
    def test_the_table_size_is_read_from_its_own_numbers(self):
        from model import table_size

        obs = torch.zeros((3, OBS_SIZE))
        for row, size in enumerate((2, 3, 4)):
            obs[row, 936 + 37 + size - 2] = 1.0
        obs[2, 936 + 36] = 1.0  # an offer from the third rival must not be read as the table size
        self.assertEqual(table_size(obs).tolist(), [0, 1, 2])

    def test_advantages_are_normalized_within_each_kind_that_has_enough(self):
        advantage = torch.cat([torch.arange(100, dtype=torch.float32), 1000 + torch.arange(100, dtype=torch.float32), torch.tensor([5.0, 7.0])])
        kind = torch.cat([torch.zeros(100), torch.ones(100), torch.full((2,), 2)]).long()
        out = normalize_by_kind(advantage, kind, 64)
        for k in (0, 1):
            self.assertAlmostEqual(float(out[kind == k].mean()), 0.0, places=5)
            self.assertAlmostEqual(float(out[kind == k].std()), 1.0, places=4)
        self.assertAlmostEqual(float(out[kind == 2].mean()), 0.0, places=5)

    def test_entropy_ignores_illegal_actions(self):
        logits = torch.full((1, 6), float("-inf"))
        logits[0, :4] = 0.0
        self.assertAlmostEqual(float(masked_entropy(logits)[0]), float(np.log(4)), places=5)

    def test_the_pull_toward_the_starting_policy_is_zero_at_the_start(self):
        torch.manual_seed(2)
        net = Net(hidden=32)
        start = Net(hidden=32)
        start.load_state_dict(net.state_dict())
        obs, mask = toy_batch(16)
        action, logp, value = act(net, obs, mask)
        batch = {
            "obs": torch.as_tensor(obs), "mask": torch.as_tensor(mask), "action": torch.as_tensor(action), "logp": torch.as_tensor(logp),
            "advantage": torch.zeros(16), "returns": torch.as_tensor(value), "kind": torch.zeros(16, dtype=torch.long),
        }
        terms = losses(net, batch, PpoConfig(kappa=1.0), start)
        self.assertAlmostEqual(float(terms["kl_start"].detach()), 0.0, places=6)

    def test_a_checkpoint_saved_and_loaded_gives_the_same_actions(self):
        torch.manual_seed(3)
        net = Net(hidden=32)
        obs, mask = toy_batch(8)
        with tempfile.TemporaryDirectory() as folder:
            torch.save(net.state_dict(), Path(folder) / "weights.pt")
            again = Net(hidden=32)
            again.load_state_dict(torch.load(Path(folder) / "weights.pt"))
        a, _, va = act(net, obs, mask, greedy=True)
        b, _, vb = act(again, obs, mask, greedy=True)
        np.testing.assert_array_equal(a, b)
        np.testing.assert_allclose(va, vb)


if __name__ == "__main__":
    unittest.main()
