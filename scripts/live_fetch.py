#!/usr/bin/env python3
"""Refresh MIRA's live NASA feeds into static files (run hourly by cron / GitHub Actions; no server needed).

Sources whose APIs do not allow browser (CORS) access are fetched here and saved under web/public/live/:
  * JPL Horizons: heliocentric positions of active spacecraft, daily for today-60 d .. today+60 d
  * JPL SBDB close-approach API + SBDB orbits: asteroids passing within 0.05 au of Earth in the next 60 days
  * NASA SDO: the Sun today (HMI continuum = visible surface with sunspots; AIA 171 Å = corona)
  * NASA EPIC (DSCOVR): the latest full-disc photo of Earth
Feeds that do allow browser access (NeoWs, DONKI CMEs, NASA Image Library) are called live from the page.
usage: python3 scripts/live_fetch.py [--out web/public/live]
"""
import argparse, datetime as dt, json, pathlib, time, urllib.parse, urllib.request

UA = {"User-Agent": "MIRA-live-fetch/1.0"}
SPACECRAFT = [("-31", "Voyager 1"), ("-32", "Voyager 2"), ("-98", "New Horizons"), ("-96", "Parker Solar Probe"), ("-170", "James Webb Space Telescope"),
              ("-61", "Juno"), ("-159", "Europa Clipper"), ("-49", "Lucy"), ("-255", "Psyche"), ("-144", "Solar Orbiter"), ("-121", "BepiColombo"),
              ("-28", "JUICE"), ("-91", "Hera")]


def get(url, binary=False, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                b = r.read(); return b if binary else json.loads(b.decode())
        except Exception as e:
            print("  retry", k, url[:90], e); time.sleep(3 * (k + 1))
    return None


def horizons(cmd, start, stop, step="1 d"):
    q = dict(format="json", COMMAND=f"'{cmd}'", OBJ_DATA="NO", MAKE_EPHEM="YES", EPHEM_TYPE="VECTORS", CENTER="'500@10'", REF_PLANE="ECLIPTIC",
             REF_SYSTEM="ICRF", VEC_TABLE="1", OUT_UNITS="AU-D", CSV_FORMAT="YES", START_TIME=f"'{start}'", STOP_TIME=f"'{stop}'", STEP_SIZE=f"'{step}'")
    j = get("https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(q))
    if not j or "result" not in j or "$$SOE" not in j["result"]: return None
    rows = j["result"].split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    out = []
    for r in rows:
        f = [x.strip() for x in r.split(",")]
        out.append([round(float(f[0]), 4), round(float(f[2]), 6), round(float(f[3]), 6), round(float(f[4]), 6)])   # JD, x, y, z (au, ecliptic J2000)
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="web/public/live"); a = ap.parse_args()
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None); d0, d1 = (now - dt.timedelta(days=60)).strftime("%Y-%m-%d"), (now + dt.timedelta(days=60)).strftime("%Y-%m-%d")
    live = dict(updated=now.strftime("%Y-%m-%dT%H:%MZ"), frame="heliocentric ecliptic J2000, au", spacecraft=[], asteroids=[], sun=None, earth=None)
    # ---- spacecraft (JPL Horizons)
    for cmd, name in SPACECRAFT:
        v = horizons(cmd, d0, d1)
        if v: live["spacecraft"].append(dict(id=cmd, name=name, track=v)); print("spacecraft", name, len(v))
        else: print("spacecraft", name, "unavailable")
    # ---- Sun-centred positions of the planets (daily, ±60 d) and of Earth + Moon (hourly, ±10 d): JPL Horizons DE ephemeris
    live["planets"] = {}
    for k, pid in enumerate(["199", "299", "399", "499", "599", "699", "799", "899"]):
        v = horizons(pid, d0, d1)
        if v: live["planets"][str(k)] = v
    h0, h1 = (now - dt.timedelta(days=10)).strftime("%Y-%m-%d %H:%M"), (now + dt.timedelta(days=10)).strftime("%Y-%m-%d %H:%M")
    for key, pid in (("earth_h", "399"), ("moon_h", "301")):
        v = horizons(pid, h0, h1, "1 h")
        if v: live[key] = v
    print("planets", len(live["planets"]), "earth/moon hourly", len(live.get("earth_h", [])), len(live.get("moon_h", [])))
    # ---- asteroids passing Earth (JPL CAD + SBDB orbits)
    cad = get("https://ssd-api.jpl.nasa.gov/cad.api?dist-max=0.05&date-min=now&date-max=%2B60&sort=dist&fullname=true")
    if cad and cad.get("data"):
        F = cad["fields"]
        for row in cad["data"][:30]:
            r = dict(zip(F, row)); s = get("https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=" + urllib.parse.quote(r["des"]) + "&phys-par=true")
            if not s or "orbit" not in s: continue
            el = {e["name"]: e["value"] for e in s["orbit"]["elements"]}
            phys = {p["name"]: p["value"] for p in s.get("phys_par", [])}
            live["asteroids"].append(dict(des=r["des"], name=r["fullname"].strip(), when=r["cd"], jd=float(r["jd"]), dist_au=float(r["dist"]), v_kms=float(r["v_rel"]),
                                          H=float(r["h"]) if r["h"] else None, diameter_km=float(phys["diameter"]) if phys.get("diameter") else None,
                                          epoch=float(s["orbit"]["epoch"]), e=float(el["e"]), a=float(el["a"]), i=float(el["i"]), om=float(el["om"]), w=float(el["w"]), ma=float(el["ma"])))
        print("asteroids", len(live["asteroids"]))
    # ---- the Sun today (SDO) and Earth today (EPIC)
    for key, url in (("sun_hmi.jpg", "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIIC.jpg"), ("sun_171.jpg", "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0171.jpg")):
        b = get(url, binary=True)
        if b: (out / key).write_bytes(b); print(key, len(b))
    live["sun"] = dict(hmi="sun_hmi.jpg", aia171="sun_171.jpg", source="NASA SDO (HMI continuum, AIA 171 Å), latest", fetched=live["updated"])
    ep = get("https://epic.gsfc.nasa.gov/api/natural")
    if ep:
        e = ep[-1]; d = e["date"][:10].replace("-", "/")
        b = get(f"https://epic.gsfc.nasa.gov/archive/natural/{d}/jpg/{e['image']}.jpg", binary=True)
        if b:
            (out / "earth.jpg").write_bytes(b)
            live["earth"] = dict(img="earth.jpg", date=e["date"], centroid=e["centroid_coordinates"], source="NASA EPIC camera on DSCOVR (1.5 million km away, at L1)")
            print("earth", e["date"], len(b))
    # ---- DONKI CMEs + NeoWs today, stored as a fallback for when the browser's direct (rate-limited) call fails
    import os
    key = os.environ.get("NASA_API_KEY", "DEMO_KEY")
    d10 = (now - dt.timedelta(days=10)).strftime("%Y-%m-%d"); today = now.strftime("%Y-%m-%d")
    cm = get(f"https://api.nasa.gov/DONKI/CMEAnalysis?startDate={d10}&endDate={today}&mostAccurateOnly=true&api_key={key}")
    if isinstance(cm, list): live["cmes"] = cm; print("cmes", len(cm))
    neo = get(f"https://api.nasa.gov/neo/rest/v1/feed?start_date={today}&end_date={today}&api_key={key}")
    if neo and "near_earth_objects" in neo:
        L = neo["near_earth_objects"].get(today, [])
        c = sorted(({"name": o["name"], "ld": float(o["close_approach_data"][0]["miss_distance"]["lunar"])} for o in L if o.get("close_approach_data")), key=lambda x: x["ld"])
        live["neo_today"] = dict(date=today, n=len(L), hazardous=sum(1 for o in L if o.get("is_potentially_hazardous_asteroid")), closest=c[0] if c else None); print("neo today", len(L))
    (out / "live.json").write_text(json.dumps(live, separators=(",", ":")))
    print("wrote", out / "live.json")


if __name__ == "__main__":
    main()
