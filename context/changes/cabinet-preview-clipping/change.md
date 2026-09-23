---
change_id: cabinet-preview-clipping
title: Podgląd szafki nie rysuje elementów poza wnętrzem
status: new
created: 2026-09-23
updated: 2026-09-23
---

## Notes

Błąd znaleziony 2026-09-23 podczas S-01 (`admin-device-catalog`); pozostałość po S-02
(`admin-cabinet-catalog`, zarchiwizowane — nie edytować archiwum). GitHub:
https://github.com/Mr1008/rozdzielnica-pro/issues/13. Nie jest to element roadmapy.

**Objaw:** podgląd w edytorze szafki rysuje także geometrię odrzuconą przez `parseCabinetGeometry`.
Szyna wychodząca poza wnętrze jest rysowana poza ramką podglądu i nachodzi na komunikat pod nią.

**Reprodukcja:** wnętrze 400 × 300 × 100 mm, szyny DIN `x = 0`, `y = 100 / 225 / 350`, długość 400.
Szyna 3 (`350 + RAIL_HEIGHT_MM 35 = 385 > 300`) ma poprawny błąd walidacji, ale jest rysowana pod
kartą podglądu.

**Oczekiwane:**

- `src/components/cabinets/CabinetDrawing.tsx` nigdy nie rysuje poza wnętrzem (np. `clipPath`).
  Kontrakt `viewBox` = wnętrze w mm (1 jednostka SVG = 1 mm, potrzebne dla S-06) zostaje.
- Element z błędem geometrii jest w edytorze wyraźnie oznaczony (np. czerwony obrys, tokeny Tailwind).
- Poprawka w komponencie rysunku, bo używają go też lista szafek i wydruk (S-09).
- Reguły walidacji geometrii bez zmian. Warto sprawdzić `isDrawable` w `src/lib/cabinet-draft.ts`.

Następny krok: `/10x-plan cabinet-preview-clipping` (mała zmiana, można też od razu `/10x-implement`
po krótkim planie).
