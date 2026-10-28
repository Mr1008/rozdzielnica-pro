# Archive SHA repoint — 2026-10-28

- Target: `origin/master` @ `fc002b959eeab07f0fe0f50ef779d576bfc68eaa` (resolved with `git ls-remote --symref origin HEAD`, refreshed before diagnosis).
- Integration: no PR — the phase commits were pushed directly to `master` after two rebases onto `origin/master` (2026-10-27/28), which rewrote their SHAs.
- Evidence: each old commit has exactly one commit in the target history with the identical subject and an identical `git patch-id --stable`; every new SHA is an ancestor of the target snapshot.
- Decision: the user chose "Zaktualizuj i archiwizuj" (update and archive) in the archiving session.

| Row ID | Old suffix (resolved OID)                              | New SHA   | Subject                                                                                              |
| ------ | ------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------- |
| 1.1    | `4052220` (`4052220e0f280999b387247eb3b2fd3a12a6f7a4`) | `807ce99` | test(testing-layout-quote-invariants): quote worked examples through the matcher (p1)                |
| 1.2    | `4052220` (`4052220e0f280999b387247eb3b2fd3a12a6f7a4`) | `807ce99` | test(testing-layout-quote-invariants): quote worked examples through the matcher (p1)                |
| 1.3    | `4052220` (`4052220e0f280999b387247eb3b2fd3a12a6f7a4`) | `807ce99` | test(testing-layout-quote-invariants): quote worked examples through the matcher (p1)                |
| 2.1    | `46e1190` (`46e11902d809827f2afdf78f3904fc06680b3886`) | `39f1a66` | test(testing-layout-quote-invariants): quote property test (p2)                                      |
| 2.2    | `46e1190` (`46e11902d809827f2afdf78f3904fc06680b3886`) | `39f1a66` | test(testing-layout-quote-invariants): quote property test (p2)                                      |
| 2.3    | `46e1190` (`46e11902d809827f2afdf78f3904fc06680b3886`) | `39f1a66` | test(testing-layout-quote-invariants): quote property test (p2)                                      |
| 3.1    | `bdadff5` (`bdadff5e5a57261f45bea591e050e93636fbd753`) | `651438c` | test(testing-layout-quote-invariants): production Karwasz cabinets in the layout property tests (p3) |
| 3.2    | `bdadff5` (`bdadff5e5a57261f45bea591e050e93636fbd753`) | `651438c` | test(testing-layout-quote-invariants): production Karwasz cabinets in the layout property tests (p3) |
| 4.1    | `9f0f876` (`9f0f87653eab9c7fcc9cb0d013c79e032a29dce3`) | `adcfccf` | docs(testing-layout-quote-invariants): test-plan close-out and visual review (p4)                    |
| 4.2    | `9f0f876` (`9f0f87653eab9c7fcc9cb0d013c79e032a29dce3`) | `adcfccf` | docs(testing-layout-quote-invariants): test-plan close-out and visual review (p4)                    |

Repointed rows: 10.
