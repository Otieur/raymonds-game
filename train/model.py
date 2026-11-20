"""
The network: a perceptron of three layers of 512 over the observation, a policy head over the
191 actions with illegal ones masked out, a value head with one output for each table size, and
side heads.

Observation version 4 appends six inputs and action version 3 appends three actions (M9, 20 November
2026). A network trained on the earlier sizes is widened when it is loaded (`widen_state_dict`,
`widen_optimizer_state`): zero weights on the new inputs and zero rows for the new actions, so that
it plays as before wherever the new actions are not offered, and its weights carry into training.
"""
from __future__ import annotations

import torch
from torch import nn

OBS_SIZE = 1029
ACTIONS = 191
SIDE = 14
# The sizes of observation version 3 and action version 2, from which a saved network is widened.
OLD_OBS_SIZE = 1023
OLD_ACTIONS = 188


class Net(nn.Module):
    def __init__(self, extra: int = 0, hidden: int = 512):
        super().__init__()
        self.trunk = nn.Sequential(
            nn.Linear(OBS_SIZE + extra, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
        )
        self.policy = nn.Linear(hidden, ACTIONS)
        self.value = nn.Linear(hidden, 3)
        self.side = nn.Linear(hidden, SIDE)

    def forward(self, obs: torch.Tensor, mask: torch.Tensor):
        h = self.trunk(obs)
        logits = self.policy(h).masked_fill(~mask, float("-inf"))
        return logits, self.value(h), self.side(h)


def table_size(obs: torch.Tensor) -> torch.Tensor:
    """The table size one-hot in the observation's table block, as an index 0, 1, 2 for 2, 3, 4 players."""
    # The table block starts at 936; the size one-hot is at offsets 37 to 39 within it (after the other
    # party's one-hot at 34 to 36). Until 19 November 2026 this read offsets 36 to 38 by mistake, which
    # sent four-player decisions to head 0, two-player to head 1 and three-player to head 2: the same
    # head for every decision of a size, so training was consistent, but a size's head had the wrong name.
    return obs[:, 936 + 37 : 936 + 40].argmax(dim=1)


def _is_old(policy_rows: int) -> bool:
    return policy_rows == OLD_ACTIONS


def _widen(name: str, tensor: torch.Tensor) -> torch.Tensor:
    """One parameter (or an optimizer moment of one) of a network of the older sizes, at this build's sizes."""
    if name == "trunk.0.weight":
        # The observation's inputs come first, then any extra inputs; the new ones go after the old observation.
        pad = torch.zeros(tensor.shape[0], OBS_SIZE - OLD_OBS_SIZE, dtype=tensor.dtype, device=tensor.device)
        return torch.cat([tensor[:, :OLD_OBS_SIZE], pad, tensor[:, OLD_OBS_SIZE:]], dim=1)
    if name == "policy.weight":
        pad = torch.zeros(ACTIONS - OLD_ACTIONS, tensor.shape[1], dtype=tensor.dtype, device=tensor.device)
        return torch.cat([tensor, pad], dim=0)
    if name == "policy.bias":
        return torch.cat([tensor, torch.zeros(ACTIONS - OLD_ACTIONS, dtype=tensor.dtype, device=tensor.device)])
    return tensor


def widen_state_dict(state: dict) -> dict:
    """A network's weights at this build's sizes; weights already at them are returned as they are."""
    if not _is_old(state["policy.weight"].shape[0]):
        return state
    return {name: _widen(name, tensor) for name, tensor in state.items()}


def widen_optimizer_state(saved: dict, net: nn.Module) -> dict:
    """An Adam optimizer's state saved with a network of the older sizes, at this build's sizes (moments widened like their parameters)."""
    names = [name for name, _ in net.named_parameters()]
    policy = names.index("policy.weight")
    moments = saved.get("state", {}).get(policy)
    if moments is None or not _is_old(moments["exp_avg"].shape[0]):
        return saved
    state = {}
    for index, entry in saved["state"].items():
        state[index] = {key: _widen(names[index], value) if torch.is_tensor(value) and value.dim() > 0 else value for key, value in entry.items()}
    return {**saved, "state": state}
