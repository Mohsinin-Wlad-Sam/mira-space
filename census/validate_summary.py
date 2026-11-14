"""Summary of the field detector's control run (web/scripts/validate_detector.mts) for the Method page.

    python census/validate_summary.py <val_out.jsonl> [--out web/public/data/verified/detector_validation.json]

Two passes per field. "Gaia known": the detector as the Lab runs it. "Blind": the stars under test are removed from
the Gaia list before the detector runs, so nothing it knows about them comes from Gaia (the case of an object Gaia
does not list). Definitions used below:
  judged      the star is measured cleanly in the Gaia-known pass (not blended, saturated or at the field edge)
  flagged     the detector tags it "moved" (>= 5 sigma, >= 0.08 arcsec/yr, three or more dated positions)
  right       the measured motion is within max(3 sigma, 0.03 arcsec/yr) of the Gaia motion
  still star  Gaia proper motion below 0.04 arcsec/yr, measured cleanly, S/N >= 12, baseline > 5 yr
"""
import argparse, json, statistics as st, time

ap = argparse.ArgumentParser(); ap.add_argument("inp"); ap.add_argument("--out", default="")
a = ap.parse_args()
rows = {}
for line in open(a.inp):
    if line.strip():
        r = json.loads(line); rows[r["id"]] = r            # a field run twice keeps its last result
rows = list(rows.values()); ok = [r for r in rows if r.get("ok")]
mov = [r for r in ok if r["kind"] == "mover"]; blank = [r for r in ok if r["kind"] == "blank"]
BAD = {"SATURATED", "BLENDED", "EDGE"}
clean = lambda t: bool(t) and not (set(t.get("tags", [])) & BAD)
flag = lambda t: bool(t) and "MOVED" in t.get("tags", [])
def right(t, gp):
    if not t or not t.get("pm"): return False
    d = ((t["pm"][0] - gp[0]) ** 2 + (t["pm"][1] - gp[1]) ** 2) ** 0.5
    return d < max(3 * t["pm"][2], 0.03)
def dpm(t, gp): return ((t["pm"][0] - gp[0]) ** 2 + (t["pm"][1] - gp[1]) ** 2) ** 0.5
pct = lambda v, q: sorted(v)[min(len(v) - 1, int(q * len(v)))] if v else None

judged = [r for r in mov if clean(r["t"])]
kn_flag = [r for r in judged if flag(r["t"])]; kn_right = [r for r in kn_flag if right(r["t"], r["gp"])]
bl = [r for r in judged if r["b"].get("t") and not r["b"]["t"].get("lost")]         # the same stars, Gaia entry removed
bl_flag = [r for r in bl if flag(r["b"]["t"])]; bl_right = [r for r in bl_flag if right(r["b"]["t"], r["gp"])]
bl_unj = [r for r in bl if not flag(r["b"]["t"]) and not clean(r["b"]["t"])]
bins = [(0.15, 0.25), (0.25, 0.4), (0.4, 0.7), (0.7, 2.6)]
by = [[lo, hi, sum(1 for r in bl if lo <= r["gpm"] < hi), sum(1 for r in bl_flag if lo <= r["gpm"] < hi), sum(1 for r in bl_right if lo <= r["gpm"] < hi)] for lo, hi in bins]
still = sum(r["still"] for r in ok); still_mv = sum(r["stillMoved"] for r in ok)
bn = sum(r["b"]["n"] for r in ok); bmv = sum(r["b"]["moved"] for r in ok); blost = sum(r["b"]["lost"] for r in ok); bunj = sum(r["b"]["unjudged"] for r in ok); bother = sum(r["b"]["other"] for r in ok)
mv = [m + [r["id"]] for r in ok for m in r["b"]["mv"]]
nog = sum(r.get("noGaia", 0) for r in ok); nog_mv = sum(r["movedNoGaia"] for r in ok)
kd = [dpm(r["t"], r["gp"]) for r in kn_flag]; bd = [dpm(r["b"]["t"], r["gp"]) for r in bl_flag]
sd = [x for r in ok for x in r["b"]["dpm"]]
S = dict(attempted=len(rows), run=len(ok), failed=len(rows) - len(ok), movers=len(mov), empty_fields=len(blank), judged=len(judged),
         known=dict(flagged_all=sum(1 for r in mov if flag(r["t"])), flagged=len(kn_flag), right=len(kn_right), med=st.median(kd) if kd else None, p90=pct(kd, 0.9)),
         blind=dict(tested=len(bl), flagged=len(bl_flag), right=len(bl_right), not_judged=len(bl_unj), med=st.median(bd) if bd else None, p90=pct(bd, 0.9), linked=sum(1 for r in bl_flag if r["b"]["t"].get("linked")), by_motion=by),
         still=dict(known_n=still, known_flagged=still_mv, blind_n=bn, blind_flagged=bmv, blind_lost=blost, blind_not_judged=bunj, blind_other_gaia=bother, blind_flagged_list=mv,
                    blind_med=st.median(sd) if sd else None, blind_p90=pct(sd, 0.9), blind_p99=pct(sd, 0.99)),
         no_gaia=dict(n=nog, flagged=nog_mv),
         blank=dict(sources=sum(r["n"] for r in blank), bright=sum(r["bright"] for r in blank), fresh=sum(r["fresh"] for r in blank), variable=sum(r["variable"] for r in blank), gone=sum(r["gone"] for r in blank)),
         typical=dict(pmRms=st.median([r["pmRms"] for r in ok if r.get("pmRms")]), lim=st.median([r["lim"] for r in ok if r.get("lim")]), sec=st.median([r["sec"] for r in ok])))
print(json.dumps(S, indent=1))
if a.out:
    f3 = lambda v: f"{v:.3f}"; n = lambda v: f"{v:,}"; p = lambda x, y: f"{round(100 * x / max(1, y))}%"
    B, K, T = S["blind"], S["known"], S["still"]
    strict = T["blind_n"] - T["blind_other_gaia"]            # a removed star that picked up a neighbour's Gaia entry is not a blind test
    up = f"{100 * 3 / max(1, strict):.2f}%" if T["blind_flagged"] == 0 else None
    out = dict(built=time.strftime("%Y-%m-%d"), fields=S["run"], summary=S,
        note=f"{S['movers']} known Gaia DR3 movers (0.15–2.5 arcsec/yr, G 12.5–17.5) placed at the field centre and {S['empty_fields']} empty fields above 30° Galactic latitude; 6.6′ fields, 60 exposures. "
             f"Two passes: as the Lab runs, and blind (the stars under test are removed from the Gaia list first, so the detector knows nothing about them from Gaia, as for an object Gaia does not list). "
             f"web/scripts/validate_detector.mts, census/validate_summary.py.",
        rows=[
            ["Fields attempted · run", f"{S['attempted']} · {S['run']}"],
            ["Known moving stars at the field centre · measured cleanly (not blended, saturated or at the edge): only these are judged", f"{S['movers']} · {S['judged']}"],
            ["With Gaia known: flagged “moved” · with Gaia's motion (within 3σ or 0.03″/yr)", f"{K['flagged']} of {S['judged']} ({p(K['flagged'], S['judged'])}) · {K['right']}, median difference {f3(K['med'])}″/yr"],
            ["Blind (the star removed from Gaia before the detector runs): flagged “moved” · with Gaia's motion", f"{B['flagged']} of {B['tested']} ({p(B['flagged'], B['tested'])}) · {B['right']}, median difference {f3(B['med'])}″/yr"],
            ["… blind, by motion: " + " · ".join(f"{lo}–{2.5 if hi > 2.5 else hi}″/yr" for lo, hi, *_ in by), " · ".join(f"{fl} of {nn}" for _, _, nn, fl, _ in by)],
            ["Stars Gaia says are still (< 0.04″/yr), measured cleanly, tested blind (removed from Gaia a third at a time; those that then matched a neighbour's Gaia entry are left out)", n(strict)],
            ["… flagged “moved”: false alarms", f"{T['blind_flagged']}" + (f" (below {up} at 95% confidence)" if up else f" ({100 * T['blind_flagged'] / max(1, strict):.2f}%)")],
            ["… blind motion error of those still stars: median · 90% · 99% within", f"{f3(T['blind_med'])} · {f3(T['blind_p90'])} · {f3(T['blind_p99'])} ″/yr"],
            ["Sources without a Gaia motion flagged “moved” in these fields (real or false: not checked one by one)", f"{S['no_gaia']['flagged']} of {n(S['no_gaia']['n'])} ({100 * S['no_gaia']['flagged'] / max(1, S['no_gaia']['n']):.1f}%)"],
            [f"Empty fields, {n(S['blank']['sources'])} sources: flagged brighter or fainter · new · varying between visits · 2010 sources not seen today (none checked one by one)", f"{S['blank']['bright']} · {S['blank']['fresh']} · {S['blank']['variable']} · {S['blank']['gone']}"],
            ["Typical field: Gaia motions recovered to · smallest motion detectable at 5σ", f"{f3(S['typical']['pmRms'])}″/yr · {S['typical']['lim']:.2f}″/yr"]])
    json.dump(out, open(a.out, "w"), ensure_ascii=False, indent=1); print("wrote", a.out)
