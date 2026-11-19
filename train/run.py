"""
The training loop of reinforcement learning: collect decisions from the environments, update the
network by proximal policy optimization, move the schedules, write metrics and checkpoints.

    train/.venv/bin/python train/run.py --config train/configs/g1.json --run $DATA_DIR/runs/g1-s1
    train/.venv/bin/python train/run.py --resume $DATA_DIR/runs/g1-s1

A run directory holds the configuration it ran from, the commit, `metrics.jsonl` with one line an
update, `checks.jsonl` with the scores of exported checkpoints, `weights.pt` (the latest) and
`checkpoints/`. A run stopped at any point resumes from its last checkpoint.
"""
from __future__ import annotations

import argparse
import copy
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch

from envs import VecEnv
from model import Net
from opponents import Book, table_config
from ppo import PpoConfig, act, ppo_update
from rollout import Collector

ROOT = Path(__file__).resolve().parent.parent

DEFAULTS = {
    "games": [{"players": 2, "rules": "full", "share": 1.0}],
    "budget": 50_000_000,
    "workers": 8,
    "envs_per_worker": 64,
    "update": 131_072,
    "epochs": 4,
    "minibatch": 4096,
    "clip": 0.2,
    "lr": 3e-4,
    "value_weight": 0.5,
    "grad_clip": 0.5,
    "entropy": [0.01, 0.001],
    "gamma": 0.999,
    "lam": 0.95,
    "kappa": {"start": 1.0, "until": 0.2},
    "shaping": {"value": {"start": 1.0, "until": 0.7}, "milestones": {"start": 0.2, "until": 0.3}},
    "potentials": ["value", "groups", "built3", "passes", "rentRoll", "denial", "safety"],
    "start": None,
    "critic_warmup": 0,
    "members": ["baseline", "refuser"],
    "holder": None,
    "proposer": "baseline",
    "seeds": 10_000_000,
    "seed": 1,
    "device": "cpu",
    "checkpoint_every": 20,
    "tables_every": 20,
    "checks": None,
    # A fixed list of opponents for every table, in place of the four kinds drawn by their shares (step 0c, and the trials of 0d).
    "opponents": None,
}


def falling(start: float, until: float, fraction: float, end: float = 0.0) -> float:
    """A value that falls in a straight line from `start` to `end` as the run goes from 0 to `until` of its budget, and stays there."""
    if until <= 0:
        return end
    return end + (start - end) * max(0.0, 1.0 - fraction / until)


def schedules(cfg: dict, fraction: float) -> dict:
    """Every scheduled setting at a fraction of the budget."""
    shaping = cfg["shaping"]
    weights = []
    for name in cfg["potentials"]:
        if name == "value":
            weights.append(falling(shaping["value"]["start"], shaping["value"]["until"], fraction))
        else:
            weights.append(falling(shaping["milestones"]["start"], shaping["milestones"]["until"], fraction))
    return {
        "lr": falling(cfg["lr"], 1.0, fraction),
        "entropy": falling(cfg["entropy"][0], 1.0, fraction, cfg["entropy"][1]),
        "kappa": falling(cfg["kappa"]["start"], cfg["kappa"]["until"], fraction) if cfg.get("start") else 0.0,
        "weights": weights,
    }


def draw_tables(cfg: dict, book: Book, rng: np.random.Generator) -> tuple[list[dict], list[str]]:
    """One environment configuration for each worker: a game (table size and rules) and a kind of table, each drawn by its share."""
    from opponents import sample_kind

    games = cfg["games"]
    shares = np.array([g["share"] for g in games], dtype=np.float64)
    shares /= shares.sum()
    configs, labels = [], []
    for _ in range(cfg["workers"]):
        game = games[int(rng.choice(len(games), p=shares))]
        base = {"players": game["players"], "rules": game["rules"], "potentials": cfg["potentials"], "drafting": False, "proposer": cfg["proposer"]}
        if cfg.get("opponents"):
            kind = "fixed"
            configs.append({**base, "learners": 1, "opponents": cfg["opponents"]})
        else:
            kind = sample_kind(rng)
            configs.append(table_config(kind, base, game["players"], cfg["members"], book, cfg["holder"]))
        labels.append(f"{game['players']}p {game['rules']} {kind}")
    return configs, labels


def save(run: Path, net, optimizer, state: dict, book: Book, rng: np.random.Generator) -> None:
    torch.save(net.state_dict(), run / "weights.pt")
    (run / "checkpoints").mkdir(exist_ok=True)
    torch.save(
        {"net": net.state_dict(), "optimizer": optimizer.state_dict(), "state": state, "book": book.dump(), "rng": rng.bit_generator.state},
        run / "checkpoints" / f"{state['update']:05d}.pt",
    )


def latest(run: Path) -> Path | None:
    found = sorted((run / "checkpoints").glob("*.pt")) if (run / "checkpoints").exists() else []
    return found[-1] if found else None


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config")
    parser.add_argument("--run")
    parser.add_argument("--resume")
    parser.add_argument("--updates", type=int, default=None, help="Stop after this many updates of this invocation (for trials).")
    args = parser.parse_args(argv)

    run = Path(args.resume or args.run)
    run.mkdir(parents=True, exist_ok=True)
    if args.resume:
        cfg = json.loads((run / "config.json").read_text())
    else:
        cfg = {**DEFAULTS, **json.loads(Path(args.config).read_text())}
        (run / "config.json").write_text(json.dumps(cfg, indent=2))
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip()
        (run / "commit.txt").write_text(commit + "\n")

    torch.manual_seed(cfg["seed"])
    rng = np.random.default_rng(cfg["seed"])
    device = cfg["device"]
    net = Net().to(device)
    start = None
    if cfg.get("start"):
        net.load_state_dict(torch.load(cfg["start"], map_location=device))
        start = copy.deepcopy(net).eval()
        for p in start.parameters():
            p.requires_grad_(False)
    optimizer = torch.optim.Adam(net.parameters(), lr=cfg["lr"])
    book = Book()
    state = {"update": 0, "decisions": 0, "games": 0, "next_seed": cfg["seeds"]}

    checkpoint = latest(run) if args.resume else None
    if checkpoint:
        saved = torch.load(checkpoint, map_location=device, weights_only=False)
        net.load_state_dict(saved["net"])
        optimizer.load_state_dict(saved["optimizer"])
        state = saved["state"]
        book.load(saved["book"])
        rng.bit_generator.state = saved["rng"]

    n = cfg["workers"] * cfg["envs_per_worker"]
    block = n * 10_000  # seeds set aside for one drawing of the tables
    configs, labels = draw_tables(cfg, book, rng)
    env = VecEnv(cfg["workers"], cfg["envs_per_worker"], {"potentials": cfg["potentials"], "seeds": {"start": state["next_seed"], "step": 1}}, configs)
    state["next_seed"] += block
    collector = Collector(schedules(cfg, 0.0)["weights"], cfg["gamma"], cfg["lam"])
    batch = env.reset()
    checks: list[tuple[int, subprocess.Popen]] = []
    done_here = 0

    try:
        while state["decisions"] < cfg["budget"] and (args.updates is None or done_here < args.updates):
            began = time.time()
            fraction = state["decisions"] / cfg["budget"]
            now = schedules(cfg, fraction)
            collector.weights = np.asarray(now["weights"], dtype=np.float64)
            finished = cut_off = turns = 0
            results: list[float] = []
            while collector.ready() + sum(len(seq) for seq in collector.open.values()) < cfg["update"]:
                live = np.flatnonzero(~batch.done)
                actions = np.zeros(n, dtype=np.int64)
                if len(live) > 0:
                    chosen, logp, value = act(net, batch.obs[live], batch.mask[live], device)
                    for j, i in enumerate(live):
                        collector.add(int(i), int(batch.seat[i]), batch.obs[i], batch.mask[i], int(chosen[j]), float(logp[j]), float(value[j]), batch.phi[i], int(batch.kind[i]))
                        actions[i] = chosen[j]
                for i, final in batch.finals:
                    before = len(collector.results)
                    collector.finish(int(i), final, bool(batch.truncated[i]))
                    results.extend(collector.results[before:])
                    book.record(final)
                    finished += 1
                    cut_off += int(batch.truncated[i])
                    turns += final.get("turns", 0)
                batch = env.step(actions)
            collector.cut()
            data = collector.take()
            collector.results = []
            for group in optimizer.param_groups:
                group["lr"] = now["lr"]
            warming = state["decisions"] < cfg["critic_warmup"]
            ppo = PpoConfig(
                epochs=cfg["epochs"], minibatch=cfg["minibatch"], clip=cfg["clip"], value_weight=cfg["value_weight"], grad_clip=cfg["grad_clip"],
                entropy=now["entropy"], kappa=now["kappa"], policy_weight=0.0 if warming else 1.0,
            )
            terms = ppo_update(net, optimizer, data, ppo, start, device, rng)
            state["update"] += 1
            state["decisions"] += len(data["action"])
            state["games"] += finished
            done_here += 1
            line = {
                "update": state["update"], "decisions": state["decisions"], "games": finished, "cut_off": cut_off / max(1, finished),
                "turns": turns / max(1, finished), "result": float(np.mean(results)) if results else None,
                "wins": float(np.mean([r > 0 for r in results])) if results else None,
                "lr": now["lr"], "entropy_bonus": now["entropy"], "kappa": now["kappa"], "weights": now["weights"], "warming": warming,
                "tables": labels, "seconds": time.time() - began, "per_second": len(data["action"]) / max(1e-9, time.time() - began), **terms,
            }
            with (run / "metrics.jsonl").open("a") as f:
                f.write(json.dumps(line) + "\n")
            print(f"update {line['update']}: {line['decisions']} decisions, {finished} games, wins {line['wins']}, entropy {terms.get('entropy', 0):.3f}, {line['per_second']:.0f} a second", flush=True)

            if state["update"] % cfg["checkpoint_every"] == 0:
                save(run, net, optimizer, state, book, rng)
                if cfg.get("checks"):
                    checks.append((state["update"], start_check(run, cfg, state["update"])))
            if state["update"] % cfg["tables_every"] == 0:
                configs, labels = draw_tables(cfg, book, rng)
                env.remake(configs, state["next_seed"])
                state["next_seed"] += block
                collector.open.clear()
                batch = env.reset()
            checks = collect_checks(run, checks)
        save(run, net, optimizer, state, book, rng)
    finally:
        env.close()
        for _, proc in checks:
            proc.wait()
        collect_checks(run, checks)


def start_check(run: Path, cfg: dict, update: int) -> subprocess.Popen:
    """Exports the latest weights and scores them in the background, without the bridge."""
    check = cfg["checks"]
    out = run / "exports" / f"{update:05d}"
    command = (
        f"{sys.executable} {ROOT / 'train' / 'export.py'} --run {run} --out {out} && "
        f"node {ROOT / 'scripts' / 'evaluate.ts'} --model {out}.ts --against {check.get('against', 'baseline')} --size {check['size']} "
        f"--games {check.get('games', 500)} --seeds {check.get('seeds', 2_500_000)}" + (f" --proposer {cfg['proposer']}" if cfg.get("proposer") else " --no-proposals")
    )
    return subprocess.Popen(command, shell=True, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def collect_checks(run: Path, checks: list) -> list:
    """Writes the checks that have finished to `checks.jsonl` and returns the ones still running."""
    running = []
    for update, proc in checks:
        if proc.poll() is None:
            running.append((update, proc))
            continue
        output = proc.stdout.read() if proc.stdout else ""
        with (run / "checks.jsonl").open("a") as f:
            f.write(json.dumps({"update": update, "code": proc.returncode, "output": output.strip().splitlines()[-3:]}) + "\n")
    return running


if __name__ == "__main__":
    main()
