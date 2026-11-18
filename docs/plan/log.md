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

## Tasks

### M1. Valuation

- 23:57 **Task 1, reference.** `node scripts/study.ts 300 --json build/study/ref.json`, then `--from` into `build/study/ref.md` (1,223 lines; 90 s on 8 processes). The report reprinted from a saved run omits the elapsed time, so later checks compare reprints. *Check:* passed.
- 00:05 **Task 2, solver.** `fitLinear` moved to `src/sim/linear.ts`; `test/linear.test.ts` recovers an exact 4 by 4 system and leaves an all-zero feature without a coefficient. *Check:* passed; the 300-game report is byte-identical to the reference.
