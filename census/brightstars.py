#!/usr/bin/env python3
"""Bright and nearby stars Gaia DR3 cannot measure (Sirius A, Vega, α Cen A/B, Betelgeuse…) from the Hipparcos new
reduction (van Leeuwen 2007, ESA Gaia archive table public.hipparcos_newreduction), for the 3D view, plus constellation
figures drawn between their true 3D positions.
usage: python3 census/brightstars.py hip.csv web/public/space/bright.json
"""
import csv, json, math, sys

RG = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
      [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]]
NAMES = {32349: "Sirius", 30438: "Canopus", 69673: "Arcturus", 71683: "Alpha Centauri A", 71681: "Alpha Centauri B", 91262: "Vega", 24608: "Capella",
         24436: "Rigel", 37279: "Procyon", 7588: "Achernar", 27989: "Betelgeuse", 68702: "Hadar", 97649: "Altair", 60718: "Acrux", 21421: "Aldebaran",
         80763: "Antares", 65474: "Spica", 37826: "Pollux", 113368: "Fomalhaut", 102098: "Deneb", 62434: "Mimosa", 49669: "Regulus", 33579: "Adhara",
         36850: "Castor", 61084: "Gacrux", 85927: "Shaula", 25336: "Bellatrix", 25428: "Elnath", 45238: "Miaplacidus", 26311: "Alnilam", 26727: "Alnitak",
         25930: "Mintaka", 27366: "Saiph", 54061: "Dubhe", 53910: "Merak", 58001: "Phecda", 59774: "Megrez", 62956: "Alioth", 65378: "Mizar", 67301: "Alkaid",
         11767: "Polaris", 59747: "Imai", 3179: "Schedar", 746: "Caph", 4427: "Gamma Cassiopeiae", 6686: "Ruchbah", 8886: "Segin", 72607: "Kochab",
         86032: "Rasalhague", 57632: "Denebola", 14576: "Algol", 10826: "Mira", 677: "Alpheratz", 5447: "Mirach", 9884: "Hamal", 15863: "Mirfak",
         109268: "Alnair", 90185: "Kaus Australis", 100751: "Peacock", 87833: "Eltanin", 82273: "Atria", 41037: "Avior", 34444: "Wezen", 44816: "Suhail"}
FIGURES = {"Orion": [(27989, 25336), (25336, 25930), (25930, 26311), (26311, 26727), (26727, 27366), (27366, 24436), (24436, 25930), (27989, 26727)],
           "Big Dipper": [(54061, 53910), (53910, 58001), (58001, 59774), (59774, 54061), (59774, 62956), (62956, 65378), (65378, 67301)],
           "Southern Cross": [(60718, 61084), (62434, 59747)],
           "Cassiopeia": [(746, 3179), (3179, 4427), (4427, 6686), (6686, 8886)]}


def bv_teff(bv):  # Ballesteros (2012)
    return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))


VW2 = [[400, 24], [700, 21], [1000, 18], [1300, 15.5], [1700, 12.5], [2200, 9.5], [2700, 7.5], [3100, 6], [3500, 4.4], [4000, 3.2], [5000, 2.0], [5800, 1.5],
       [7000, 0.8], [10000, 0.1], [30000, -0.6]]


def v_minus_w2(T):
    for (x0, y0), (x1, y1) in zip(VW2, VW2[1:]):
        if x0 <= T <= x1: return y0 + (y1 - y0) * (T - x0) / (x1 - x0)
    return VW2[0][1] if T < VW2[0][0] else VW2[-1][1]


def main(src, out):
    stars = []
    for r in csv.DictReader(open(src)):
        hip = int(r["hip"]); plx = float(r["plx"]); ra = float(r["ra"]); dec = float(r["dec"])
        dt = 2025.84 - 1991.25                                         # Hipparcos epoch -> 2025.84
        pma, pmd = float(r["pm_ra"] or 0), float(r["pm_de"] or 0)
        dec2 = dec + pmd / 3.6e6 * dt; ra2 = ra + pma / 3.6e6 * dt / math.cos(math.radians(dec))
        d = 1000 / plx; a, b = math.radians(ra2), math.radians(dec2)
        u = [math.cos(b) * math.cos(a), math.cos(b) * math.sin(a), math.sin(b)]
        ea = [-math.sin(a), math.cos(a), 0]; ed = [-math.sin(b) * math.cos(a), -math.sin(b) * math.sin(a), math.cos(b)]
        vt = [4.74047 * d * (ea[k] * pma + ed[k] * pmd) / 1000 for k in range(3)]   # km/s (tangential; no RV in Hipparcos)
        g = lambda v: [sum(RG[i][k] * v[k] for k in range(3)) for i in range(3)]
        bv = float(r["b_v"]) if r["b_v"] else 0.6; T = bv_teff(max(-0.3, min(2.2, bv)))
        V = float(r["hp_mag"]) - 0.1 * bv                               # Hp -> V (approx.)
        MV = V + 5 * math.log10(plx / 1000) + 5
        stars.append(dict(hip=hip, name=NAMES.get(hip, ""), p=[round(x * d, 4) for x in g(u)], v=[round(x, 2) for x in g(vt)], T=round(T), Mw2=round(MV - v_minus_w2(T), 2),
                          V=round(V, 2), d=round(d, 3), e=round(float(r["e_plx"]) / plx, 3)))
    json.dump(dict(source="Hipparcos new reduction (van Leeuwen 2007) via the ESA Gaia archive", epoch=2025.84, n=len(stars), stars=stars,
                   figures={k: v for k, v in FIGURES.items()}), open(out, "w"), separators=(",", ":"))
    print(len(stars), "stars;", sum(1 for s in stars if s["name"]), "named")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
