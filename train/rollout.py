"""
Collects a learner seat's decisions into sequences and turns them into returns and advantages.

A seat's experience in one game is a sequence of its own decisions. Between two of them other seats
act and the game moves on; what the seat receives for that stretch is credited to the earlier
decision. For decision t, with potentials phi_k reported by the environment and weights w_k:

    r_t = sum_k w_k * (gamma * phi_k(t+1) - phi_k(t))        between two decisions
    r_T = sum_k w_k * (0 - phi_k(T)) + R                     at the seat's last decision of a finished game
    R   = +1 for the winner; -1 / (players - 1) for each of the others

A game cut off at the turn limit has no R: its sequence is closed with the critic's value of the
seat's last observation, and that last decision is dropped. A sequence still open when an update is
taken is closed the same way, and its last decision is held over to the next update.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


def result_for(final_result: list[int], seat: int) -> float:
    """+1 for the winner, -1 / (players - 1) for each of the others. Sums to zero over a table."""
    players = len(final_result)
    return 1.0 if final_result[seat] == 1 else -1.0 / (players - 1)


def shaped_rewards(phi: np.ndarray, weights: np.ndarray, gamma: float, result: float | None) -> np.ndarray:
    """
    The rewards of one seat's sequence. `phi` is [T, P], one row a decision.

    With a result (a finished game) there is a reward for every decision: the last one closes the
    potentials at zero and adds the result. Without one there is a reward for every decision but the
    last, whose successor has not arrived.
    """
    phi = np.asarray(phi, dtype=np.float64)
    weights = np.asarray(weights, dtype=np.float64)
    potential = phi @ weights
    between = gamma * potential[1:] - potential[:-1]
    if result is None:
        return between
    return np.concatenate([between, [-potential[-1] + result]])


def gae(rewards: np.ndarray, values: np.ndarray, bootstrap: float, gamma: float, lam: float) -> tuple[np.ndarray, np.ndarray]:
    """
    Generalized advantage estimates and returns over one sequence. `values[t]` is the critic at
    decision t and `bootstrap` its value after the last reward: zero for a finished game.
    """
    rewards = np.asarray(rewards, dtype=np.float64)
    values = np.asarray(values, dtype=np.float64)
    following = np.append(values[1:], bootstrap)
    deltas = rewards + gamma * following - values
    advantages = np.zeros_like(deltas)
    running = 0.0
    for t in range(len(deltas) - 1, -1, -1):
        running = deltas[t] + gamma * lam * running
        advantages[t] = running
    return advantages, advantages + values


@dataclass
class Sequence:
    """The decisions of one learner seat in one game, so far."""

    obs: list = field(default_factory=list)
    mask: list = field(default_factory=list)
    action: list = field(default_factory=list)
    logp: list = field(default_factory=list)
    value: list = field(default_factory=list)
    phi: list = field(default_factory=list)
    kind: list = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.action)


FIELDS = ("obs", "mask", "action", "logp", "value", "kind")


class Collector:
    """Open sequences by (environment, seat), and the closed decisions ready for an update."""

    def __init__(self, weights: np.ndarray, gamma: float = 0.999, lam: float = 0.95):
        self.weights = np.asarray(weights, dtype=np.float64)
        self.gamma = gamma
        self.lam = lam
        self.open: dict[tuple[int, int], Sequence] = {}
        self.closed: list[dict] = []
        self.results: list[float] = []

    def add(self, env: int, seat: int, obs, mask, action: int, logp: float, value: float, phi, kind: int) -> None:
        seq = self.open.setdefault((env, seat), Sequence())
        seq.obs.append(obs)
        seq.mask.append(mask)
        seq.action.append(action)
        seq.logp.append(logp)
        seq.value.append(value)
        seq.phi.append(phi)
        seq.kind.append(kind)

    def _close(self, seq: Sequence, result: float | None, keep: int) -> None:
        """Turns the first `keep` decisions of a sequence into training rows."""
        if keep <= 0:
            return
        values = np.asarray(seq.value, dtype=np.float64)
        rewards = shaped_rewards(np.asarray(seq.phi), self.weights, self.gamma, result)
        bootstrap = 0.0 if result is not None else float(values[keep])
        advantages, returns = gae(rewards[:keep], values[:keep], bootstrap, self.gamma, self.lam)
        row = {name: np.asarray(getattr(seq, name)[:keep]) for name in FIELDS}
        row["advantage"] = advantages.astype(np.float32)
        row["returns"] = returns.astype(np.float32)
        self.closed.append(row)

    def finish(self, env: int, final: dict, truncated: bool) -> None:
        """A game ended in an environment: close every sequence of its learner seats."""
        for seat in final.get("learners", []):
            seq = self.open.pop((env, seat), None)
            if seq is None or len(seq) == 0:
                continue
            if truncated:
                self._close(seq, None, len(seq) - 1)
            else:
                result = result_for(final["result"], seat)
                self.results.append(result)
                self._close(seq, result, len(seq))
        # Any sequence left for this environment belongs to a seat the final record did not name.
        for key in [k for k in self.open if k[0] == env]:
            del self.open[key]

    def cut(self) -> None:
        """Before an update: close every open sequence on the critic's latest value, holding its last decision over."""
        for key, seq in list(self.open.items()):
            if len(seq) < 2:
                continue
            self._close(seq, None, len(seq) - 1)
            held = Sequence()
            for name in FIELDS + ("phi",):
                getattr(held, name).append(getattr(seq, name)[-1])
            self.open[key] = held

    def ready(self) -> int:
        return sum(len(row["action"]) for row in self.closed)

    def take(self) -> dict:
        """The closed decisions as arrays, and nothing left behind."""
        rows = self.closed
        self.closed = []
        if not rows:
            return {}
        return {name: np.concatenate([row[name] for row in rows]) for name in rows[0]}
