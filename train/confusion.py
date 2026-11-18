"""Confusion of a clone's choice against the teacher's on free-turn decisions: train/.venv/bin/python train/confusion.py <weights.pt> <validation set>."""
import sys
from collections import Counter
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import numpy as np
import torch
from data import load_part, parts
from model import Net
from bc import tensors

FIXED = ['ROLL', 'END_TURN', 'PAY_BAIL', 'USE_JAIL_CARD', 'BUY', 'DECLINE', 'PASS', 'ACCEPT', 'REJECT', 'CANCEL', 'BANKRUPT', 'LIFT', 'KEEP']
def group(a):
    if a < 13: return FIXED[a]
    for name, lo, hi in [('BUILD', 13, 35), ('SELL', 35, 57), ('MORTGAGE', 57, 85), ('UNMORTGAGE', 85, 113), ('BID', 113, 121), ('ASK', 121, 149), ('GIVE', 149, 177), ('GIVE_NOTHING', 177, 178), ('CASH', 178, 187), ('DROP', 187, 188)]:
        if lo <= a < hi: return name
weights, val = sys.argv[1], sys.argv[2]
net = Net()
net.load_state_dict(torch.load(weights, map_location="cpu"))
net.eval()
rec = np.concatenate([load_part(f) for f in parts(val)])
rec = rec[rec["kind"] == 0]
obs, mask, action, kind = tensors(rec, torch.device("cpu"))
with torch.no_grad():
    pred = torch.cat([net(obs[i:i+8192], mask[i:i+8192])[0].argmax(1) for i in range(0, len(rec), 8192)]).numpy()
act = action.numpy()
print(f"{len(rec)} free-turn decisions; agreement {np.mean(pred == act):.4f}")
by_teacher = Counter(group(a) for a in act)
wrong = Counter((group(a), group(p)) for a, p in zip(act, pred) if a != p)
same_group_wrong = Counter(group(a) for a, p in zip(act, pred) if a != p and group(a) == group(p))
print("teacher's choice: count, share the clone matched")
for g, n in by_teacher.most_common():
    hit = np.mean([p == a for a, p in zip(act, pred) if group(a) == g])
    print(f"  {g}: {n}, {hit:.3f}")
print("most common disagreements (teacher -> clone):")
for (a, p), n in wrong.most_common(14):
    print(f"  {a} -> {p}: {n}")
print("disagreements within the same kind (e.g. a different street):", dict(same_group_wrong))
