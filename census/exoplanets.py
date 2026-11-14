#!/usr/bin/env python3
"""Known planetary systems for the 3D Space view, from the NASA Exoplanet Archive (pscomppars).

Output (compact JSON): hosts as [name, x, y, z (Galactic heliocentric pc), teff, radius_Rsun, [[planet, R_earth, P_days, a_au, T_eq, year, method], ...]]
usage: python3 census/exoplanets.py ps.csv web/public/space/exoplanets.json
(ps.csv: TAP query  select hostname,pl_name,ra,dec,sy_dist,sy_pnum,st_teff,st_rad,pl_rade,pl_orbper,pl_orbsmax,pl_eqt,disc_year,discoverymethod from pscomppars)
"""
import csv, json, math, sys

RG = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
      [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]]


def num(v, d=None):
    try:
        x = float(v); return x if math.isfinite(x) else d
    except (TypeError, ValueError):
        return d


def main(src, out):
    hosts = {}
    for r in csv.DictReader(open(src)):
        d = num(r["sy_dist"]); ra, dec = num(r["ra"]), num(r["dec"])
        if d is None or ra is None or dec is None: continue
        h = hosts.get(r["hostname"])
        if not h:
            a, b = math.radians(ra), math.radians(dec)
            u = [math.cos(b) * math.cos(a), math.cos(b) * math.sin(a), math.sin(b)]
            g = [sum(RG[i][k] * u[k] for k in range(3)) * d for i in range(3)]
            h = hosts[r["hostname"]] = [r["hostname"], *[round(x, 3) for x in g], round(num(r["st_teff"], 0)), round(num(r["st_rad"], 0) or 0, 3), []]
        rd = lambda k, n: (round(num(r[k]), n) if num(r[k]) is not None else None)
        h[6].append([r["pl_name"], rd("pl_rade", 2), rd("pl_orbper", 3), rd("pl_orbsmax", 4), rd("pl_eqt", 0), int(num(r["disc_year"], 0)), r["discoverymethod"]])
    H = sorted(hosts.values(), key=lambda h: math.hypot(h[1], h[2], h[3]))
    json.dump(dict(source="NASA Exoplanet Archive, Planetary Systems Composite Parameters (pscomppars)", n_hosts=len(H),
                   n_planets=sum(len(h[6]) for h in H), fields=["host", "x", "y", "z", "teff", "rad", "planets[name,R_earth,P_days,a_au,Teq,year,method]"], hosts=H),
              open(out, "w"), separators=(",", ":"))
    print(len(H), "systems,", sum(len(h[6]) for h in H), "planets ->", out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
