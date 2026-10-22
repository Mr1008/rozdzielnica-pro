"""Curate the raw Eaton/Legrand extraction into supabase/catalog/source/*.json.

Reads ../eaton-rcd-rcbo.json, ../eaton-mcb-fr-bars.json, ../legrand.json and writes
supabase/catalog/source/eaton.json and legrand.json (deterministic, re-runnable).
Run: python -I curate.py
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXTRACT = HERE.parent
REPO = HERE.parents[4]
OUT = REPO / "supabase" / "catalog" / "source"

CIRCUIT_IN = {6, 10, 13, 16, 20, 25, 32, 40, 50, 63}  # src/lib/circuit-params.ts:19
RESIDUAL_MA = {10, 30, 100, 300}  # src/lib/circuit-params.ts:29
KIND_ORDER = ["switch_disconnector", "rcd", "rcbo", "mcb_b", "comb_busbar", "pe_bar", "n_bar"]
FIELDS = [
    "kind", "manufacturer", "series", "model", "order_no", "poles", "rated_current_a",
    "residual_current_ma", "rcd_type", "breaking_capacity_ka", "modules", "width_mm",
    "height_mm", "depth_mm", "terminal_groups", "source",
]
BAD_RCD_TOKENS = {"S", "G", "HPI", "B+", "BFQ"}


def load(name):
    return json.loads((EXTRACT / name).read_text(encoding="utf-8"))


def bad_rcd_raw(raw):
    if not raw:
        return False
    if "selective" in raw.lower():
        return True
    return any(tok.strip().upper() in BAD_RCD_TOKENS for tok in raw.split("/"))


def notes_flag(r):
    n = (r.get("notes") or "").lower()
    return "hpi" in n or "selective" in n


def source_of(r):
    parts = []
    if r.get("page") is not None:
        parts.append(f"pdf p{r['page']}")
    seen = []
    for tok in (r.get("notes") or "").split():
        if tok.startswith("http"):
            u = tok.rstrip(";,.)\"'")
            if u not in seen:
                seen.append(u)
    parts.extend(seen)
    return "; ".join(parts) if parts else "web"


def common_ok(r):
    k = r["kind"]
    if k in ("mcb_b", "rcbo") and r["rated_current_a"] not in CIRCUIT_IN:
        return False
    if k in ("rcd", "rcbo"):
        if r["residual_current_ma"] not in RESIDUAL_MA:
            return False
        if bad_rcd_raw(r.get("rcd_type_raw")):
            return False
        if notes_flag(r):
            print("notes-backstop drop:", r["manufacturer"], r["model"], file=sys.stderr)
            return False
    return True


def eaton_ok(r):
    s, k = r["series"], r["kind"]
    if k == "mcb_b":
        return s == "PL6"
    if k == "rcd":
        if s == "PF6":
            return True
        if s == "FRCmM":
            return r["rcd_type"] in ("F", "B") or r["residual_current_ma"] == 10
        return False
    if k == "rcbo":
        return s in ("PFL6", "FRBm6")
    if k == "switch_disconnector":
        return s == "IS"
    if k == "comb_busbar":
        return s == "EVG" and "/HI" not in r["model"].upper()
    if k in ("pe_bar", "n_bar"):
        return s in ("KL", "SK-KLV", "BFZ-TS-KL")
    return False


LEGRAND_BARS = {"0048 30", "0048 40", "4048 39", "0048 15"}


def legrand_ok(r):
    s, k = r["series"], r["kind"]
    if k == "mcb_b":
        return s in ("S301 DX3", "S302 DX3", "S303 DX3", "S304 DX3", "S301N DX3")
    if k == "rcd":
        return s in ("P 302 DX3", "P 304 DX3")
    if k == "rcbo":
        return s == "P 312 DX3"
    if k == "switch_disconnector":
        return s == "FR 300" and not re.search(r"\sS$", r["model"].strip())
    if k == "comb_busbar":
        return (
            s in ("HX3 prong-type", "HX3 fork-type")
            and r["order_no"] != "4049 33"
            and r["rated_current_a"] is not None
        )
    if k in ("pe_bar", "n_bar"):
        return r["order_no"] in LEGRAND_BARS
    return False


def shape(r, legrand):
    out = {f: r.get(f) for f in FIELDS if f not in ("source", "model")}
    out["model"] = r["order_no"] if legrand else r["model"]
    out["source"] = source_of(r)
    return {f: out[f] for f in FIELDS}


def build(rows, ok, legrand):
    res, seen = [], {}
    for r in rows:
        if not (common_ok(r) and ok(r)):
            continue
        row = shape(r, legrand)
        key = (row["manufacturer"].lower(), row["model"].lower())
        if key in seen:
            if seen[key]["kind"] != row["kind"]:
                print("KIND-COLLISION kept first:", key, seen[key]["kind"], row["kind"], file=sys.stderr)
            continue
        seen[key] = row
        res.append(row)
    res.sort(key=lambda x: (KIND_ORDER.index(x["kind"]), x["model"]))
    return res


def write(name, rows):
    OUT.mkdir(parents=True, exist_ok=True)
    text = json.dumps(rows, indent=2, ensure_ascii=False) + "\n"
    (OUT / name).write_bytes(text.encode("utf-8"))


def main():
    eaton_raw = load("eaton-rcd-rcbo.json") + load("eaton-mcb-fr-bars.json")
    legrand_raw = load("legrand.json")
    eaton = build(eaton_raw, eaton_ok, False)
    legrand = build(legrand_raw, legrand_ok, True)
    write("eaton.json", eaton)
    write("legrand.json", legrand)
    from collections import Counter
    for n, rows in (("eaton", eaton), ("legrand", legrand)):
        print(n, len(rows), dict(Counter(r["kind"] for r in rows)))


main()
