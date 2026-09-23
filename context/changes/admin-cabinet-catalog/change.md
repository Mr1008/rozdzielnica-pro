---
change_id: admin-cabinet-catalog
title: Katalog szafek rozdzielnic prowadzony przez admina
status: implemented
created: 2026-09-23
updated: 2026-09-23
---

## Notes

S-02 z `context/foundation/roadmap.md` (issue #3). Wymaga F-01 (bramka roli admina, `is_admin()`).
Odblokowuje S-03 (wybór szafki do projektu) i S-05 (geometria, na której heurystyka rozmieszcza
aparaty).

### Kontrakty dla kolejnych plasterków (ustalone przy planowaniu 2026-09-23)

- **S-01:** szerokość aparatu w **milimetrach**, nie w modułach TE — geometria szafki jest w mm.
- **S-03:** przy wyborze szafki projekt **kopiuje** dokument `cabinets.geometry` (snapshot), żeby
  późniejsza edycja szafki przez admina nie przesuwała istniejących układów ani wycen.
- **S-06:** komponent SVG szafki rysuje w układzie współrzędnych w mm (`viewBox` = wnętrze szafki),
  więc drag-and-drop w edytorze elektryka mapuje zdarzenia wskaźnika bezpośrednio na mm.
