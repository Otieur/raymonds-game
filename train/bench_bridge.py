"""
Measures learner decisions a second through the environment server, with random legal actions.

    train/.venv/bin/python train/bench_bridge.py --workers 8 --envs 64 --size 4 --seconds 30
"""
import argparse
import platform
import time

import numpy as np

from envs import VecEnv


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--envs", type=int, default=64)
    parser.add_argument("--size", type=int, default=4)
    parser.add_argument("--seconds", type=float, default=30)
    args = parser.parse_args()
    config = {"players": args.size, "learners": 1, "drafting": True, "potentials": ["value"], "seeds": {"start": 10_000_000}}
    env = VecEnv(args.workers, args.envs, config)
    rng = np.random.default_rng(0)
    batch = env.reset()
    decisions = 0
    games = 0
    started = time.perf_counter()
    while time.perf_counter() - started < args.seconds:
        scores = rng.random(batch.mask.shape) * batch.mask
        scores[batch.done] = 1.0
        actions = scores.argmax(axis=1)
        decisions += int((~batch.done).sum())
        games += len(batch.finals)
        batch = env.step(actions)
    seconds = time.perf_counter() - started
    env.close()
    print(
        f"{args.workers} workers x {args.envs} envs, {args.size} players: {decisions / seconds:,.0f} learner decisions a second, "
        f"{games} games in {seconds:.0f} s ({platform.machine()}, {platform.system()})"
    )


if __name__ == "__main__":
    main()
