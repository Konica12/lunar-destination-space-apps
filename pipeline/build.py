"""Build the static data the web app reads.

  python3 build.py [--dem path/to/LDEM_80S_80M.LBL]

Writes ../web/public/data/sites.json (index) and one <id>.json per site.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import warnings

import numpy as np

warnings.filterwarnings("ignore")

import ephem
from sites import SITES, MISSIONS, MAIN_WINDOW

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "public", "data")
MASTS = (2.0, 10.0, 20.0)
N_AZ = 720


def b64_i16(a) -> str:
    return base64.b64encode(np.asarray(np.round(a), dtype="<i2").tobytes()).decode()


def encode_track(az_el):
    return {"az": b64_i16(az_el[:, 0] * 90.0), "el": b64_i16(az_el[:, 1] * 1000.0)}


def flat_horizon(mast):
    r0 = ephem.R_MOON * 1000 + mast
    dip = -np.degrees(np.arccos(ephem.R_MOON * 1000 / r0))
    return np.full(N_AZ, dip)


def write_ephem(name, t, rot):
    v = ephem.body_vectors(t, rot)
    arr = np.concatenate([v["sun"], v["earth"]], axis=1).astype("<f4")
    with open(os.path.join(OUT, f"ephem-{name}.json"), "w") as fh:
        json.dump({"start": t[0].isot[:16] + "Z", "step_h": 1.0, "n": len(t),
                   "layout": "float32 LE, per hour: sun xyz, earth xyz (km, MOON_ME, Moon-centred, light-time corrected)",
                   "source": "JPL DE421 ephemeris + moon_pa_de421_1900-2050.bpc / moon_080317.tf (NAIF)",
                   "b64": base64.b64encode(arr.tobytes()).decode()}, fh)


def illum_map(dem, lat0, lon0, ref_times, rot, n=25, step_m=400.0):
    """Share of 2027 with the Sun (centre) and Earth (centre) above the terrain, on an n x n grid around the site."""
    from horizon import visible_fraction
    p0, e, nn = dem.local_axes(lon0, lat0)
    offs = (np.arange(n) - n // 2) * step_m
    pts = []
    for dn in offs:          # rows south -> north
        for de in offs:      # cols west -> east
            x, y = p0 + de * e + dn * nn
            lo, la = dem.to_lonlat(np.array([x]), np.array([y]))
            pts.append((float(la[0]), float(lo[0])))
    tr = ephem.az_el(ref_times, [(la, lo, 0.0) for la, lo in pts], rot)
    sun, earth = [], []
    for k, (la, lo) in enumerate(pts):
        h0, hz, cov = dem.horizon(lo, la, mast_heights=(2.0,), n_az=180, max_km=80)
        if not np.isfinite(h0):
            sun.append(255); earth.append(255); continue
        sun.append(int(round(100 * visible_fraction(tr["sun"][k], hz[2.0]))))
        earth.append(int(round(100 * visible_fraction(tr["earth"][k], hz[2.0]))))
    s = np.array(sun)
    return {"n": n, "spacing_m": step_m, "year": 2027, "sun": sun, "earth": earth,
            "sun_range": [int(s[s < 255].min()), int(s[s < 255].max())],
            "method": "Sun centre / Earth centre above a 180-direction LOLA horizon (80 km), 6-hourly through 2027, 2 m observer"}


def choose_point(dem, site, ref_times, rot):
    """Most-sunlit point (2 km grid) within search_km of the IAU anchor."""
    _, lat0, lon0, _ = site["anchor"]
    p0, e, n = dem.local_axes(lon0, lat0)
    km = site["search_km"]
    step = 2.0 if km <= 25 else 3.0
    offs = np.arange(-km, km + 1e-9, step) * 1000
    cands = []
    for de in offs:
        for dn in offs:
            if de * de + dn * dn <= (km * 1000) ** 2:
                x, y = p0 + de * e + dn * n
                lo, la = dem.to_lonlat(np.array([x]), np.array([y]))
                cands.append((float(la[0]), float(lo[0])))
    sun = ephem.az_el(ref_times, [(la, lo, 0.0) for la, lo in cands], rot)["sun"]
    best, best_f = None, -1
    from horizon import visible_fraction
    for (la, lo), track in zip(cands, sun):
        h0, hz, cov = dem.horizon(lo, la, mast_heights=(2.0,), n_az=180, max_km=80)
        if not np.isfinite(h0):
            continue
        f = visible_fraction(track, hz[2.0])
        if f > best_f:
            best, best_f = (la, lo), f
    return best, best_f, len(cands)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem")
    ap.add_argument("--only")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    dem = None
    if args.dem:
        from horizon import DEM
        dem = DEM(args.dem)
        print("DEM", dem.z.shape, "res", dem.res, "m")

    main_t = ephem.utc_grid(MAIN_WINDOW[0], MAIN_WINDOW[1], 1.0)
    main_rot = ephem.rotations(main_t)
    ref_t = ephem.utc_grid("2027-01-01T00:00", "2028-01-01T00:00", 6.0)
    ref_rot = ephem.rotations(ref_t)

    write_ephem("main", main_t, main_rot)
    index = []
    for s in SITES + MISSIONS:
        if args.only and s["id"] != args.only:
            continue
        rec = {k: v for k, v in s.items() if k not in ("window", "events", "anchor", "search_km")}
        if "anchor" in s:
            name, la, lo, url = s["anchor"]
            rec["anchor"] = {"name": name, "lat": la, "lon": lo, "url": url}
            lat, lon = la, lo
            rec["point_method"] = "IAU feature position (provisional)"
            if dem is not None:
                (lat, lon), f, nc = choose_point(dem, s, ref_t, ref_rot)
                rec["point_method"] = (
                    f"Most-sunlit point in 2027 among {nc} candidates on a grid within "
                    f"{s['search_km']} km of the IAU feature (LOLA terrain, 2 m mast)")
                # refine: climb to the sunniest spot on a fine 400 m grid around the coarse choice
                for _ in range(3):
                    m = illum_map(dem, lat, lon, ref_t, ref_rot, n=11, step_m=400.0)
                    a = np.array(m["sun"]); a[a == 255] = -1
                    k = int(a.argmax())
                    if k == len(a) // 2 or a[k] <= a[len(a) // 2]:
                        break
                    p0, e, nn = dem.local_axes(lon, lat)
                    r, c = divmod(k, 11)
                    x, y = p0 + (c - 5) * 400.0 * e + (r - 5) * 400.0 * nn
                    lo2, la2 = dem.to_lonlat(np.array([x]), np.array([y]))
                    lat, lon, f = float(la2[0]), float(lo2[0]), a[k] / 100
                rec["point_method"] += ", refined on a 400 m grid"
                print(f"  {s['id']}: chose {lat:.4f},{lon:.4f} sun {f:.2f}")
        else:
            lat, lon = s["lat"], s["lon"]
            rec["point_method"] = "Published landing coordinates"
        rec["lat"], rec["lon"] = round(lat, 4), round(lon, 4)

        if "window" in s:
            t = ephem.utc_grid(s["window"][0], s["window"][1], 1.0)
            rot = ephem.rotations(t)
            rec["events"] = [{"t": a, "label": b} for a, b in s["events"]]
        else:
            t, rot = main_t, main_rot

        # horizons
        hz = {}
        h0 = 0.0
        terrain_src = "none (smooth sphere)"
        if dem is not None:
            h0v, hzd, cov = dem.horizon(lon, lat, mast_heights=MASTS, n_az=N_AZ, max_km=150)
            if np.isfinite(h0v) and cov > 0.2:
                h0 = float(h0v)
                hz = {str(int(m)): np.round(v, 3).tolist() for m, v in hzd.items()}
                terrain_src = "LOLA polar DEM"
                rec["horizon_coverage"] = round(float(cov), 3)
                rel, sp = dem.patch(lon, lat)
                rec["terrain"] = {"n": int(rel.shape[0]), "spacing_m": float(sp),
                                  "layout": "int16 LE metres relative to the site (curvature drop included), rows south->north, cols west->east",
                                  "b64": b64_i16(rel)}
        if dem is not None and "terrain" in rec:
            rec["illum"] = illum_map(dem, lat, lon, ref_t, ref_rot)
            print("   illum map", rec["illum"]["sun_range"])
        if not hz:
            hz = {str(int(m)): np.round(flat_horizon(m), 3).tolist() for m in MASTS}
        rec["elev_m"] = round(h0, 1)
        rec["horizon"] = {"n_az": N_AZ, "source": terrain_src, "by_mast_m": hz}

        rec["ephem"] = s["id"] if "window" in s else "main"
        if "window" in s:
            write_ephem(s["id"], t, rot)
        # reference track (Python) for validating the browser maths
        tr = ephem.az_el(t[:48], [(lat, lon, h0)], rot[:48])
        rec["check"] = {"sun": np.round(tr["sun"][0][::12], 4).tolist(),
                        "earth": np.round(tr["earth"][0][::12], 4).tolist()}

        with open(os.path.join(OUT, f"{s['id']}.json"), "w") as fh:
            json.dump(rec, fh, separators=(",", ":"))
        index.append({k: rec[k] for k in ("id", "name", "kind", "lat", "lon", "elev_m")}
                     | {"terrain": "terrain" in rec, "ephem": rec["ephem"], "horizon_source": terrain_src})
        print("wrote", s["id"], lat, lon, terrain_src)

    if not args.only:
        with open(os.path.join(OUT, "sites.json"), "w") as fh:
            json.dump({"generated": "khagolshastra pipeline", "ephemeris": "JPL DE421 + moon_pa_de421 (MOON_ME)",
                       "sites": index}, fh, indent=1)


if __name__ == "__main__":
    main()
