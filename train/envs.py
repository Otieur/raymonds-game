"""
The trainer's side of the environment server: many environments in worker processes, stepped
together, returned as NumPy arrays. Each worker runs `node scripts/env-server.ts`.
"""
from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OBS_SIZE = 1029
ACTIONS = 191
OBS_VERSION = 4
ACTIONS_VERSION = 3


@dataclass
class Batch:
    """One step of every environment."""

    obs: np.ndarray  # [N, 1023] float32
    mask: np.ndarray  # [N, 188] bool
    phi: np.ndarray  # [N, P] float32
    seat: np.ndarray  # [N] int
    kind: np.ndarray  # [N] int
    done: np.ndarray  # [N] bool
    truncated: np.ndarray  # [N] bool
    finals: list  # the final records of the environments whose game just ended


class Worker:
    def __init__(self, count: int, config: dict):
        self.count = count
        self.proc = subprocess.Popen(
            ["node", str(ROOT / "scripts" / "env-server.ts")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            cwd=ROOT,
            text=True,
            bufsize=1,
        )
        hello = self.request({"op": "hello"})
        if hello["obs"] != OBS_SIZE or hello["actions"] != ACTIONS or hello["version"] != OBS_VERSION or hello["actionsVersion"] != ACTIONS_VERSION:
            raise RuntimeError(f"The environment server does not match this client: {hello['obs']}, {hello['actions']}, {hello['version']}")
        self.hello = hello
        self.request({"op": "make", "count": count, "config": config})

    def send(self, message: dict) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(message) + "\n")
        self.proc.stdin.flush()

    def receive(self) -> dict:
        assert self.proc.stdout is not None
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("The environment server stopped.")
        return json.loads(line)

    def request(self, message: dict) -> dict:
        self.send(message)
        return self.receive()

    def close(self) -> None:
        try:
            self.send({"op": "close"})
        except (BrokenPipeError, OSError):
            pass
        self.proc.wait(timeout=10)


class VecEnv:
    def __init__(self, workers: int, envs_per_worker: int, config: dict, configs: list[dict] | None = None):
        """`configs`, when given, has one configuration for each worker in place of `config` for all."""
        self.per_worker = envs_per_worker
        self.count = workers
        self.start = dict(config).get("seeds", {}).get("start", 10_000_000)
        self.workers = []
        for w in range(workers):
            self.workers.append(Worker(envs_per_worker, self._seeded(configs[w] if configs else config, w)))
        self.n = workers * envs_per_worker
        self.potentials = len(config.get("potentials", ["value"]))

    def _seeded(self, config: dict, w: int) -> dict:
        cfg = dict(config)
        cfg["seeds"] = {"start": self.start + w * self.per_worker, "step": self.count * self.per_worker}
        return cfg

    def remake(self, configs: list[dict], seed_start: int) -> None:
        """Gives every worker a new configuration, with seeds from `seed_start` on. The games under way are dropped."""
        self.start = seed_start
        for w, worker in enumerate(self.workers):
            worker.request({"op": "make", "count": self.per_worker, "config": self._seeded(configs[w], w)})

    def _collect(self, replies: list[dict]) -> Batch:
        steps = [s for r in replies for s in r["steps"]]
        n = len(steps)
        obs = np.zeros((n, OBS_SIZE), dtype=np.float32)
        mask = np.zeros((n, ACTIONS), dtype=bool)
        phi = np.zeros((n, self.potentials), dtype=np.float32)
        finals = []
        for i, s in enumerate(steps):
            if s["obs"]:
                obs[i] = s["obs"]
            mask[i, s["legal"]] = True
            if s["phi"]:
                phi[i] = s["phi"]
            if s["done"]:
                finals.append((i, s["final"]))
        return Batch(
            obs=obs,
            mask=mask,
            phi=phi,
            seat=np.array([s["seat"] for s in steps]),
            kind=np.array([s["kind"] for s in steps]),
            done=np.array([s["done"] for s in steps]),
            truncated=np.array([s["truncated"] for s in steps]),
            finals=finals,
        )

    def reset(self) -> Batch:
        for w in self.workers:
            w.send({"op": "reset"})
        return self._collect([w.receive() for w in self.workers])

    def step(self, actions: np.ndarray) -> Batch:
        offset = 0
        for w in self.workers:
            w.send({"op": "step", "actions": [int(a) for a in actions[offset : offset + w.count]]})
            offset += w.count
        return self._collect([w.receive() for w in self.workers])

    def close(self) -> None:
        for w in self.workers:
            w.close()
