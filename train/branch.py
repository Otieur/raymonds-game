"""
Starts a run from another run's checkpoint with a new configuration (M7, task 1).

    train/.venv/bin/python train/branch.py --from $DATA_DIR/runs/g3-s1 --config train/configs/g4.json --run $DATA_DIR/runs/g4-s1
        [--checkpoint 380] [--no-check] [--no-train] [--updates N]

The new run keeps the parent's weights. Its configuration is the parent's with the keys of the new
file laid over it, so only what the file names changes. The rest of the parent's training state
goes with the weights: the optimizer's moments, the book of results against each member, the past
selves, and the next training seed (unless the file names `seeds`). The file's `reset` list may name
`optimizer`, `book` and `selves` to start any of them afresh. With `past_selves.from_parent` and no
past selves carried over, the parent's exported checkpoints at every `past_selves.every` updates
become the first past selves (G4 takes the M6 learner's checkpoints so).

A branch is a run of its own: its update and decision counts start at 0, so its budget and every
schedule run from the start. Settings that are read against the run's own progress (the learning
rate, the entropy bonus, the shaping, the starting-policy pull and the critic's warm-up) therefore
start again from the merged configuration's values; a warning names those the file leaves to the
parent.

Before training, the branch's weights are exported and checked as update 0 with the run's check
settings, and the result is compared with the parent's check of the same checkpoint, which it
should reproduce exactly when the settings are the same. Then training starts as `run.py --resume`
would start it.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from model import Net  # noqa: E402
import run as training  # noqa: E402

RESETTABLE = ("optimizer", "book", "selves")
# Settings read against the run's own progress, which a branch starts again.
PROGRESS = ("lr", "entropy", "shaping", "kappa", "critic_warmup")
# What a check's output says about the play, without the model's name or the time a decision took.
FIGURE = re.compile(r"as the one among (.+?): ([\d.]+)% \(([-\d.]+) to ([-\d.]+)\) of (\d+) finished games; (\d+) fallbacks in (\d+) decisions")


def checkpoint_of(parent: Path, number: int | None) -> Path:
    """The parent's checkpoint with this update number, or its latest."""
    if number is None:
        found = training.latest(parent)
        if found is None:
            raise SystemExit(f"{parent} has no checkpoints.")
        return found
    path = parent / "checkpoints" / f"{number:05d}.pt"
    if not path.exists():
        raise SystemExit(f"{path} does not exist.")
    return path


def merged_config(parent_cfg: dict, overlay: dict) -> dict:
    """The parent's configuration with the overlay's keys laid over it (and defaults for keys newer than the parent)."""
    reset = overlay.get("reset", [])
    unknown = [name for name in reset if name not in RESETTABLE]
    if unknown:
        raise SystemExit(f"Cannot reset {', '.join(unknown)}; a branch can reset {', '.join(RESETTABLE)}.")
    return {**training.DEFAULTS, **parent_cfg, **overlay}


def left_to_parent(overlay: dict, cfg: dict) -> list[str]:
    """Settings read against the run's progress that the overlay does not name, and that will start again from the parent's values."""
    names = [name for name in PROGRESS if name not in overlay]
    return [name for name in names if not (name == "critic_warmup" and not cfg.get("critic_warmup"))]


def parent_selves(parent: Path, upto: int, every: int) -> list[str]:
    """The parent's exported checkpoints at every `every` updates up to `upto`, as past selves (the checks export one every few updates)."""
    found = []
    for path in sorted((parent / "exports").glob("*.ts")) if (parent / "exports").exists() else []:
        if path.stem.isdigit() and int(path.stem) % every == 0 and 0 < int(path.stem) <= upto:
            found.append(str(path.resolve()))
    return found


def branch(parent: Path, overlay: dict, run: Path, number: int | None = None) -> dict:
    """Writes the new run directory with its update-0 checkpoint; returns the merged configuration."""
    if training.latest(run) is not None:
        raise SystemExit(f"{run} already has checkpoints; resume it with run.py --resume instead.")
    parent_cfg = json.loads((parent / "config.json").read_text())
    path = checkpoint_of(parent, number)
    saved = torch.load(path, map_location="cpu", weights_only=False)
    cfg = merged_config(parent_cfg, overlay)
    reset = set(overlay.get("reset", []))
    cfg["branch"] = {
        "from": str(parent),
        "checkpoint": path.name,
        "update": saved["state"]["update"],
        "decisions": saved["state"]["decisions"],
        "named": sorted(overlay),
    }

    net = Net()
    net.load_state_dict(saved["net"])
    optimizer = torch.optim.Adam(net.parameters(), lr=cfg["lr"])
    if "optimizer" not in reset:
        optimizer.load_state_dict(saved["optimizer"])  # run.py sets the learning rate at every update
    state = {
        "update": 0,
        "decisions": 0,
        "games": 0,
        "next_seed": cfg["seeds"] if "seeds" in overlay else saved["state"]["next_seed"],
        "selves": [] if "selves" in reset else list(saved["state"].get("selves", [])),
    }
    selves = cfg.get("past_selves") or {}
    if selves.get("from_parent") and not state["selves"]:
        state["selves"] = parent_selves(parent, saved["state"]["update"], selves.get("every", 200))
    book = {} if "book" in reset else saved["book"]
    rng = np.random.default_rng(cfg["seed"])

    run.mkdir(parents=True, exist_ok=True)
    (run / "config.json").write_text(json.dumps(cfg, indent=2))
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=training.ROOT).stdout.strip()
    (run / "commit.txt").write_text(commit + "\n")
    torch.save(net.state_dict(), run / "weights.pt")
    (run / "checkpoints").mkdir(exist_ok=True)
    torch.save(
        {"net": net.state_dict(), "optimizer": optimizer.state_dict(), "state": state, "book": book, "rng": rng.bit_generator.state},
        run / "checkpoints" / f"{0:05d}.pt",
    )
    return cfg


def figures(lines: list[str]) -> list[tuple]:
    """The play figures of a check's output, one for each check setting, in order."""
    return [found.groups() for found in map(FIGURE.search, lines) if found]


def parent_check(parent: Path, update: int) -> list[str] | None:
    """The parent's logged check of an update, if it has one."""
    path = parent / "checks.jsonl"
    if not path.exists():
        return None
    for line in reversed(path.read_text().splitlines()):
        entry = json.loads(line)
        if entry.get("update") == update:
            return entry.get("output", [])
    return None


def compare(mine: list[str], theirs: list[str] | None) -> str:
    """Says whether the branch's first check reproduces the parent's."""
    if theirs is None:
        return "The parent has no check of this checkpoint to compare with."
    a, b = figures(mine), figures(theirs)
    if not a or not b:
        return "One of the two checks has no figure to compare (see checks.jsonl)."
    said = lambda f: f"{f[1]}% ({f[2]} to {f[3]}) of {f[4]} games, {f[6]} decisions"  # noqa: E731
    if a == b:
        return "The first check reproduces the parent's: " + "; ".join(map(said, a)) + "."
    return "The first check differs from the parent's: " + "; ".join(map(said, a)) + ", against " + "; ".join(map(said, b)) + "."


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="parent", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--checkpoint", type=int, default=None, help="The parent's update to branch from; its latest checkpoint by default.")
    parser.add_argument("--no-check", action="store_true", help="Skip the check of the branched weights.")
    parser.add_argument("--no-train", action="store_true", help="Write the run directory and stop.")
    parser.add_argument("--updates", type=int, default=None, help="Stop after this many updates (for trials).")
    args = parser.parse_args(argv)

    parent, run = Path(args.parent), Path(args.run)
    overlay = json.loads(Path(args.config).read_text())
    cfg = branch(parent, overlay, run, args.checkpoint)
    print(f"Branched {run} from {parent} at update {cfg['branch']['update']} ({cfg['branch']['decisions']} decisions).", flush=True)
    left = left_to_parent(overlay, cfg)
    if left:
        print(f"Not named by {args.config}, so started again from the parent's configured values: {', '.join(left)}.", flush=True)

    if cfg.get("checks") and not args.no_check:
        proc = training.start_check(run, cfg, 0)
        proc.wait()
        training.collect_checks(run, [(0, proc)])
        mine = json.loads((run / "checks.jsonl").read_text().splitlines()[-1]).get("output", [])
        same = json.loads((parent / "config.json").read_text()).get("checks") == cfg["checks"]
        theirs = parent_check(parent, cfg["branch"]["update"]) if same else None
        print(compare(mine, theirs) if same else "The check settings differ from the parent's, so the first check is not compared.", flush=True)

    if not args.no_train:
        training.main(["--resume", str(run)] + (["--updates", str(args.updates)] if args.updates else []))


if __name__ == "__main__":
    main()
