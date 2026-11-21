#!/bin/sh
# The second list of the work log ("To run when the disk is back"), started on the night of 20 November:
#   nohup caffeinate -i sh scripts/queue/disk-back-3.sh > /dev/null 2>&1 &
# Run from the repository. Every step skips work whose output exists, so the script can be started again
# at any point. Three lanes:
#   A and C: M9's suites and the runs that read them (scripts/queue/m9-suites.sh), ending in M9's two-player steps.
#   B, filler: the rest of M3b ($DATA_DIR/queue/disk-back-2.sh, whose steps run on background policy).
D=${DATA_DIR:-/Volumes/Elements/raymonds-game-data}
R=$(cd "$(dirname "$0")/../.." && pwd)
cd "$R" || exit 1
mkdir -p "$D/queue" "$D/probes" "$D/tables" "$D/paired"
LOG=$D/queue/disk-back-3.log
G1=$D/runs/g1-s1/exports/00180.ts
log() { echo "$(date '+%H:%M:%S') $*" >> "$LOG"; }

# made <output> <name> <command>: runs the command, whose standard output goes to <output> through a .part
# file, unless <output> exists. Other files a command writes are named in the command itself.
made() {
  out=$1; name=$2; shift 2
  if [ -s "$out" ]; then log "skip $name (done)"; return 0; fi
  log "start $name"
  if sh -c "$*" > "$out.part" 2>> "$out.err"; then mv "$out.part" "$out"; log "done $name"; else log "FAILED $name (see $out.err)"; return 1; fi
}
# low <name>: the same, on background policy (the slow cores).
low() { out=$1; name=$2; shift 2; made "$out" "$name" "taskpolicy -b sh -c '$*'"; }

log "disk-back-3 started"

(
  log "start m9-suites (lanes A and C)"
  sh scripts/queue/m9-suites.sh
  log "lanes A and C finished"
) &

(
  log "start disk-back-2"
  sh "$D/queue/disk-back-2.sh"
  log "lane B finished"
) &


wait
log "disk-back-3 finished"
