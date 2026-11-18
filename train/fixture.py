"""
Writes a parity fixture: observations from a decision set, their masks, and the network's outputs
computed in PyTorch with its weights rounded to 16 bits, as the exported module stores them.

    train/.venv/bin/python train/fixture.py --run <dir> --data <set> --out <file.json> [--n 1000]
"""
import argparse
import json
from pathlib import Path

import numpy as np
import torch

from data import load_part, masks, parts
from model import Net

parser = argparse.ArgumentParser()
parser.add_argument("--run", required=True)
parser.add_argument("--data", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--n", type=int, default=1000)
args = parser.parse_args()
net = Net()
state = torch.load(Path(args.run) / "weights.pt", map_location="cpu")
net.load_state_dict({k: v.half().float() for k, v in state.items()})
records = load_part(parts(args.data)[0])[: args.n]
obs = torch.from_numpy(records["obs"].astype(np.float32))
mask = torch.from_numpy(masks(records))
with torch.no_grad():
    h = net.trunk(obs)
    logits = net.policy(h)
    value = net.value(h)
Path(args.out).write_text(
    json.dumps(
        {
            "obs": records["obs"].astype(np.float32).tolist(),
            "mask": mask.numpy().astype(int).tolist(),
            "logits": logits.numpy().tolist(),
            "value": value.numpy().tolist(),
        }
    )
)
print(f"Wrote {args.out}: {len(records)} observations.")
