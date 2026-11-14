"""The verified catalogue: turn the raw-exposure measurements into what the web app serves.

inputs (in --dir):
  verified_raw.parquet   results of web/scripts/verify_census.mts joined with the census rows (census/verify_lists.py lists)
  gaia_hpm_union.csv     Gaia DR3 sources with proper motion > 100 mas/yr (ESA archive)
  cats.jsonl             AllWISE and 2MASS counterparts of the objects whose brightness seemed to change (optional)
  gaia_cone.jsonl        Gaia DR3 cone searches around confirmed movers with no high-motion Gaia star (optional)
outputs (in --out, default web/public/data/verified): meta.json, objects.json

usage: python census/verify_merge.py --dir <scratch dir> [--out web/public/data/verified]
"""
import argparse, json, os, pathlib, time

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

TREF = 2016.41                      # epoch of the census positions (MJD 57500)
ZP = {"W1": 0.943, "W2": 0.944}     # SPHEREx synthetic band flux / WISE flux, median over 10^4 confirmed ordinary stars
F0 = {"J": 1594e3, "K": 666.7e3, "W1": 309.54e3, "W2": 171.787e3}    # Vega zero points, mJy


def unit(ra, dec):
    a, d = np.radians(ra), np.radians(dec)
    return np.c_[np.cos(d) * np.cos(a), np.cos(d) * np.sin(a), np.sin(d)]


def mag(f, band):
    with np.errstate(invalid="ignore", divide="ignore"):
        return -2.5 * np.log10(np.where(f > 0, f, np.nan) / F0[band])


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dir", required=True); ap.add_argument("--out", default="web/public/data/verified"); a = ap.parse_args()
    d = pathlib.Path(a.dir); out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    m = pd.read_parquet(d / "verified_raw.parquet")
    L = m.lens.fillna(0).astype(int)
    dt = m.syr - TREF
    m["d_pred"] = np.hypot(m.se, m.sn); m["d_stat"] = np.hypot(m.se + m.pmra * dt, m.sn + m.pmdec * dt)
    # position error of the deep-stack centroid: formal + 0.25" (WCS) + confusion (9"/SNR, measured on Gaia stars in fields)
    m["sig"] = np.hypot(m.serr, 9 / m.ssnr.clip(lower=1)); m["sigp"] = np.hypot(m.sig, np.hypot(m.epm * dt, 0.3))
    det = m.ssnr >= 5; sat = m.sat > 0.5 * m.n
    moved = det & ~sat & (m.d_stat > 4 * m.sig) & (m.d_pred < 3 * m.sigp) & (m.d_stat > 2 * m.d_pred)
    static = det & ~sat & (m.d_stat < 2.5 * m.sig) & (m.d_pred > 4 * m.sigp)
    other = det & ~sat & (m.d_pred >= 3 * m.sigp) & (m.d_stat >= 4 * m.sig) & ~moved
    undet = (m.ok == 1) & ~det & ~sat
    m["status"] = np.select([sat, moved, static, other, undet], ["saturated", "moved", "static", "elsewhere", "undetected"], "unclear")
    motion = ((L & 1) > 0) | ((L & 16) > 0)

    def tally(mask):
        s = m[mask]; return {k: int((s.status == k).sum()) for k in ("moved", "static", "elsewhere", "undetected", "saturated", "unclear")} | {"tested": int(len(s))}
    funnel = {"motion_fast": tally((L & 1) > 0), "motion_slow_sample": tally(((L & 16) > 0) & ((L & 1) == 0))}
    bright = np.maximum(m.w1_uJy.fillna(0), m.w2_uJy.fillna(0))
    funnel["motion_fast_bright"] = tally(((L & 1) > 0) & (bright >= 1000))

    # ---------------- confirmed movers: position and motion re-measured over 2016.41 -> SPHEREx epoch
    c = m[motion & (m.status == "moved")].copy(); dtc = c.syr - TREF
    c["pmra_m"] = c.pmra + c.se / dtc; c["pmdec_m"] = c.pmdec + c.sn / dtc; c["epm_m"] = c.sig / dtc; c["pm_m"] = np.hypot(c.pmra_m, c.pmdec_m)
    c["ra_now"] = c.ra + (c.pmra * dtc + c.se) / 3600 / np.cos(np.radians(c.dec)); c["dec_now"] = c.dec + (c.pmdec * dtc + c.sn) / 3600
    c["conf"] = c.d_stat / c.sig
    # ---------------- Gaia: is it a known moving star?
    g = pd.read_csv(d / "gaia_hpm_union.csv")
    gra = g.ra + g.pmra / 3.6e6 * (TREF - 2016.0) / np.cos(np.radians(g.dec)); gdec = g.dec + g.pmdec / 3.6e6 * (TREF - 2016.0)
    tree = cKDTree(unit(gra.values, gdec.values))
    dist, j = tree.query(unit(c.ra.values, c.dec.values), distance_upper_bound=2 * np.sin(np.radians(4 / 3600) / 2))
    hit = np.isfinite(dist); jj = np.minimum(j, len(g) - 1)
    gp = np.hypot(g.pmra.values[jj] / 1000, g.pmdec.values[jj] / 1000)
    dmu = np.hypot(c.pmra_m.values - g.pmra.values[jj] / 1000, c.pmdec_m.values - g.pmdec.values[jj] / 1000)
    agree = hit & (dmu < np.maximum(0.06, 0.25 * gp))
    c["gaia"] = np.where(hit, g.source_id.values[jj].astype(str), ""); c["G"] = np.where(hit, g.phot_g_mean_mag.values[jj], np.nan); c["bprp"] = np.where(hit, g.bp_rp.values[jj], np.nan)
    c["plx"] = np.where(hit, g.parallax.values[jj], np.nan); c["gpm"] = np.where(hit, gp, np.nan); c["known"] = np.where(agree, 1, np.where(hit, 2, 0))
    # objects with no high-motion Gaia star: was any Gaia source there at all? (cone searches, when available)
    cone = {}
    if (d / "gaia_cone.jsonl").exists():
        for l in open(d / "gaia_cone.jsonl"):
            try: r = json.loads(l); cone[r["id"]] = r
            except Exception: pass
    def cone_of(r):
        q = cone.get(r.id)
        if r.known != 0 or q is None or q.get("g") is None: return pd.Series({"known": r.known, "gaia": r.gaia, "G": r.G, "gpm": r.gpm, "plx": r.plx, "bprp": r.bprp, "simbad": (q or {}).get("simbad") or ""})
        best = None
        for s in q["g"]:
            try: pmr, pmd = float(s.get("pmRA") or "nan") / 1000, float(s.get("pmDE") or "nan") / 1000
            except ValueError: pmr = pmd = float("nan")
            ok = np.isfinite(pmr) and np.hypot(r.pmra_m - pmr, r.pmdec_m - pmd) < max(0.06, 0.25 * np.hypot(pmr, pmd))
            if ok: best = (1, s, pmr, pmd); break
            if best is None: best = (3 if not np.isfinite(pmr) else 2, s, pmr, pmd)       # 3: a Gaia source without a measured motion
        if best is None: return pd.Series({"known": 0, "gaia": "", "G": np.nan, "gpm": np.nan, "plx": np.nan, "bprp": np.nan, "simbad": q.get("simbad") or ""})
        k, s, pmr, pmd = best; f = lambda v: float(v) if v not in (None, "") else np.nan  # noqa: E731
        return pd.Series({"known": k, "gaia": s.get("Source", ""), "G": f(s.get("Gmag")), "gpm": np.hypot(pmr, pmd), "plx": f(s.get("Plx")), "bprp": f(s.get("BP-RP")), "simbad": q.get("simbad") or ""})
    if len(cone):
        c[["known", "gaia", "G", "gpm", "plx", "bprp", "simbad"]] = c.apply(cone_of, axis=1)
    else:
        c["simbad"] = ""
    # ---------------- what kind of object: colours from SPHEREx itself, absolute magnitude from Gaia
    w12 = mag(c.W1.values / ZP["W1"], "W1") - mag(c.W2.values / ZP["W2"], "W2"); c["w12"] = w12
    ch4 = np.where((c.REF > 5 * c.eREF) & (c.REF > 0), c.CH4 / c.REF, np.nan); c["ch4"] = ch4
    MG = c.G + 5 * np.log10(np.clip(c.plx, 0.1, None) / 100)
    kind = np.where(np.isfinite(ch4) & (ch4 < 0.6) & (c.W2 > c.W1), "methane dwarf",
            np.where(np.isfinite(MG) & (c.plx > 2) & (MG > 10 + 2.6 * c.bprp) & (c.bprp < 1.9), "white dwarf",
            np.where(np.isfinite(c.bprp) & (c.bprp >= 1.8), "M dwarf", np.where(np.isfinite(c.bprp) & (c.bprp >= 0.9), "K dwarf", np.where(np.isfinite(c.bprp), "F/G star",
            np.where(np.isfinite(w12) & (w12 > 0.6), "red: brown dwarf?", np.where(np.isfinite(w12), "cool dwarf?", "unclassified")))))))
    c["kind"] = kind
    # a spectral type or object type in SIMBAD outranks a guess from colours
    def from_simbad(row):
        sb = row.simbad or ""
        if "(" not in sb: return "late M or L dwarf" if (np.isfinite(row.bprp) and row.bprp >= 4.3 and row.kind == "M dwarf") else row.kind
        inside = sb[sb.rindex("(") + 1:].rstrip(")"); parts = [x.strip() for x in inside.split(",", 1)]; ot = parts[0]; sp = parts[1] if len(parts) > 1 else ""
        t = sp.lstrip("d").lstrip("es").strip()
        if sp.startswith("sd") or sp.startswith("esd") or sp.startswith("usd"): return "subdwarf"
        if sp[:1] == "D" or ot.startswith("WD"): return "white dwarf"
        for letter, name in (("Y", "Y dwarf"), ("T", "T dwarf"), ("L", "L dwarf"), ("M", "M dwarf"), ("K", "K dwarf")):
            if t[:1] == letter: return name
        if t[:1] in ("G", "F", "A"): return "F/G star"
        if ot.startswith("BD"): return "brown dwarf"
        return row.kind
    c["kind"] = c.apply(from_simbad, axis=1)
    # ---------------- brightness changes against AllWISE (the census's own WISE fluxes turned out wrong for these lists)
    changes = []
    if (d / "cats.jsonl").exists():
        by = m.set_index("id")
        for l in open(d / "cats.jsonl"):
            try: r = json.loads(l)
            except Exception: continue
            if r["id"] not in by.index or not r.get("w"): continue
            o = by.loc[r["id"]]; o = o.iloc[0] if isinstance(o, pd.DataFrame) else o
            sg = 7.5 / 2.355; s1 = s2 = 0.0; own = None; flags = ""
            for k, w in enumerate(r["w"]):
                try: dd = float(w.get("_r") or 99)
                except ValueError: dd = 99
                wt = np.exp(-dd * dd / (4 * sg * sg))
                try: f1 = F0["W1"] * 10 ** (-0.4 * float(w["W1mag"]))
                except (ValueError, KeyError): f1 = 0
                try: f2 = F0["W2"] * 10 ** (-0.4 * float(w["W2mag"]))
                except (ValueError, KeyError): f2 = 0
                s1 += f1 * wt; s2 += f2 * wt
                if k == 0: own = (f1, f2, dd, w.get("AllWISE", "")); flags = f"{w.get('ccf', '')}|{w.get('ex', '')}|{w.get('var', '')}"
            if own is None or own[2] > 3 or s1 <= 0 or s2 <= 0: continue
            n1, n2 = o.W1 / ZP["W1"], o.W2 / ZP["W2"]
            if not (n1 > 0 and n2 > 0): continue
            r1, r2 = n1 / s1, n2 / s2
            z1 = np.log(r1) / np.hypot(0.06, (o.eW1 or 0) / o.W1); z2 = np.log(r2) / np.hypot(0.07, (o.eW2 or 0) / o.W2)
            kq = None
            if r.get("t"):
                try: kq = F0["K"] * 10 ** (-0.4 * float(r["t"][0]["Kmag"]))
                except (ValueError, KeyError): kq = None
            ccf = flags.split("|")[0][:2]; clean = ccf in ("00", "", "0") and flags.split("|")[1] in ("0", "")
            blend = max(own[0] / s1, own[1] / s2) < 0.7
            changes.append(dict(id=r["id"], ra=float(o.ra), dec=float(o.dec), allwise=own[3], w1_2010=s1, w2_2010=s2, w1_now=n1, w2_now=n2, r1=r1, r2=r2, z1=z1, z2=z2, k_1999=kq, k_now=(o.K if o.K and o.K > 0 else None),
                                snr=float(o.ssnr), clean=bool(clean), blend=bool(blend), var=flags.split("|")[2], w2_var_chi2=float(o.w2_var_chi2) if pd.notna(o.w2_var_chi2) else None, lens=int(o.lens) if pd.notna(o.lens) else 0,
                                d_pred=float(o.d_pred), J=o.J, H=o.H, simbad=(cone.get(r["id"]) or {}).get("simbad") or ""))
    ch = pd.DataFrame(changes)
    if len(ch):
        ok = ch.clean & ~ch.blend & (ch.snr >= 20)
        ch["verdict"] = np.where(ok & (ch.r2 > 1.5) & (ch.r1 > 1.3) & (ch.z1 > 5) & (ch.z2 > 5), "brighter", np.where(ok & (ch.r2 < 0.67) & (ch.r1 < 0.77) & (ch.z1 < -5) & (ch.z2 < -5), "fainter", "unchanged"))
        funnel["brightness_checked"] = {"tested": int(len(ch)), "clean": int(ok.sum()), "brighter": int((ch.verdict == "brighter").sum()), "fainter": int((ch.verdict == "fainter").sum()), "unchanged": int((ok & (ch.verdict == "unchanged")).sum())}
    # ---------------- methane
    me = m[((L & 2) > 0) & (m.ok == 1) & det & ~sat]; okr = me.REF > 5 * me.eREF
    funnel["methane"] = {"tested": int(((L & 2) > 0).sum()), "measurable": int(okr.sum()), "confirmed": int((okr & (me.CH4 / me.REF < 0.6) & (me.W2 > me.W1)).sum())}
    ch4ids = set(me[okr & (me.CH4 / me.REF < 0.6) & (me.W2 > me.W1)].id)

    # ---------------- write
    r3 = lambda v, n=3: [None if (x is None or not np.isfinite(x)) else float(np.format_float_positional(x, precision=n, unique=False, fractional=False, trim="-")) for x in v]  # noqa: E731
    c = c.sort_values("conf", ascending=False)
    cols = dict(id=list(c.id), ra=[round(x, 5) for x in c.ra_now], dec=[round(x, 5) for x in c.dec_now], pm=r3(c.pm_m), pmra=r3(c.pmra_m), pmdec=r3(c.pmdec_m), epm=r3(c.epm_m, 2), conf=r3(c.conf, 3), snr=r3(c.ssnr, 3),
                J=r3(c.J), H=r3(c.H), K=r3(c.K), W1=r3(c.W1 / ZP["W1"]), W2=r3(c.W2 / ZP["W2"]), w12=r3(c.w12, 2), ch4=r3(c.ch4, 2), w2_wise=r3(c.w2_uJy / 1000), known=[int(x) for x in c.known], gaia=list(c.gaia.astype(str)),
                G=r3(c.G, 4), gpm=r3(c.gpm), plx=r3(c.plx, 4), kind=list(c.kind), dp=r3(c.d_pred, 2), ds=r3(c.d_stat, 3), yr=r3(c.syr, 6), wpm=r3(c.pm), n=[int(x) for x in c.n], simbad=list(c.simbad.fillna("").astype(str)), slow=[int(x) for x in (((c.lens.astype(int) & 1) == 0))], methane=[int(i in ch4ids) for i in c.id])
    (out / "objects.json").write_text(json.dumps(dict(n=len(c), cols=cols), separators=(",", ":")))
    if len(ch):
        cv = ch[ch.verdict != "unchanged"].sort_values("z2", key=lambda s: -s.abs())
        (out / "changes.json").write_text(json.dumps(dict(n=len(cv), rows=[{k: (None if isinstance(v, float) and not np.isfinite(v) else (round(v, 4) if isinstance(v, float) else v)) for k, v in r.items()} for r in cv.to_dict("records")]), separators=(",", ":")))
    known = c.known.value_counts().to_dict()
    meta = dict(built=time.strftime("%Y-%m-%d %H:%M"), epoch_census=TREF, zp=ZP, claims=dict(motion_fast=177221, motion_slow=1014881, methane=70097, brightened=192074, vanished=112240, total=1564553),
                remeasured=int(len(m)), funnel=funnel, confirmed_movers=int(len(c)), movers_known=int(known.get(1, 0)), movers_gaia_other=int(known.get(2, 0)), movers_gaia_nopm=int(known.get(3, 0)), movers_no_gaia=int(known.get(0, 0)),
                gaia_list="Gaia DR3, proper motion > 100 mas/yr (499,359 of 506,589 sources retrieved)" + ("; cone searches for the rest" if len(cone) else ""),
                kinds=c.kind.value_counts().to_dict(), cone_checked=len(cone),
                rule="moved: the deep-stack centroid lies within 3 sigma of where the WISE-era motion predicts and more than 4 sigma (and twice as far) from where it would be if it had not moved")
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta, indent=1)[:3000])
    # list for the Gaia cone searches (objects with no high-motion Gaia star)
    c[c.known == 0][["id", "ra", "dec", "pmra_m", "pmdec_m"]].to_csv(d / "need_cone.csv", index=False)
    print("need cone:", int((c.known == 0).sum()), "| changes file rows:", 0 if not len(ch) else int((ch.verdict != "unchanged").sum()))


if __name__ == "__main__":
    main()
