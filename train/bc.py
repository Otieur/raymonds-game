"""
Behaviour cloning: a masked classifier trained to predict the teacher's action.

    train/.venv/bin/python train/bc.py --data <set> --val <set> --run <dir> [--epochs 3] [--batch 4096]
    train/.venv/bin/python train/bc.py --data <set> --overfit            # memorise one batch
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from data import batches, load_part, masks, parts
from model import Net

KINDS = ["free", "buy", "auction", "buildingAuction", "debt", "mortgageTransfer", "jailExit", "trade"]
KIND_WEIGHTS = torch.tensor([1, 2, 2, 2, 2, 2, 2, 4], dtype=torch.float32)


def tensors(records: np.ndarray, device: torch.device):
    obs = torch.from_numpy(records["obs"].astype(np.float32)).to(device)
    mask = torch.from_numpy(masks(records)).to(device)
    action = torch.from_numpy(records["action"].astype(np.int64)).to(device)
    kind = torch.from_numpy(records["kind"].astype(np.int64)).to(device)
    return obs, mask, action, kind


def agreement(net: Net, records: np.ndarray, device: torch.device) -> dict:
    net.eval()
    hits = np.zeros(len(KINDS))
    counts = np.zeros(len(KINDS))
    loss = 0.0
    with torch.no_grad():
        for i in range(0, len(records), 8192):
            obs, mask, action, kind = tensors(records[i : i + 8192], device)
            logits, _, _ = net(obs, mask)
            loss += F.cross_entropy(logits, action, reduction="sum").item()
            right = (logits.argmax(1) == action).cpu().numpy()
            k = kind.cpu().numpy()
            for j in range(len(KINDS)):
                hits[j] += right[k == j].sum()
                counts[j] += (k == j).sum()
    net.train()
    by_kind = {KINDS[j]: (hits[j] / counts[j] if counts[j] else None, int(counts[j])) for j in range(len(KINDS))}
    return {"agreement": hits.sum() / max(1, counts.sum()), "loss": loss / max(1, counts.sum()), "byKind": by_kind}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--val")
    parser.add_argument("--run")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch", type=int, default=4096)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--overfit", action="store_true")
    parser.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    parser.add_argument("--trade-weight", type=float, default=4.0, help="loss weight of answering an offer")
    args = parser.parse_args()
    torch.manual_seed(args.seed)
    device = torch.device(args.device)
    net = Net().to(device)
    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)
    weights = KIND_WEIGHTS.clone()
    weights[7] = args.trade_weight
    weights = weights.to(device)
    started = time.time()

    if args.overfit:
        records = load_part(parts(args.data)[0])[: args.batch]
        obs, mask, action, kind = tensors(records, device)
        for step in range(3000):
            logits, _, _ = net(obs, mask)
            loss = (F.cross_entropy(logits, action, reduction="none") * weights[kind]).mean()
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            if step % 100 == 0 or step == 2999:
                right = (logits.argmax(1) == action).float().mean().item()
                print(f"step {step}: loss {loss.item():.4f}, agreement {right:.4f}", flush=True)
                if right > 0.99:
                    print(f"Memorised {len(records)} decisions in {step} steps, {time.time() - started:.0f} s.")
                    return
        print("Did not memorise the batch.")
        return

    rng = np.random.default_rng(args.seed)
    val = np.concatenate([load_part(f) for f in parts(args.val)]) if args.val else None
    history = []
    best = None  # (agreement, epoch, weights) of the best epoch on the validation set
    for epoch in range(args.epochs):
        steps = 0
        for batch in batches(args.data, args.batch, rng):
            obs, mask, action, kind = tensors(batch, device)
            logits, _, _ = net(obs, mask)
            loss = (F.cross_entropy(logits, action, reduction="none") * weights[kind]).mean()
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            steps += 1
        report = agreement(net, val, device) if val is not None else {}
        history.append({"epoch": epoch, "steps": steps, **{k: v for k, v in report.items() if k != "byKind"}})
        print(f"epoch {epoch}: {steps} steps, validation agreement {report.get('agreement', float('nan')):.4f}, loss {report.get('loss', float('nan')):.4f}, {time.time() - started:.0f} s", flush=True)
        if val is not None and (best is None or report["agreement"] > best[0]):
            best = (report["agreement"], epoch, {k: v.detach().clone() for k, v in net.state_dict().items()})
    last = {k: v.detach().clone() for k, v in net.state_dict().items()}
    if best is not None:
        # The run keeps the best epoch on the validation set, not the last.
        net.load_state_dict(best[2])
        print(f"Kept epoch {best[1]} (validation agreement {best[0]:.4f}).")
    if val is not None:
        final = agreement(net, val, device)
        print("Agreement by kind of decision:")
        for kind, (share, count) in final["byKind"].items():
            if count:
                print(f"  {kind}: {share:.4f} of {count}")
    if args.run:
        run = Path(args.run)
        run.mkdir(parents=True, exist_ok=True)
        torch.save(net.state_dict(), run / "weights.pt")
        torch.save(last, run / "last.pt")
        (run / "history.json").write_text(json.dumps(history, indent=2))


if __name__ == "__main__":
    main()
