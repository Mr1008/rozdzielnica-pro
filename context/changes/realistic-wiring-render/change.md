---
change_id: realistic-wiring-render
title: Realistyczne okablowanie szafki
status: implementing
created: 2026-10-08
updated: 2026-10-08
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
