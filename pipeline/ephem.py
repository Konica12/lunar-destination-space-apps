"""Sun and Earth positions as seen from points on the lunar surface.

Inputs (no network needed):
  * JPL DE421 planetary ephemeris (PyPI package `de421`, read with jplephem 1.x)
  * Moon orientation: binary PCK moon_pa_de421_1900-2050.bpc + frame kernel
    moon_080317.tf (NAIF), giving the MOON_ME (mean Earth / polar axis) frame
    that LOLA topography uses.

Output per time step: azimuth (deg, clockwise from local north) and elevation
(deg) of the Sun and Earth centres, light-time corrected, NO atmospheric
refraction (the Moon has none).
"""
from __future__ import annotations

import os
import numpy as np
import spiceypy as sp
import de421
from jplephem import Ephemeris
from astropy.time import Time
from astropy.utils import iers

iers.conf.auto_download = False  # use the leap-second table bundled with astropy

HERE = os.path.dirname(os.path.abspath(__file__))
KDIR = os.path.join(HERE, "..", "kernels")
R_MOON = 1737.4  # km, LOLA reference sphere
C_KMS = 299792.458

_eph = Ephemeris(de421)
_EMRAT = 81.3005690699153
_loaded = False


def load_kernels() -> None:
    global _loaded
    if _loaded:
        return
    for k in ("moon_pa_de421_1900-2050.bpc", "moon_080317.tf", "moon_assoc_me.tf"):
        sp.furnsh(os.path.join(KDIR, k))
    _loaded = True


def utc_grid(start: str, end: str, step_hours: float) -> Time:
    t0, t1 = Time(start, scale="utc"), Time(end, scale="utc")
    n = int(np.floor((t1 - t0).to_value("hour") / step_hours)) + 1
    return t0 + np.arange(n) * step_hours / 24.0


def _bary(name: str, jd_tdb: np.ndarray) -> np.ndarray:
    """Barycentric ICRF position (km), shape (3, N)."""
    if name == "sun":
        return _eph.position("sun", jd_tdb)
    emb = _eph.position("earthmoon", jd_tdb)
    moon_geo = _eph.position("moon", jd_tdb)
    earth = emb - moon_geo / (1.0 + _EMRAT)
    if name == "earth":
        return earth
    if name == "moon":
        return earth + moon_geo
    raise ValueError(name)


def site_vector(lat_deg: float, lon_deg: float, height_m: float = 0.0) -> np.ndarray:
    """Site position in MOON_ME (km). lon is east-positive."""
    r = R_MOON + height_m / 1000.0
    return np.array(sp.latrec(r, np.radians(lon_deg), np.radians(lat_deg)))


def enu_basis(site: np.ndarray):
    up = site / np.linalg.norm(site)
    z = np.array([0.0, 0.0, 1.0])
    east = np.cross(z, up)
    east /= np.linalg.norm(east)
    north = np.cross(up, east)
    return east, north, up


def rotations(times: Time) -> np.ndarray:
    """J2000 -> MOON_ME rotation matrices, shape (N, 3, 3)."""
    load_kernels()
    et = (times.tdb.jd - 2451545.0) * 86400.0
    return np.array([sp.pxform("J2000", "MOON_ME", float(e)) for e in et])


def az_el(times: Time, sites: list[tuple[float, float, float]], rot: np.ndarray | None = None):
    """Return dict body -> array (n_sites, N, 2) of [az, el] in degrees.

    Light time is iterated for each body. Stellar aberration (<0.006 deg) is
    ignored; refraction is zero on the Moon.
    """
    if rot is None:
        rot = rotations(times)
    jd = times.tdb.jd
    moon = _bary("moon", jd)  # (3, N)
    out = {}
    site_me = [site_vector(*s) for s in sites]
    bases = [enu_basis(s) for s in site_me]
    rotT = np.transpose(rot, (0, 2, 1))  # MOON_ME -> J2000
    for body in ("sun", "earth"):
        res = np.zeros((len(sites), len(jd), 2))
        for i, (s_me, (e, n, u)) in enumerate(zip(site_me, bases)):
            s_j2k = np.einsum("nij,j->in", rotT, s_me)  # (3, N)
            obs = moon + s_j2k
            tgt = _bary(body, jd)
            for _ in range(2):  # light-time iteration
                lt = np.linalg.norm(tgt - obs, axis=0) / C_KMS
                tgt = _bary(body, jd - lt / 86400.0)
            vec_j2k = (tgt - obs).T  # (N, 3)
            vec_me = np.einsum("nij,nj->ni", rot, vec_j2k)
            vec_me /= np.linalg.norm(vec_me, axis=1, keepdims=True)
            ve, vn, vu = vec_me @ e, vec_me @ n, vec_me @ u
            res[i, :, 0] = np.degrees(np.arctan2(ve, vn)) % 360.0
            res[i, :, 1] = np.degrees(np.arcsin(np.clip(vu, -1, 1)))
        out[body] = res
    return out


def body_vectors(times: Time, rot: np.ndarray | None = None):
    """Moon-centre -> Sun and Moon-centre -> Earth vectors in MOON_ME (km), light-time corrected.

    The browser turns these into azimuth/elevation for any surface point:
    topocentric vector = body vector - site vector (exact parallax).
    """
    if rot is None:
        rot = rotations(times)
    jd = times.tdb.jd
    moon = _bary("moon", jd)
    out = {}
    for body in ("sun", "earth"):
        tgt = _bary(body, jd)
        for _ in range(2):
            lt = np.linalg.norm(tgt - moon, axis=0) / C_KMS
            tgt = _bary(body, jd - lt / 86400.0)
        out[body] = np.einsum("nij,nj->ni", rot, (tgt - moon).T)
    return out


if __name__ == "__main__":
    t = utc_grid("2027-03-08T00:00", "2027-03-08T06:00", 1)
    r = az_el(t, [(-89.45, -137.3, 0.0), (-69.373, 32.319, 0.0)])
    for k, v in r.items():
        print(k)
        print(np.round(v, 3))
