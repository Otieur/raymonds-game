"""A network saved at observation version 3 and action version 2, widened to this build's sizes (M9, 20 November)."""
import sys
import unittest
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model import ACTIONS, OBS_SIZE, OLD_ACTIONS, OLD_OBS_SIZE, Net, widen_optimizer_state, widen_state_dict  # noqa: E402


def old_of(state: dict) -> dict:
    """The same weights cut to the older sizes, as a network of version 3 would have saved them."""
    out = dict(state)
    out["trunk.0.weight"] = state["trunk.0.weight"][:, :OLD_OBS_SIZE].clone()
    out["policy.weight"] = state["policy.weight"][:OLD_ACTIONS].clone()
    out["policy.bias"] = state["policy.bias"][:OLD_ACTIONS].clone()
    return out


class Widening(unittest.TestCase):
    def test_widened_weights_play_as_the_old_network_did(self):
        torch.manual_seed(3)
        old = old_of(Net().state_dict())
        net = Net()
        net.load_state_dict(widen_state_dict(old))
        obs = torch.randn(5, OBS_SIZE)
        obs[:, OLD_OBS_SIZE:] = torch.randn(5, OBS_SIZE - OLD_OBS_SIZE)  # the new inputs have no weight
        mask = torch.ones(5, ACTIONS, dtype=torch.bool)
        logits, value, _ = net(obs, mask)
        # The old network, by hand, on the first 1,023 inputs.
        h = torch.relu(obs[:, :OLD_OBS_SIZE] @ old["trunk.0.weight"].T + old["trunk.0.bias"])
        h = torch.relu(h @ old["trunk.2.weight"].T + old["trunk.2.bias"])
        h = torch.relu(h @ old["trunk.4.weight"].T + old["trunk.4.bias"])
        expected = h @ old["policy.weight"].T + old["policy.bias"]
        self.assertTrue(torch.allclose(logits[:, :OLD_ACTIONS], expected, atol=1e-5))
        self.assertTrue(torch.equal(logits[:, OLD_ACTIONS:], torch.zeros(5, ACTIONS - OLD_ACTIONS)))
        self.assertTrue(torch.allclose(value, h @ old["value.weight"].T + old["value.bias"], atol=1e-5))

    def test_current_weights_are_left_as_they_are(self):
        state = Net().state_dict()
        self.assertIs(widen_state_dict(state), state)

    def test_the_optimizers_moments_are_widened_like_their_parameters(self):
        torch.manual_seed(4)
        net = Net()
        optimizer = torch.optim.Adam(net.parameters(), lr=1e-3)
        logits, value, _ = net(torch.randn(3, OBS_SIZE), torch.ones(3, ACTIONS, dtype=torch.bool))
        (logits.sum() + value.sum()).backward()
        optimizer.step()
        saved = optimizer.state_dict()
        names = [name for name, _ in net.named_parameters()]
        cut = {"trunk.0.weight": lambda t: t[:, :OLD_OBS_SIZE], "policy.weight": lambda t: t[:OLD_ACTIONS], "policy.bias": lambda t: t[:OLD_ACTIONS]}
        old_state = {
            index: {key: cut.get(names[index], lambda t: t)(value).clone() if key in ("exp_avg", "exp_avg_sq") else value for key, value in entry.items()}
            for index, entry in saved["state"].items()
        }
        widened = widen_optimizer_state({**saved, "state": old_state}, net)
        fresh = torch.optim.Adam(Net().parameters(), lr=1e-3)
        fresh.load_state_dict(widened)
        policy = names.index("policy.weight")
        self.assertEqual(widened["state"][policy]["exp_avg"].shape, (ACTIONS, 512))
        self.assertTrue(torch.equal(widened["state"][policy]["exp_avg"][:OLD_ACTIONS], saved["state"][policy]["exp_avg"][:OLD_ACTIONS]))
        self.assertTrue(torch.equal(widened["state"][policy]["exp_avg"][OLD_ACTIONS:], torch.zeros(ACTIONS - OLD_ACTIONS, 512)))


if __name__ == "__main__":
    unittest.main()
