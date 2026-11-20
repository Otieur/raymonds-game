"""
The training loop of reinforcement learning: collect decisions from the environments, update the
network by proximal policy optimization, move the schedules, write metrics and checkpoints.

    train/.venv/bin/python train/run.py --config train/configs/g1.json --run $DATA_DIR/runs/g1-s1
    train/.venv/bin/python train/run.py --resume $DATA_DIR/runs/g1-s1

A run directory holds the configuration it ran from, the commit, `metrics.jsonl` with one line an
update, `checks.jsonl` with the scores of exported checkpoints, `weights.pt` (the latest) and
`checkpoints/`. A run stopped at any point resumes from its last checkpoint.

Past selves (M7): with `past_selves` set, the learner's weights are exported to `selves/` every
`every` updates and join the league members its tables are drawn from, as `model:<path>`. At most
`newest` + `spread` are seated: the newest ones, and the rest spread evenly over the run's history.
Holders of a line are named in `members` or `holder` and are not counted against that number.
A branch (train/branch.py) carries its parent's selves.
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
from model import Net, widen_optimizer_state, widen_state_dict
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
    # Past selves among the league members (M7): {"every": 200, "newest": 4, "spread": 4}.
    "past_selves": None,
    # The learner's own offers (M9). None: the school proposes on every turn. {"share": 0.5}: the learner drafts
    # on half its turns. {"share": 0.5, "then": 1.0, "at": 0.3}: on half until 30% of the budget, then on all.
    "drafting": None,
    # Weights that draft decisions are pulled toward (M9's T2: the clone's offers), with a weight falling to 0.
    "pull": None,
    "kappa_draft": {"start": 0.0, "until": 0.5},
    # The entropy bonus on draft decisions, as a multiple of the general one.
    "draft_entropy": 2.0,
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
        "draft_share": draft_share(cfg, fraction),
        "kappa_draft": falling(*_kappa_draft(cfg), fraction) if cfg.get("pull") else 0.0,
    }


def _kappa_draft(cfg: dict) -> tuple[float, float]:
    k = cfg.get("kappa_draft") or DEFAULTS["kappa_draft"]
    return k["start"], k["until"]


def draft_share(cfg: dict, fraction: float) -> float:
    """The share of the learner's turns on which it drafts its own offers at a fraction of the budget (0 without drafting)."""
    drafting = cfg.get("drafting")
    if not drafting:
        return 0.0
    if drafting.get("then") is not None and fraction >= drafting.get("at", 1.0):
        return float(drafting["then"])
    return float(drafting["share"])


def kept_selves(history: list[str], newest: int, spread: int) -> list[str]:
    """The past selves seated: the newest `newest`, and `spread` more spread evenly over the older ones, in the order they were made."""
    recent = history[len(history) - newest:] if newest > 0 else []
    older = history[: len(history) - len(recent)]
    if spread <= 0 or not older:
        picks: list[str] = []
    elif len(older) <= spread:
        picks = older
    elif spread == 1:
        picks = [older[0]]
    else:
        picks = [older[round(i * (len(older) - 1) / (spread - 1))] for i in range(spread)]
    chosen = set(picks) | set(recent)
    return [self for self in history if self in chosen]


def members_now(cfg: dict, state: dict) -> list[str]:
    """The league members tables are drawn from: the configured ones, and the past selves seated now."""
    selves = cfg.get("past_selves")
    if not selves:
        return list(cfg["members"])
    kept = kept_selves(state.get("selves", []), selves.get("newest", 4), selves.get("spread", 4))
    return list(cfg["members"]) + [f"model:{path}" for path in kept]


def add_self(run: Path, net, state: dict) -> str:
    """Exports the current weights as a past self and records it; returns the exported file."""
    torch.save(net.state_dict(), run / "weights.pt")
    out = run / "selves" / f"{state['update']:05d}"
    out.parent.mkdir(exist_ok=True)
    subprocess.run([sys.executable, str(ROOT / "train" / "export.py"), "--run", str(run), "--out", str(out)], check=True, cwd=ROOT, capture_output=True)
    path = str(out.resolve()) + ".ts"
    state.setdefault("selves", []).append(path)
    return path


def draw_tables(cfg: dict, book: Book, rng: np.random.Generator, members: list[str] | None = None, share: float = 0.0) -> tuple[list[dict], list[str]]:
    """One environment configuration for each worker: a game (table size and rules) and a kind of table, each drawn by its share."""
    from opponents import sample_kind

    members = cfg["members"] if members is None else members

    games = cfg["games"]
    shares = np.array([g["share"] for g in games], dtype=np.float64)
    shares /= shares.sum()
    configs, labels = [], []
    for _ in range(cfg["workers"]):
        game = games[int(rng.choice(len(games), p=shares))]
        base = {"players": game["players"], "rules": game["rules"], "potentials": cfg["potentials"], "drafting": share > 0, "proposer": cfg["proposer"]}
        if share > 0:
            base["draftShare"] = share
        if cfg.get("opponents"):
            kind = "fixed"
            configs.append({**base, "learners": 1, "opponents": cfg["opponents"]})
        else:
            kind = sample_kind(rng)
            configs.append(table_config(kind, base, game["players"], members, book, cfg["holder"]))
        labels.append(f"{game['players']}p {game['rules']} {kind}")
    return configs, labels


def save(run: Path, net, optimizer, state: dict, book: Book, rng: np.random.Generator) -> None:
    torch.save(net.state_dict(), run / "weights.pt")
    (run / "checkpoints").mkdir(exist_ok=True)
    torch.save(
        {
            "net": net.state_dict(), "optimizer": optimizer.state_dict(), "state": state, "book": book.dump(), "rng": rng.bit_generator.state,
            # Torch's own generator samples the learner's actions; with it saved, a resumed run replays the run it continues.
            "torch_rng": torch.get_rng_state(),
        },
        run / "checkpoints" / f"{state['update']:05d}.pt",
    )


def restore(saved: dict, net, optimizer, book: Book, rng: np.random.Generator) -> dict:
    """Loads a checkpoint into the training objects; returns its state. Checkpoints written before 20 November have no torch generator."""
    net.load_state_dict(widen_state_dict(saved["net"]))
    optimizer.load_state_dict(widen_optimizer_state(saved["optimizer"], net))
    book.load(saved["book"])
    rng.bit_generator.state = saved["rng"]
    if "torch_rng" in saved:
        torch.set_rng_state(saved["torch_rng"].cpu())
    return saved["state"]


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
        net.load_state_dict(widen_state_dict(torch.load(cfg["start"], map_location=device)))
        start = copy.deepcopy(net).eval()
        for p in start.parameters():
            p.requires_grad_(False)
    pull = None
    if cfg.get("pull"):
        pull = Net().to(device)
        pull.load_state_dict(widen_state_dict(torch.load(cfg["pull"], map_location=device)))
        pull.eval()
        for p in pull.parameters():
            p.requires_grad_(False)
    optimizer = torch.optim.Adam(net.parameters(), lr=cfg["lr"])
    book = Book()
    state = {"update": 0, "decisions": 0, "games": 0, "next_seed": cfg["seeds"], "selves": []}

    checkpoint = latest(run) if args.resume else None
    if checkpoint:
        state = restore(torch.load(checkpoint, map_location=device, weights_only=False), net, optimizer, book, rng)

    n = cfg["workers"] * cfg["envs_per_worker"]
    block = n * 10_000  # seeds set aside for one drawing of the tables
    configs, labels = draw_tables(cfg, book, rng, members_now(cfg, state), schedules(cfg, state["decisions"] / cfg["budget"])["draft_share"])
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
            offers = {"drafted": 0, "draftedAccepted": 0, "school": 0, "schoolAccepted": 0}
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
                    for key in offers:
                        offers[key] += final.get("offers", {}).get(key, 0)
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
                draft_entropy=cfg.get("draft_entropy", DEFAULTS["draft_entropy"]), kappa_draft=now["kappa_draft"],
            )
            terms = ppo_update(net, optimizer, data, ppo, start, device, rng, pull)
            state["update"] += 1
            state["decisions"] += len(data["action"])
            state["games"] += finished
            done_here += 1
            line = {
                "update": state["update"], "decisions": state["decisions"], "games": finished, "cut_off": cut_off / max(1, finished),
                "turns": turns / max(1, finished), "result": float(np.mean(results)) if results else None,
                "wins": float(np.mean([r > 0 for r in results])) if results else None,
                "lr": now["lr"], "entropy_bonus": now["entropy"], "kappa": now["kappa"], "weights": now["weights"], "warming": warming,
                "draft_share": now["draft_share"], "kappa_draft": now["kappa_draft"],
                # The learner's offers a game, drafted by itself and made by its school, and the share of each accepted.
                "drafted": offers["drafted"] / max(1, finished), "drafted_accepted": offers["draftedAccepted"] / max(1, offers["drafted"]),
                "school_offers": offers["school"] / max(1, finished), "school_accepted": offers["schoolAccepted"] / max(1, offers["school"]),
                "tables": labels, "seconds": time.time() - began, "per_second": len(data["action"]) / max(1e-9, time.time() - began), **terms,
            }
            with (run / "metrics.jsonl").open("a") as f:
                f.write(json.dumps(line) + "\n")
            drafted = f", {line['drafted']:.2f} offers drafted a game ({line['drafted_accepted']:.0%} accepted)" if now["draft_share"] > 0 else ""
            print(f"update {line['update']}: {line['decisions']} decisions, {finished} games, wins {line['wins']}, entropy {terms.get('entropy', 0):.3f}, {line['per_second']:.0f} a second{drafted}", flush=True)

            if cfg.get("past_selves") and state["update"] % cfg["past_selves"]["every"] == 0:
                add_self(run, net, state)
            if state["update"] % cfg["checkpoint_every"] == 0:
                save(run, net, optimizer, state, book, rng)
                if cfg.get("checks"):
                    checks.append((state["update"], start_check(run, cfg, state["update"])))
            if state["update"] % cfg["tables_every"] == 0:
                configs, labels = draw_tables(cfg, book, rng, members_now(cfg, state), schedules(cfg, state["decisions"] / cfg["budget"])["draft_share"])
                env.remake(configs, state["next_seed"])
                state["next_seed"] += block
                collector.open.clear()
                batch = env.reset()
            checks = collect_checks(run, checks)
        save(run, net, optimizer, state, book, rng)
        if final_check_due(cfg, state, done_here):
            checks.append((state["update"], start_check(run, cfg, state["update"])))
    finally:
        env.close()
        for _, proc in checks:
            proc.wait()
        collect_checks(run, checks)


def final_check_due(cfg: dict, state: dict, done_here: int) -> bool:
    """Whether the weights a run ends with still need a check. Checks follow the checkpoints, every `checkpoint_every`
    updates, so a run whose budget runs out between two of them would leave its final weights unscored (G1's runs end at
    update 383). Not for a run stopped early with --updates, nor for one resumed after it had already used its budget."""
    return (
        bool(check_list(cfg))
        and done_here > 0
        and state["decisions"] >= cfg["budget"]
        and state["update"] % cfg["checkpoint_every"] != 0
    )


def check_list(cfg: dict) -> list[dict]:
    """The checks a run makes of each exported checkpoint: `checks` is one setting or a list of them (one for each table size, in M7)."""
    checks = cfg.get("checks")
    if not checks:
        return []
    return list(checks) if isinstance(checks, list) else [checks]


def start_check(run: Path, cfg: dict, update: int) -> subprocess.Popen:
    """Exports the latest weights and scores them in the background, without the bridge, once for each check setting.
    A setting with `suite` (an offer suite of that size, M9) also scores the model's answers to the suite's offers."""
    out = run / "exports" / f"{update:05d}"
    offers = f" --proposer {cfg['proposer']}" if cfg.get("proposer") else " --no-proposals"
    scores = " && ".join(
        f"node {ROOT / 'scripts' / 'evaluate.ts'} --model {out}.ts --against {check.get('against', 'baseline')} --size {check['size']} "
        f"--games {check.get('games', 500)} --seeds {check.get('seeds', 2_500_000)}{offers}"
        + (f" --suite {check['suite']}" if check.get("suite") else "")
        for check in check_list(cfg)
    )
    command = f"{sys.executable} {ROOT / 'train' / 'export.py'} --run {run} --out {out} && {scores}"
    return subprocess.Popen(command, shell=True, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def collect_checks(run: Path, checks: list) -> list:
    """Writes the checks that have finished to `checks.jsonl` and returns the ones still running."""
    running = []
    for update, proc in checks:
        if proc.poll() is None:
            running.append((update, proc))
            continue
        output = proc.stdout.read() if proc.stdout else ""
        if proc.stdout:
            proc.stdout.close()
        lines = output.strip().splitlines()
        # Every score's line (one for each check setting), or the last lines when there is none (an error).
        scored = [line for line in lines if " as the one among " in line or line.startswith("suite ")]
        with (run / "checks.jsonl").open("a") as f:
            f.write(json.dumps({"update": update, "code": proc.returncode, "output": scored or lines[-3:]}) + "\n")
    return running


if __name__ == "__main__":
    main()
