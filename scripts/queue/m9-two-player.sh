#!/bin/sh
# M9's two-player steps (tasks 11 to 14): T1, T2 and the three seeds of T3, one training run at a time,
# then the gate of each seed and, from the median seed, the trade report and the promotion match.
#   nohup caffeinate -i sh scripts/queue/m9-two-player.sh > /dev/null 2>&1 &
# Run from the repository. Every step skips what is done: a run that has used its budget is not run
# again, one that stopped resumes from its last checkpoint, and a reading whose output exists is not
# made again. With DRY=1 the commands are logged instead of run, to check the order of work.
D=${DATA_DIR:-/Volumes/Elements/raymonds-game-data}
R=$(cd "$(dirname "$0")/../.." && pwd)
PY=$R/train/.venv/bin/python
SUITE=${SUITE:-test/fixtures/offers-2.json}
cd "$R" || exit 1
mkdir -p "$D/queue" "$D/gate"
LOG=$D/queue/m9-two-player.log
log() { echo "$(date '+%H:%M:%S') $*" >> "$LOG"; }

# finished <run>: whether the run's latest checkpoint has used its budget.
finished() { "$PY" - "$1" <<'PY'
import json, sys
from pathlib import Path
import torch
run = Path(sys.argv[1])
found = sorted((run / "checkpoints").glob("[0-9]*.pt")) if (run / "checkpoints").exists() else []
if not found: sys.exit(1)
state = torch.load(found[-1], map_location="cpu", weights_only=False)["state"]
sys.exit(0 if state["decisions"] >= json.loads((run / "config.json").read_text())["budget"] else 1)
PY
}

# best <run>: the update of the export with the best training check against the baseline.
best() { "$PY" - "$1/checks.jsonl" <<'PY'
import json, re, sys
best = None
for line in open(sys.argv[1]):
    row = json.loads(line)
    m = re.search(r"as the one among .*?: ([\d.]+)%", " ".join(row.get("output", [])))
    if m and (best is None or float(m.group(1)) > best[0]):
        best = (float(m.group(1)), row["update"])
print(f"{best[1]:05d}" if best else "")
PY
}

# train <run> <parent> <config> [checkpoint]: branch the run from its parent, or resume it.
train() {
  run=$1; parent=$2; config=$3; ck=$4
  if finished "$run"; then log "done $(basename "$run") (earlier)"; return 0; fi
  if [ -n "$DRY" ]; then log "would train $(basename "$run") from $(basename "$parent") with $config"; return 0; fi
  log "start $(basename "$run")"
  if [ -d "$run/checkpoints" ]; then
    (cd train && "$PY" run.py --resume "$run" >> "$run.out" 2>&1)
  else
    "$PY" train/branch.py --from "$parent" ${ck:+--checkpoint "$ck"} --config "$config" --run "$run" >> "$run.out" 2>&1
  fi
  if finished "$run"; then log "done $(basename "$run")"; else log "FAILED $(basename "$run") (see $run.out)"; return 1; fi
}

# reading <output> <command...>: made once, written through a .part file.
reading() {
  out=$1; shift
  [ -s "$out" ] && return 0
  if [ -n "$DRY" ]; then log "would run $*"; return 0; fi
  log "start $(basename "$(dirname "$out")")/$(basename "$out")"
  if "$@" > "$out.part" 2> "$out.log"; then mv "$out.part" "$out"; log "done $(basename "$(dirname "$out")")/$(basename "$out")"; else log "FAILED $(basename "$out") (see $out.log)"; return 1; fi
}

log "m9-two-player started${DRY:+ (dry)}"
[ -s "$SUITE" ] || { log "FAILED: the two-player offer suite $SUITE is missing; build it first (M9, task 6)"; exit 1; }

train "$D/runs/trade-t1-2" "$D/runs/g1-s1" train/configs/trade-t1.json 180 || exit 1
train "$D/runs/trade-t2-2" "$D/runs/trade-t1-2" train/configs/trade-t2.json || exit 1
for s in 1 2 3; do train "$D/runs/trade-t3-2-s$s" "$D/runs/trade-t2-2" "train/configs/trade-t3-s$s.json" || exit 1; done

# Each seed of T3, from the export with its best training check, drafting its own offers (no --proposer):
# bar 1 over 1,000 games with the suite; bar 2 over 5,000 games against the refuser in the same seat; bar 3 from bar 2.
for s in 1 2 3; do
  e=$(best "$D/runs/trade-t3-2-s$s")
  [ -n "$e" ] || { log "FAILED trade-2-s$s: no scored export"; exit 1; }
  M=$D/runs/trade-t3-2-s$s/exports/$e.ts
  O=$D/gate/trade-2-s$s
  mkdir -p "$O"
  echo "$M" > "$O/export.txt"
  reading "$O/bar1.txt" node scripts/evaluate.ts --model "$M" --size 2 --games 1000 --seeds 1000000 --workers 4 --suite "$SUITE" || exit 1
  reading "$O/bar2.txt" node scripts/evaluate.ts --model "$M" --size 2 --games 5000 --seeds 1000000 --compare refuser --workers 4 || exit 1
done

# The median seed by bar 1 (ties to the lower seed), then its trade report and its match for main-2.
median=$("$PY" - "$D/gate" <<'PY'
import re, sys
from pathlib import Path
shares = []
for s in (1, 2, 3):
    path = Path(sys.argv[1]) / f"trade-2-s{s}" / "bar1.txt"
    m = re.search(r"as the one among .*?: ([\d.]+)%", path.read_text()) if path.exists() else None
    if m: shares.append((float(m.group(1)), s))
if len(shares) == 3:
    middle = sorted(shares)[1][0]
    print(min(s for share, s in shares if share == middle))
PY
)
[ -n "$median" ] || { log "FAILED: bar 1 is missing for some seed${DRY:+ (in a dry run, write the bar 1 files first)}"; exit 1; }
O=$D/gate/trade-2-s$median
M=$(cat "$O/export.txt" 2>/dev/null || echo "$D/runs/trade-t3-2-s$median/exports/unknown.ts")
log "median seed $median: $M"
reading "$O/trade-report.md" node scripts/trade-report.ts --model "$M" --size 2 --suite "$SUITE" --games 5000 --workers 4 --json "$O/trade-report.json" || exit 1
reading "$O/promote-main-2.md" node scripts/promote.ts --line main-2 --challenger "model:$M?own" --workers 4 || exit 1
log "m9-two-player finished"
