"""
The losses and the update of proximal policy optimization with a clipped objective (Schulman and
others, 2017), for a policy with illegal actions masked out.

Beside the usual terms: advantages are normalized within the batch separately for each kind of
decision that has enough decisions in it; the entropy bonus and the loss weight differ by kind; and
the loss can carry a pull toward a starting policy, `kappa * KL(start || policy)`, which keeps a
learner near the teachers it was cloned from while its critic is still poor.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import torch
import torch.nn.functional as F

from model import table_size

# The kinds of decision, as the environment numbers them.
KINDS = ["free", "buy", "auction", "buildingAuction", "debt", "mortgageTransfer", "jailExit", "trade"]
ROLL, END_TURN = 0, 1


@dataclass
class PpoConfig:
    epochs: int = 4
    minibatch: int = 4096
    clip: float = 0.2
    value_weight: float = 0.5
    grad_clip: float = 0.5
    entropy: float = 0.01
    # The entropy bonus is halved for decisions where only rolling or ending the turn is at stake, and doubled for bids.
    entropy_by_kind: list = field(default_factory=lambda: [1.0, 1.0, 2.0, 2.0, 1.0, 1.0, 1.0, 1.0])
    # Loss weight by kind, as in behaviour cloning: 1, 2 and 4.
    kind_weights: list = field(default_factory=lambda: [1.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 4.0])
    normalize_min: int = 64
    kappa: float = 0.0
    # 0 while a critic is warmed up under a frozen policy: only the value loss then moves the network.
    policy_weight: float = 1.0


def normalize_by_kind(advantage: torch.Tensor, kind: torch.Tensor, minimum: int) -> torch.Tensor:
    """Advantages with zero mean and unit spread within each kind of decision that has `minimum` decisions; the rest by the whole batch."""
    out = advantage.clone()
    rest = torch.ones_like(kind, dtype=torch.bool)
    for k in kind.unique():
        chosen = kind == k
        if int(chosen.sum()) >= minimum:
            values = advantage[chosen]
            out[chosen] = (values - values.mean()) / (values.std() + 1e-8)
            rest &= ~chosen
    if int(rest.sum()) > 1:
        values = advantage[rest]
        out[rest] = (values - values.mean()) / (values.std() + 1e-8)
    elif int(rest.sum()) == 1:
        out[rest] = 0.0
    return out


def masked_entropy(logits: torch.Tensor) -> torch.Tensor:
    """The entropy of a masked policy; illegal actions carry no weight."""
    logp = F.log_softmax(logits, dim=1)
    p = logp.exp()
    return -(p * torch.where(torch.isfinite(logp), logp, torch.zeros_like(logp))).sum(dim=1)


def losses(net, batch: dict, cfg: PpoConfig, start=None) -> dict:
    """The terms of the loss on one minibatch. `batch` holds tensors: obs, mask, action, logp, advantage, returns, kind."""
    logits, values, _ = net(batch["obs"], batch["mask"])
    size = table_size(batch["obs"])
    value = values.gather(1, size.unsqueeze(1)).squeeze(1)
    logp_all = F.log_softmax(logits, dim=1)
    logp = logp_all.gather(1, batch["action"].unsqueeze(1)).squeeze(1)
    ratio = (logp - batch["logp"]).exp()
    advantage = batch["advantage"]
    weight = torch.tensor(cfg.kind_weights, device=logits.device)[batch["kind"]]
    surrogate = torch.minimum(ratio * advantage, ratio.clamp(1 - cfg.clip, 1 + cfg.clip) * advantage)
    policy_loss = -(surrogate * weight).mean()
    value_loss = F.mse_loss(value, batch["returns"])
    entropy = masked_entropy(logits)
    roll_only = batch["mask"][:, 2:].sum(dim=1) == 0  # nothing legal but rolling or ending the turn
    scale = torch.tensor(cfg.entropy_by_kind, device=logits.device)[batch["kind"]]
    scale = torch.where(roll_only, scale * 0.5, scale)
    entropy_bonus = (entropy * scale).mean()
    total = cfg.policy_weight * (policy_loss - cfg.entropy * entropy_bonus) + cfg.value_weight * value_loss
    out = {
        "policy": policy_loss,
        "value": value_loss,
        "entropy": entropy.mean(),
        "clipped": ((ratio - 1).abs() > cfg.clip).float().mean(),
    }
    if start is not None and cfg.kappa > 0:
        with torch.no_grad():
            start_logits, _, _ = start(batch["obs"], batch["mask"])
            start_logp = F.log_softmax(start_logits, dim=1)
            start_p = start_logp.exp()
        legal = batch["mask"]
        kl = (start_p * (torch.where(legal, start_logp, torch.zeros_like(start_logp)) - torch.where(legal, logp_all, torch.zeros_like(logp_all)))).sum(dim=1).mean()
        total = total + cfg.kappa * kl
        out["kl_start"] = kl
    out["total"] = total
    return out


def ppo_update(net, optimizer, data: dict, cfg: PpoConfig, start=None, device: str = "cpu", rng: np.random.Generator | None = None) -> dict:
    """Several epochs over the collected decisions. Returns the mean of each loss term."""
    rng = rng or np.random.default_rng(0)
    n = len(data["action"])
    tensors = {
        "obs": torch.as_tensor(data["obs"], dtype=torch.float32, device=device),
        "mask": torch.as_tensor(data["mask"], dtype=torch.bool, device=device),
        "action": torch.as_tensor(data["action"], dtype=torch.long, device=device),
        "logp": torch.as_tensor(data["logp"], dtype=torch.float32, device=device),
        "returns": torch.as_tensor(data["returns"], dtype=torch.float32, device=device),
        "kind": torch.as_tensor(data["kind"], dtype=torch.long, device=device),
    }
    tensors["advantage"] = normalize_by_kind(torch.as_tensor(data["advantage"], dtype=torch.float32, device=device), tensors["kind"], cfg.normalize_min)
    sums: dict[str, float] = {}
    steps = 0
    for _ in range(cfg.epochs):
        order = rng.permutation(n)
        for i in range(0, n, cfg.minibatch):
            index = torch.as_tensor(order[i : i + cfg.minibatch], device=device)
            terms = losses(net, {name: value[index] for name, value in tensors.items()}, cfg, start)
            optimizer.zero_grad()
            terms["total"].backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), cfg.grad_clip)
            optimizer.step()
            for name, value in terms.items():
                sums[name] = sums.get(name, 0.0) + float(value.detach())
            steps += 1
    return {name: value / max(1, steps) for name, value in sums.items()}


def act(net, obs: np.ndarray, mask: np.ndarray, device: str = "cpu", greedy: bool = False):
    """Samples an action for each row. Returns the actions, their log-probabilities and the critic's values."""
    with torch.no_grad():
        o = torch.as_tensor(obs, dtype=torch.float32, device=device)
        m = torch.as_tensor(mask, dtype=torch.bool, device=device)
        logits, values, _ = net(o, m)
        logp = F.log_softmax(logits, dim=1)
        action = logp.argmax(dim=1) if greedy else torch.distributions.Categorical(logits=logits).sample()
        value = values.gather(1, table_size(o).unsqueeze(1)).squeeze(1)
        return action.cpu().numpy(), logp.gather(1, action.unsqueeze(1)).squeeze(1).cpu().numpy(), value.cpu().numpy()
