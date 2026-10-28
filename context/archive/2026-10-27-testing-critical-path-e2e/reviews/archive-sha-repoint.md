# Archive SHA repoint — 2026-10-28

- Target: `origin/master` @ `fc002b959eeab07f0fe0f50ef779d576bfc68eaa` (resolved with `git ls-remote --symref origin HEAD`, refreshed before diagnosis).
- Integration: no PR — the phase commits were pushed directly to `master` after two rebases onto `origin/master` (2026-10-27/28), which rewrote their SHAs.
- Evidence: each old commit has exactly one commit in the target history with the identical subject and an identical `git patch-id --stable`; every new SHA is an ancestor of the target snapshot.
- Decision: the user chose "Zaktualizuj i archiwizuj" (update and archive) in the archiving session.

| Row ID | Old suffix (resolved OID)                              | New SHA   | Subject                                                                                      |
| ------ | ------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------- |
| 1.1    | `ed9b1f2` (`ed9b1f2cb321c2814dd4e717deb16d5ad2320bd4`) | `b00f1c5` | test(testing-critical-path-e2e): e2e harness with shared helpers and provisioned users (p1)  |
| 1.2    | `ed9b1f2` (`ed9b1f2cb321c2814dd4e717deb16d5ad2320bd4`) | `b00f1c5` | test(testing-critical-path-e2e): e2e harness with shared helpers and provisioned users (p1)  |
| 1.3    | `ed9b1f2` (`ed9b1f2cb321c2814dd4e717deb16d5ad2320bd4`) | `b00f1c5` | test(testing-critical-path-e2e): e2e harness with shared helpers and provisioned users (p1)  |
| 2.1    | `dddb7c0` (`dddb7c020b6caf3a311d66bf068705dba8ef912d`) | `cec355e` | test(testing-critical-path-e2e): IDOR via URL and form for another electrician (p2)          |
| 2.2    | `dddb7c0` (`dddb7c020b6caf3a311d66bf068705dba8ef912d`) | `cec355e` | test(testing-critical-path-e2e): IDOR via URL and form for another electrician (p2)          |
| 2.3    | `dddb7c0` (`dddb7c020b6caf3a311d66bf068705dba8ef912d`) | `cec355e` | test(testing-critical-path-e2e): IDOR via URL and form for another electrician (p2)          |
| 3.1    | `778c32d` (`778c32d6aa01e7b745c402d648bbc3296e943704`) | `9a24e16` | test(testing-critical-path-e2e): match state and circuit round-trip on the project page (p3) |
| 3.2    | `778c32d` (`778c32d6aa01e7b745c402d648bbc3296e943704`) | `9a24e16` | test(testing-critical-path-e2e): match state and circuit round-trip on the project page (p3) |
| 3.3    | `778c32d` (`778c32d6aa01e7b745c402d648bbc3296e943704`) | `9a24e16` | test(testing-critical-path-e2e): match state and circuit round-trip on the project page (p3) |
| 4.1    | `79ffed6` (`79ffed6719c3e41fb1fa6ce1029b912a1f1406b8`) | `85f8ef0` | test(testing-critical-path-e2e): labour-override endpoint refusals and server-side base (p4) |
| 4.2    | `79ffed6` (`79ffed6719c3e41fb1fa6ce1029b912a1f1406b8`) | `85f8ef0` | test(testing-critical-path-e2e): labour-override endpoint refusals and server-side base (p4) |
| 4.3    | `79ffed6` (`79ffed6719c3e41fb1fa6ce1029b912a1f1406b8`) | `85f8ef0` | test(testing-critical-path-e2e): labour-override endpoint refusals and server-side base (p4) |
| 5.1    | `6e8171d` (`6e8171d88df5e6a6b1b6c6eb8f872e389226072a`) | `b3193c6` | ci(testing-critical-path-e2e): e2e gate in the smoke job, close test-plan phase 3 (p5)       |
| 5.2    | `6e8171d` (`6e8171d88df5e6a6b1b6c6eb8f872e389226072a`) | `b3193c6` | ci(testing-critical-path-e2e): e2e gate in the smoke job, close test-plan phase 3 (p5)       |
| 5.3    | `6e8171d` (`6e8171d88df5e6a6b1b6c6eb8f872e389226072a`) | `b3193c6` | ci(testing-critical-path-e2e): e2e gate in the smoke job, close test-plan phase 3 (p5)       |
| 5.4    | `6e8171d` (`6e8171d88df5e6a6b1b6c6eb8f872e389226072a`) | `b3193c6` | ci(testing-critical-path-e2e): e2e gate in the smoke job, close test-plan phase 3 (p5)       |

Repointed rows: 16.

Also ticked manual row 5.5 (CI `smoke` green on GitHub Actions) with suffix `fc002b9`: https://github.com/Mr1008/rozdzielnica-pro/actions/runs/40661013905.
