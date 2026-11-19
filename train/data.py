"""
Reads the decision sets written by scripts/make-dataset.ts.

A set is a directory of part files of fixed-size records and an index.json. `records(path)` maps
every part as a structured NumPy array; `batches(...)` yields shuffled batches, holding a few parts
in memory at a time.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

OBS_SIZE = 1023
OBS_VERSION = 3
ACTIONS = 188
_O = OBS_SIZE * 2
RECORD_BYTES = _O + 46

RECORD = np.dtype(
    {
        "names": ["obs", "legal", "action", "kind", "won", "place", "teacher", "seed", "step"],
        "formats": [("<f2", (OBS_SIZE,)), ("u1", (24,)), "<i2", "i1", "i1", "i1", "<i2", "<i4", "<i4"],
        "offsets": [0, _O, _O + 24, _O + 26, _O + 27, _O + 28, _O + 30, _O + 32, _O + 36],
        "itemsize": RECORD_BYTES,
    }
)


def index(path: str | Path) -> dict:
    info = json.loads((Path(path) / "index.json").read_text())
    if info.get("obs", OBS_SIZE) != OBS_SIZE or info.get("recordBytes", RECORD_BYTES) != RECORD_BYTES:
        raise ValueError(
            f"{path} was written with {info.get('obs')} numbers an observation (layout version {info.get('obsVersion')}); "
            f"this build reads {OBS_SIZE} (version {OBS_VERSION}). Write the set again."
        )
    return info


def parts(path: str | Path) -> list[Path]:
    """The part files of a set, or of several sets given as one comma-separated string."""
    if "," in str(path):
        return [f for one in str(path).split(",") for f in parts(one)]
    info = index(path)
    return [Path(path) / f"part-{p['part']:05d}.bin" for p in info["parts"]]


def load_part(file: Path) -> np.ndarray:
    return np.fromfile(file, dtype=RECORD)


def masks(records: np.ndarray) -> np.ndarray:
    """The legal actions of each record as a [N, 188] boolean array."""
    bits = np.unpackbits(records["legal"], axis=1, bitorder="little")
    return bits[:, :ACTIONS].astype(bool)


def batches(path: str | Path, batch: int, rng: np.random.Generator, hold: int = 4):
    """Every record of a set once, in a new order: parts shuffled, `hold` parts mixed at a time."""
    files = parts(path)
    rng.shuffle(files)
    for i in range(0, len(files), hold):
        chunk = np.concatenate([load_part(f) for f in files[i : i + hold]])
        order = rng.permutation(len(chunk))
        for j in range(0, len(order), batch):
            yield chunk[order[j : j + batch]]


if __name__ == "__main__":
    import sys

    info = index(sys.argv[1])
    data = np.concatenate([load_part(f) for f in parts(sys.argv[1])])
    m = masks(data)
    assert data.shape[0] == info["decisions"], (data.shape, info["decisions"])
    assert m[np.arange(len(data)), data["action"]].all(), "a recorded action is not in its mask"
    print(f"{info['set']}: {len(data)} records, {info['games']} games; every recorded action is legal; actions used: {len(np.unique(data['action']))}; mean legal actions {m.sum(1).mean():.1f}")
