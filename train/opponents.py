"""
Chooses each game's table from the league.

    20%  the learner among baselines
    20%  the learner among copies of itself (every seat a learner)
    10%  the learner among copies of the holder of its own line: the best version so far
    50%  the learner among league members meant for the size, each seat drawn by a weight

The weight of member m is (1 - s_m)^2 + 0.02, where s_m is the learner's win share over its last 500
games at a table with m in it, divided by an even share and capped at 1. A member the learner seldom
beats is met often; one it always beats is still met a little.

A worker's environments share one configuration, so a kind of table is drawn for each worker and
drawn again whenever the configurations are rewritten (every twenty updates).
"""
from __future__ import annotations

from collections import deque

import numpy as np

KINDS = ("baselines", "self", "holder", "league")
SHARES = (0.20, 0.20, 0.10, 0.50)
WINDOW = 500


class Book:
    """The learner's latest results at tables with each member in them."""

    def __init__(self, window: int = WINDOW):
        self.window = window
        self.results: dict[str, deque] = {}

    def record(self, final: dict) -> None:
        """Feed a game's final record: `members` by seat, `result` by seat, `learners` as seat indices."""
        result = final.get("result") or []
        if not any(result):
            return  # cut off: nobody won
        players = len(result)
        for seat in final.get("learners", []):
            over_even = (1.0 if result[seat] == 1 else 0.0) * players
            for member in set(final.get("members", [])):
                if member and member != "learner":
                    self.results.setdefault(member, deque(maxlen=self.window)).append(over_even)

    def share(self, member: str) -> float:
        """The learner's win share against tables with this member, over an even share, capped at 1. 0.5 until it has met it."""
        played = self.results.get(member)
        if not played:
            return 0.5
        return min(1.0, float(np.mean(played)))

    def weight(self, member: str) -> float:
        return (1.0 - self.share(member)) ** 2 + 0.02

    def dump(self) -> dict:
        return {member: list(values) for member, values in self.results.items()}

    def load(self, saved: dict) -> None:
        self.results = {member: deque(values, maxlen=self.window) for member, values in saved.items()}


def sample_kind(rng: np.random.Generator) -> str:
    return KINDS[int(rng.choice(len(KINDS), p=SHARES))]


def table_config(kind: str, base: dict, players: int, members: list[str], book: Book, holder: str | None) -> dict:
    """The environment configuration for a kind of table, over `base`."""
    config = dict(base)
    config["learners"] = 1
    if kind == "baselines":
        config["opponents"] = [{"member": "baseline", "weight": 1}]
    elif kind == "self":
        config["learners"] = players if isinstance(players, int) else 4
    elif kind == "holder":
        # The holder is any member the environment can seat, `model:<path>` included; the baseline when none is named.
        config["opponents"] = [{"member": holder or "baseline", "weight": 1}]
    else:
        config["opponents"] = [{"member": m, "weight": round(book.weight(m), 4)} for m in members] or [{"member": "baseline", "weight": 1}]
    return config


def worker_configs(base: dict, workers: int, players: int, members: list[str], book: Book, holder: str | None, rng: np.random.Generator) -> tuple[list[dict], list[str]]:
    """One configuration a worker, and the kind of table each was given."""
    kinds = [sample_kind(rng) for _ in range(workers)]
    return [table_config(kind, base, players, members, book, holder) for kind in kinds], kinds
