---
change_id: realistic-wiring-render
title: Realistyczne okablowanie szafki
status: implementing
created: 2026-10-08
updated: 2026-10-09
---

## Notes

S-11 z `context/foundation/roadmap.md` (issue #32), poza zakresem PRD — rozszerzenie po zadaniach z
PRD (prośba użytkownika z 2026-10-07); FR-012 pośrednio. Wymaga S-09 (`printable-quote-export`):
plan powstaje teraz, implementacja rusza dopiero po S-09.

Decyzje użytkownika z planowania (2026-10-08):

- poziom „uber pro” jak `context/foundation/references/wiring/rozdzielnica-z-opaskami.webp`: żyły
  w wiązkach w kanałach przy bokach szafki, spięte opaskami — to zmienia trasy i długości (świadomie,
  wbrew pierwotnej notce „tylko prezentacja” w roadmapie);
- grubość w prawdziwej skali (średnica zewnętrzna wg przekroju), rozstaw torów per przewód zamiast
  stałego `WIRE_TRACK_PITCH_MM = 3`;
- przez wiązki idą wszystkie żyły kabli obwodów (L, N, PE — także do szyn) i WLZ; krótkie połączenia
  między aparatami (FR→RCD, RCD→MCB) zostają lokalne;
- gdy wiązka się nie mieści: druga warstwa za końcami szyn DIN + informacyjne ostrzeżenie po polsku,
  nigdy blokada;
- tabela średnic (i kolorów tulejek) przepisana ze źródłem, weryfikuje ją użytkownik jak `AMPACITY_A`;
- trasowanie zostaje na serwerze, ale budżet CPU mierzymy na prawdziwym Cloudflare (nie na tym
  komputerze); jeśli najgorszy przypadek nie mieści się w 10 ms — wyspa po stronie klienta;
- rysunek dostaje wariant `realistic` / `schematic` (te same trasy); wydruk wybiera S-09;
- widok realistyczny wszędzie na ekranie, plus przełącznik „Widok: realistyczny / schematyczny” na
  stronie projektu.

## Decision 2026-10-09 — Phase 4: pack = round tied bundle

Phase 4 stopped on a structural mismatch. Measured on today's routes with the plan's side rule:
flat, single-layer packs overflow on every realistic project. Seed (b) left strip is 9 mm (the vertical
PE/N bars take the rest) and needs 105 mm for 25 overlapping cores. The 12-circuit project on seed (c)
needs 73 mm in a 24 mm strip. The warning would fire on every normal project.

User decision (2026-10-09): a pack is a tied **round bundle**, as in
`references/wiring/rozdzielnica-z-opaskami.webp`, not a flat ribbon.

- Its width is `sqrt(Σ dᵢ² / PACK_FILL_FACTOR)`, with a named constant ≈ 0.6.
- It may use the side strip plus the band behind the rail ends (`BEHIND_DEVICES_MM`).
- Only cores beyond that capacity are overflow.
- Cores inside one bundle may overlap in the front view, and Phase 6 draws them that way.
- Estimates: seed (b) left ≈ 23 mm of 39 mm, seed (c) right ≈ 20 mm of 24 mm; both fit. The worst case
  (72 cores ≈ 39 mm) overflows, as the warning should.
- Fixed end-stub overlaps (Phase 3's `recordOverlaps`) do not count as overflow.
- Second stop (2026-10-09): packs fit (seed b left 25.6/39 mm; worst case 38.4 and 41.1/44 mm), but
  lanes and row channels stayed squeezed (seed b top lane ≈ 114 mm of cables in ≈ 53 mm). User decision:
  **bundles everywhere**. Lanes and row channels are round tied bundles too, sized by area like packs.
  Overflow means a bundle exceeds its channel's capacity, or no usable strip exists. Squeezed
  device-to-device feeds and fixed end-stub overlaps are recorded but never set `overflow`. If the worst
  case then shows no overflow, report it rather than forcing the test.
- Result (2026-10-09): with bundles everywhere nothing overflows on any seed fixture, the 60-circuit worst
  case included (packs 38.4/44 and 41.1/44 mm, bottom lane 64.1/98 mm). Progress 4.2 ("worst case
  produces `conductors_do_not_fit`") is therefore adapted: the worst-case test asserts the measured truth
  (no warning, peaks below capacity), and the warning is tested on a synthetic cramped cabinet (twelve
  16 mm² left-entry circuits on seed (c)) and on a cabinet with no strips.

## Decision 2026-10-09 — Phase 5: a third option, other hosting

Phase 5 has a third option besides "stay on the Worker server" and "move wiring to a client island":
move the app to different hosting where the worst-case render fits the CPU budget. Any provider will
do as long as it is free (user decision, 2026-10-09).

A move invalidates the Cloudflare-specific parts of the stack (Workers runtime, `wrangler.jsonc`,
`deploy.yml`, the KV `SESSION` binding, `context/foundation/infrastructure.md`). Weigh it against the
island before choosing, and record the choice with the measurements.

## Measurements

CPU per invocation from `wrangler tail --format json` (`cpuTime`, ms) on the bench Worker
`rozdzielnica-pro-wiring-bench` (Cloudflare, workerd), per `scripts/wiring-bench/README.md`: 5 warm-up +
30 measured requests per fixture, paced 1 s apart; all 70 invocations `outcome: ok`. Fixtures from
`src/lib/wiring-bench-fixtures.ts` — `worst`: 60 circuits, 20 RCD groups, seed (c), 241 conductors,
260 KB SVG; `realistic`: 12 circuits, 4 groups, seed (b), 60 conductors, 67 KB SVG.

| Date       | Router              | wrangler | Fixture   | Median CPU | Max CPU | Min | p90 |
| ---------- | ------------------- | -------- | --------- | ---------- | ------- | --- | --- |
| 2026-10-08 | v1 (baseline, S-06) | 4.131.1  | worst     | 30.5 ms    | 95 ms   | 14  | 67  |
| 2026-10-08 | v1 (baseline, S-06) | 4.131.1  | realistic | 10 ms      | 25 ms   | 4   | 20  |

Finding: today's router already exceeds the plan's server rule (median ≤ 8 ms, max ≤ 10 ms) on the
worst case by ~4× and sits at the median limit on the realistic fixture. The local Node figure
(7.9–10.2 ms) understated Cloudflare by ~3×. Workers Free allows occasional overruns per isolate
("built-in flexibility") and terminates only consistent overruns (Error 1102, `exceededCpu`), which is
why every request still succeeded. Phase 5's decision should expect the client island unless the
account moves to Workers Paid (30 s default CPU limit).
