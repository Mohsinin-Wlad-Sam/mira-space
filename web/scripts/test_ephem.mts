// Check src/ephem.ts against JPL Horizons (geocentric astrometric RA/Dec, ICRF) on a few dates.
//   npx tsx scripts/test_ephem.mts
import { bodiesAt, yearOf } from "../src/ephem";
const IDS: Record<string, string> = { Sun: "10", Moon: "301", Mercury: "199", Venus: "299", Mars: "499", Jupiter: "599", Saturn: "699", Uranus: "799", Neptune: "899" };
const DATES = ["1999-07-01", "2010-07-01", "2026-11-15", "2027-06-01"];
const sep = (a: number, d: number, a2: number, d2: number) => { const r = Math.PI / 180, c = Math.sin(d * r) * Math.sin(d2 * r) + Math.cos(d * r) * Math.cos(d2 * r) * Math.cos((a - a2) * r); return Math.acos(Math.min(1, c)) / r; };
let worst: Record<string, number> = {};
for (const date of DATES) {
  const yr = yearOf(Date.parse(date + "T00:00:00Z")), mine = bodiesAt(yr);
  for (const [name, id] of Object.entries(IDS)) {
    const u = `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='${id}'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='500@399'&START_TIME='${date}'&STOP_TIME='${date} 00:01'&STEP_SIZE='1 m'&QUANTITIES='1,9'&ANG_FORMAT='DEG'&CSV_FORMAT='YES'`;
    const t = await (await fetch(u)).text(), row = t.split("$$SOE")[1]?.split("\n")[1]?.split(",").map((x) => x.trim());
    if (!row) { console.log(name, date, "no answer"); continue; }
    const ra = +row[3], dec = +row[4], mag = +row[5], b = mine.find((q) => q.name === name)!, d = sep(ra, dec, b.ra, b.dec);
    worst[name] = Math.max(worst[name] ?? 0, d);
    console.log(`${date} ${name.padEnd(8)} Horizons ${ra.toFixed(3)} ${dec.toFixed(3)} mag ${Number.isFinite(mag) ? mag.toFixed(1) : "  –"} | MIRA ${b.ra.toFixed(3)} ${b.dec.toFixed(3)} mag ${b.mag.toFixed(1)} | off by ${(d * 60).toFixed(1)}′`);
  }
}
console.log("worst offsets (arcmin):", Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +(v * 60).toFixed(1)])));
