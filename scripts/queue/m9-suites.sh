#!/bin/sh
# M9's suites and what reads them, as two lanes (scripts/queue/disk-back-3.sh starts this beside M3b's filler):
#   nohup caffeinate -i sh scripts/queue/m9-suites.sh > /dev/null 2>&1 &
# Run from the repository. Every step skips work whose output exists.
#   A, the critical path, at normal priority: snapshots of two-player games on fresh seeds, the two-player suite,
#      today's agents and G1 scored on it, then M9's two-player steps (scripts/queue/m9-two-player.sh).
#   C, on background policy: gate 7's remedy and Balancer's fix; snapshots and suites at three players and at four
#      players in the short game; today's agents scored on them; G1 evaluated with the two-player suite; the count of
#      accepted offers a draft cannot express.
# The suites take positions from seeds 2,500,000 on (docs/plan/m09-trading.md), away from the study's seeds that
# fitted the valuation, so their snapshots are written apart, in $DATA_DIR/snapshots-suite.
D=${DATA_DIR:-/Volumes/Elements/raymonds-game-data}
R=$(cd "$(dirname "$0")/../.." && pwd)
cd "$R" || exit 1
mkdir -p "$D/queue" "$D/probes" "$D/tables" "$D/paired" "$D/study" "$D/snapshots-suite"
LOG=$D/queue/m9-suites.log
G1=$D/runs/g1-s1/exports/00180.ts
S=$D/snapshots-suite
log() { echo "$(date '+%H:%M:%S') $*" >> "$LOG"; }

# made <output> <name> <command>: runs the command, whose standard output goes to <output> through a .part
# file, unless <output> exists. Other files a command writes are named in the command itself.
made() {
  out=$1; name=$2; shift 2
  if [ -s "$out" ]; then log "skip $name (done)"; return 0; fi
  log "start $name"
  if sh -c "$*" > "$out.part" 2>> "$out.err"; then mv "$out.part" "$out"; log "done $name"; else log "FAILED $name (see $out.err)"; return 1; fi
}
# low: the same, on background policy (the slow cores).
low() { out=$1; name=$2; shift 2; made "$out" "$name" "taskpolicy -b sh -c '$*'"; }
# snaps <table> <games>: snapshots of one study table on seeds from 2,500,000.
snaps() { echo "node scripts/study.ts $2 --only $1 --first-seed 2500000 --snapshots $S --workers 4"; }

log "m9-suites started"

(
  made "$D/study/suite-snapshots-full-2.md" snapshots-full-2 "$(snaps full-2 3000)" &&
  made "$D/probes/suite-2.md" suite-2 "node scripts/make-offer-suite.ts --snapshots $S --size 2 --players found-2-b1t2p2c1 --workers 6 --out test/fixtures/offers-2.json" &&
  made "$D/probes/score-suite-2.md" score-suite-2 "node scripts/score-suite.ts --suite test/fixtures/offers-2.json --members baseline,refuser,found-2-b1t2p2c1,model:$G1" &&
  { log "start m9-two-player"; sh scripts/queue/m9-two-player.sh; log "m9-two-player returned"; }
  log "lane A finished"
) &

(
  E='envoy+completeBy=list+goodwillBound=2+unreturned=1'
  B='balancer+completeBy=list+coldMood=0.15+coldEdge=-1'
  low "$D/tables/gate7-envoy-remedy-4.md" gate7-remedy "node scripts/table.ts --seats \"found-4-b2t1p1c2,baseline,$E,false-friend\" --games 5000 --seeds 1140000 --workers 4 --json $D/tables/gate7-envoy-remedy-4.json"
  low "$D/tables/gate7-remedy-paired-4.txt" gate7-remedy-paired "node scripts/compare-tables.ts $D/tables/gate7-envoy-remedy-4.json $D/tables/gate7-balancer-4.json --seats 3"
  low "$D/tables/two-4-balancers-cold.md" balancers-cold-4 "node scripts/table.ts --seats \"style-4,baseline,$B,$B\" --games 5000 --seeds 1120000 --workers 4 --json $D/tables/two-4-balancers-cold.json"
  low "$D/tables/two-3-balancers-cold.md" balancers-cold-3 "node scripts/table.ts --seats \"style-3,$B,$B\" --games 5000 --seeds 1130000 --workers 4 --json $D/tables/two-3-balancers-cold.json"
  for n in 3 4; do
    low "$D/paired/balancer-cold-$n.txt" balancer-cold-paired-$n "node scripts/paired.ts --size $n --a \"$B\" --b baseline --games 2000 --seeds 1100000 --workers 3"
  done
  low "$D/study/suite-snapshots-full-3.md" snapshots-full-3 "$(snaps full-3 3000)"
  low "$D/study/suite-snapshots-short-4.md" snapshots-short-4 "$(snaps short-4 15000)"
  low "$D/probes/suite-3.md" suite-3 "node scripts/make-offer-suite.ts --snapshots $S --size 3 --players statesman-book-2,found-3-b2t2p1c1,statesman-book-2 --workers 4 --out test/fixtures/offers-3.json"
  low "$D/probes/suite-4-short.md" suite-4-short "node scripts/make-offer-suite.ts --snapshots $S --size 4 --rules short --players statesman-book-2,found-4-b2t1p1c2,statesman-book-2,found-4-b2t1p1c2 --workers 4 --out test/fixtures/offers-4-short.json"
  low "$D/probes/score-suite-3.md" score-suite-3 "node scripts/score-suite.ts --suite test/fixtures/offers-3.json --members baseline,refuser,found-3-b2t2p1c1,statesman-book-2"
  low "$D/probes/score-suite-4-short.md" score-suite-4-short "node scripts/score-suite.ts --suite test/fixtures/offers-4-short.json --members baseline,refuser,found-4-b2t1p1c2,statesman-book-2"
  [ -s test/fixtures/offers-2.json ] && low "$D/probes/g1-evaluate-suite-2.md" g1-evaluate-suite-2 "node scripts/evaluate.ts --model $G1 --size 2 --games 1000 --proposer baseline --suite test/fixtures/offers-2.json --workers 4"
  for n in 2 3 4; do
    low "$D/probes/count-offers-$n.md" count-offers-$n "node scripts/count-offers.ts --size $n --games 2000 --workers 4"
  done
  log "lane C finished"
) &

wait
log "m9-suites finished"
