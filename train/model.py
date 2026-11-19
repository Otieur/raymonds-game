"""
The network: a perceptron of three layers of 512 over the observation, a policy head over the
188 actions with illegal ones masked out, a value head with one output for each table size, and
side heads.
"""
from __future__ import annotations

import torch
from torch import nn

OBS_SIZE = 1023
ACTIONS = 188
SIDE = 14


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
