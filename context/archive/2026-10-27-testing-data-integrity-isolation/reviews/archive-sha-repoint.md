# Archive SHA repoint — 2026-10-28

- Target: `origin/master` @ `fc002b959eeab07f0fe0f50ef779d576bfc68eaa` (resolved with `git ls-remote --symref origin HEAD`, refreshed before diagnosis).
- Integration: no PR — the phase commits were pushed directly to `master` after two rebases onto `origin/master` (2026-10-27/28), which rewrote their SHAs.
- Evidence: each old commit has exactly one commit in the target history with the identical subject and an identical `git patch-id --stable`; every new SHA is an ancestor of the target snapshot.
- Decision: the user chose "Zaktualizuj i archiwizuj" (update and archive) in the archiving session.

| Row ID | Old suffix (resolved OID)                              | New SHA   | Subject                                                                                        |
| ------ | ------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------- |
| 1.1    | `330f146` (`330f146d3db99e174663e9bdfecc035d74abc2e4`) | `f71c3d5` | test(testing-data-integrity-isolation): RLS coverage guard (p1)                                |
| 1.2    | `330f146` (`330f146d3db99e174663e9bdfecc035d74abc2e4`) | `f71c3d5` | test(testing-data-integrity-isolation): RLS coverage guard (p1)                                |
| 1.3    | `330f146` (`330f146d3db99e174663e9bdfecc035d74abc2e4`) | `f71c3d5` | test(testing-data-integrity-isolation): RLS coverage guard (p1)                                |
| 1.4    | `330f146` (`330f146d3db99e174663e9bdfecc035d74abc2e4`) | `f71c3d5` | test(testing-data-integrity-isolation): RLS coverage guard (p1)                                |
| 2.1    | `c9cf030` (`c9cf03003a929e551cdcb53f179837e17847b6f5`) | `51ebbc9` | test(testing-data-integrity-isolation): CHECK-parser parity on shared fixtures (p2)            |
| 2.2    | `c9cf030` (`c9cf03003a929e551cdcb53f179837e17847b6f5`) | `51ebbc9` | test(testing-data-integrity-isolation): CHECK-parser parity on shared fixtures (p2)            |
| 2.3    | `c9cf030` (`c9cf03003a929e551cdcb53f179837e17847b6f5`) | `51ebbc9` | test(testing-data-integrity-isolation): CHECK-parser parity on shared fixtures (p2)            |
| 3.1    | `94233de` (`94233de3b55666d0bd1912fb617a67cc7adf7e73`) | `cec096c` | test(testing-data-integrity-isolation): device snapshot immutability (p3)                      |
| 3.2    | `94233de` (`94233de3b55666d0bd1912fb617a67cc7adf7e73`) | `cec096c` | test(testing-data-integrity-isolation): device snapshot immutability (p3)                      |
| 3.3    | `94233de` (`94233de3b55666d0bd1912fb617a67cc7adf7e73`) | `cec096c` | test(testing-data-integrity-isolation): device snapshot immutability (p3)                      |
| 4.1    | `2e53b93` (`2e53b937fa5111d7a8a5e18acd078835b72fdbe6`) | `7fb0500` | ci(testing-data-integrity-isolation): run test:integration in CI, close test-plan phase 2 (p4) |
| 4.2    | `2e53b93` (`2e53b937fa5111d7a8a5e18acd078835b72fdbe6`) | `7fb0500` | ci(testing-data-integrity-isolation): run test:integration in CI, close test-plan phase 2 (p4) |

Repointed rows: 12.

Also ticked manual row 4.3 (CI `smoke` green on GitHub Actions) with suffix `fc002b9`: https://github.com/Mr1008/rozdzielnica-pro/actions/runs/40661013905.
