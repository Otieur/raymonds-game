# Work log

Unattended work on the plan in [README.md](README.md), from 17 November 2026, 23:55 EST. Times are EST. Run output is under `DATA_DIR=/Volumes/Elements/raymonds-game-data` unless a path says otherwise.

## Starting point

- Branch `frontend` at `4e72cb3`. Much of the project was uncommitted when this work began (the client in `web/`, `src/sim/heuristic-agent.ts`, changes under `src/engine/`, `scripts/`, `docs/`). Those changes are left unstaged. Each commit below adds only the files its task created or changed, so a commit may import files that exist only in the working tree.
- Machine: 10 cores, 16 GB of memory. Internal disk 24 GB free; external disk 440 GB free.
- Background jobs use 8 processes, leaving 2 for other work.

## Decisions

Choices made without the author, with the reason. Each is also noted at the task where it was made.

| When | Decision | Why |
| --- | --- | --- |
| 00:50 | A snapshot line also records `turn`, the seat whose turn is beginning. Cards held to leave jail are not recorded; a rebuilt state returns them to their decks. | The intervention study must play a position on from the right seat. Held jail cards are rare and recording which deck each came from would complicate the format for little. |
| 00:50 | The study gained `--only <prefix>` to play a subset of its tables. | The snapshot run needs only the three main tables, about a third of the study's full time. |

## Tasks

### M1. Valuation

- 23:57 **Task 1, reference.** `node scripts/study.ts 300 --json build/study/ref.json`, then `--from` into `build/study/ref.md` (1,223 lines; 90 s on 8 processes). The report reprinted from a saved run omits the elapsed time, so later checks compare reprints. *Check:* passed.
- 00:05 **Task 2, solver.** `fitLinear` moved to `src/sim/linear.ts`; `test/linear.test.ts` recovers an exact 4 by 4 system and leaves an all-zero feature without a coefficient. *Check:* passed; the 300-game report is byte-identical to the reference.
- 00:20 **Task 3, measures.** `View`, `viewOf`, `MEASURES` and their helpers moved to `src/sim/measures.ts`; a `View` now holds a `Context` instead of a study table, and net worth comes from the engine's query. `test/measures.test.ts` checks all twenty on hand-built positions: a built group with passes and a blocking street, a player one street short with a mortgage, a player in jail with nothing, everything mortgaged. *Check:* passed; the 300-game report is byte-identical to the reference.
- 00:35 **Task 4, landing rates and V0.** `--rates <file>` writes `src/sim/landing-rates.ts`; it works on a saved run, so the rates come from the 100,000-game run of 17 November rather than a new one. `src/sim/valuation.ts` has `staticIncome`, `marginalReturn` and `groupIncome`. *Check:* passed: the test reproduces 56.3 (Cao Wei at three), 6.3 (Han Court at three), 110.9 (Conquest of Shu at a fortress), 25.2 (four passes), 4.4 (both works) and 11.91 per 100 coins (Cao Wei's third building).
- 00:50 **Task 5, snapshots.** `src/sim/snapshot.ts`: `snapshotOf`, `stateOf`, the row format of M1 plus `turn`. The study writes snapshots with `--snapshots <dir>`: each chunk writes a part under a temporary name and the parts are joined in seed order at the end. `test/snapshot.test.ts` plays games with the rule-based agent, rebuilds a state at every fifth round and compares all twenty measures for every seat; it also checks that a rebuilt state passes the engine's invariants and plays on to the end with fresh draws. *Check:* passed over 200 games at each table size (by `SNAPSHOT_CHECK_GAMES=200`; `npm test` runs 8). The 300-game report is unchanged.
