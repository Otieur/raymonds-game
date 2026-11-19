"""
The value network (V2), M5 task 8: from an observation, the deciding seat's chance of winning.

    train/.venv/bin/python train/value.py --data <set>[,<set>] --val <set>[,<set>] --test <set>[,<set>] --run <dir> [--epochs 6]

The network is M5's (`model.Net`); its value head has one output for each table size, read as the
logit of the chance that the deciding seat wins. It is trained by binary cross-entropy on whether
that seat went on to win, keeps the epoch with the lowest validation loss, and reports on the test
sets, by table size, beside V1: V1's chance for the deciding seat is part of the observation (the
last number of the first seat block), so both are scored on the same decisions.

The gate of M5 bar 3: calibrated within 3 points in every tenth, and a lower log loss than V1 at each
table size, with the interval of the difference excluding zero. Decisions of one game are not
independent, so the interval is by bootstrap over games, not over decisions.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from data import batches, load_part, parts
from model import Net, table_size

V1_INDEX = 47  # the deciding seat's chance by V1: the last of the 48 numbers of the first seat block
EPS = 1e-6


def won_of(records: np.ndarray) -> np.ndarray:
    return (records["won"] > 0).astype(np.float32)


def chances(net: Net, records: np.ndarray, device: torch.device) -> np.ndarray:
    """V2's chance for the deciding seat of each record."""
    out = []
    net.eval()
    with torch.no_grad():
        for i in range(0, len(records), 8192):
            obs = torch.from_numpy(records["obs"][i : i + 8192].astype(np.float32)).to(device)
            mask = torch.ones((len(obs), 188), dtype=torch.bool, device=device)
            _, values, _ = net(obs, mask)
            logit = values.gather(1, table_size(obs).unsqueeze(1)).squeeze(1)
            out.append(torch.sigmoid(logit).cpu().numpy())
    net.train()
    return np.concatenate(out) if out else np.zeros(0)


def log_loss(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    p = np.clip(p, EPS, 1 - EPS)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def calibration(p: np.ndarray, y: np.ndarray, minimum: int = 200) -> list[dict]:
    """For each tenth of predicted chance: the decisions in it, the mean prediction and the share won."""
    rows = []
    for k in range(10):
        chosen = (p >= k / 10) & (p < (k + 1) / 10 if k < 9 else p <= 1)
        n = int(chosen.sum())
        rows.append({"tenth": k, "n": n, "predicted": float(p[chosen].mean()) if n else None, "won": float(y[chosen].mean()) if n else None, "counted": n >= minimum})
    return rows


def bootstrap_difference(a: np.ndarray, b: np.ndarray, games: np.ndarray, draws: int = 200, seed: int = 1) -> tuple[float, float, float]:
    """The mean of a - b, and a 95% interval by drawing whole games again with replacement."""
    rng = np.random.default_rng(seed)
    keys, index = np.unique(games, return_inverse=True)
    sums_a = np.bincount(index, weights=a)
    sums_b = np.bincount(index, weights=b)
    counts = np.bincount(index)
    means = []
    for _ in range(draws):
        pick = rng.integers(0, len(keys), len(keys))
        means.append((sums_a[pick].sum() - sums_b[pick].sum()) / counts[pick].sum())
    return float((a - b).mean()), float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def report(net: Net, records: np.ndarray, device: torch.device) -> dict:
    """V2 beside V1 on a set of records, for each table size it holds."""
    p2 = chances(net, records, device)
    p1 = records["obs"][:, V1_INDEX].astype(np.float64)
    y = won_of(records).astype(np.float64)
    sizes = table_size(torch.from_numpy(records["obs"].astype(np.float32))).numpy() + 2
    games = records["seed"].astype(np.int64)
    out = {}
    for size in sorted(set(sizes.tolist())):
        chosen = sizes == size
        l2 = log_loss(p2[chosen], y[chosen])
        l1 = log_loss(p1[chosen], y[chosen])
        diff, low, high = bootstrap_difference(l2, l1, games[chosen])
        cal = calibration(p2[chosen], y[chosen])
        gap = max((abs(r["predicted"] - r["won"]) for r in cal if r["counted"]), default=None)
        out[int(size)] = {
            "decisions": int(chosen.sum()),
            "games": int(len(np.unique(games[chosen]))),
            "v2": float(l2.mean()),
            "v1": float(l1.mean()),
            "difference": diff,
            "interval": [low, high],
            "calibration": cal,
            "largest_gap": gap,
        }
    return out


def load_all(spec: str) -> np.ndarray:
    return np.concatenate([load_part(f) for f in parts(spec)])


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--val", required=True)
    parser.add_argument("--test", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch", type=int, default=4096)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--weight-decay", type=float, default=0.0, help="AdamW weight decay; the first V2 overfitted its few thousand games")
    parser.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    args = parser.parse_args(argv)
    torch.manual_seed(args.seed)
    device = torch.device(args.device)
    run = Path(args.run)
    run.mkdir(parents=True, exist_ok=True)
    net = Net().to(device)
    optimizer = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=args.weight_decay) if args.weight_decay > 0 else torch.optim.Adam(net.parameters(), lr=args.lr)
    val = load_all(args.val)
    rng = np.random.default_rng(args.seed)
    best = None
    started = time.time()
    history = []
    for epoch in range(args.epochs):
        steps = 0
        for batch in batches(args.data, args.batch, rng):
            obs = torch.from_numpy(batch["obs"].astype(np.float32)).to(device)
            mask = torch.ones((len(obs), 188), dtype=torch.bool, device=device)
            target = torch.from_numpy(won_of(batch)).to(device)
            _, values, _ = net(obs, mask)
            logit = values.gather(1, table_size(obs).unsqueeze(1)).squeeze(1)
            loss = F.binary_cross_entropy_with_logits(logit, target)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            steps += 1
        loss_val = float(log_loss(chances(net, val, device), won_of(val)).mean())
        history.append({"epoch": epoch, "steps": steps, "val_loss": loss_val})
        print(f"epoch {epoch}: {steps} steps, validation log loss {loss_val:.4f}, {time.time() - started:.0f} s", flush=True)
        if best is None or loss_val < best[0]:
            best = (loss_val, epoch, {k: v.detach().clone() for k, v in net.state_dict().items()})
    net.load_state_dict(best[2])
    print(f"Kept epoch {best[1]} (validation log loss {best[0]:.4f}).")
    torch.save(net.state_dict(), run / "value.pt")
    result = report(net, load_all(args.test), device)
    (run / "value.json").write_text(json.dumps({"history": history, "kept": best[1], "test": result}, indent=2))
    for size, r in result.items():
        print(
            f"{size} players: {r['decisions']} decisions from {r['games']} games; log loss V2 {r['v2']:.4f}, V1 {r['v1']:.4f}, "
            f"difference {r['difference']:+.4f} ({r['interval'][0]:+.4f} to {r['interval'][1]:+.4f}); largest calibration gap {r['largest_gap'] * 100 if r['largest_gap'] is not None else float('nan'):.1f} points"
        )


if __name__ == "__main__":
    main()
