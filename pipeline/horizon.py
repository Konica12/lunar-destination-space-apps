"""Terrain horizons and terrain patches from LOLA polar DEMs.

Horizon method: from the observer (DEM surface + mast height), march outward
along 720 azimuths (0.5 deg) to `max_km`, sampling the DEM, and record the
largest elevation angle on a spherical Moon (R = 1737.4 km). With no
atmosphere there is no refraction: the horizon is purely the terrain, or the
edge of the lunar sphere where no terrain rises above it.
"""
from __future__ import annotations

import numpy as np
import rasterio
from rasterio.warp import transform as warp_transform
from scipy.ndimage import map_coordinates

R_M = 1737400.0
GEO = "+proj=longlat +R=1737400 +no_defs"


class DEM:
    def __init__(self, path: str):
        self.ds = rasterio.open(path)
        band = self.ds.read(1, masked=True).astype("float64")
        scale = self.ds.scales[0] or 1.0
        offset = self.ds.offsets[0] or 0.0
        z = band.filled(np.nan) * scale + offset
        # LOLA LDEM heights are in km (float) or 0.5 m units (int16); normalise to metres.
        if np.nanmax(np.abs(z)) < 50:
            z = z * 1000.0
        self.z = z
        self.crs = self.ds.crs
        self.inv = ~self.ds.transform
        self.res = abs(self.ds.transform.a)

    # --- coordinate helpers -------------------------------------------------
    def to_xy(self, lon, lat):
        x, y = warp_transform(GEO, self.crs, np.atleast_1d(lon), np.atleast_1d(lat))
        return np.asarray(x), np.asarray(y)

    def to_lonlat(self, x, y):
        lon, lat = warp_transform(self.crs, GEO, np.ravel(x), np.ravel(y))
        return np.asarray(lon).reshape(np.shape(x)), np.asarray(lat).reshape(np.shape(x))

    def sample_xy(self, x, y):
        col, row = self.inv * (np.asarray(x), np.asarray(y))
        return map_coordinates(self.z, [row - 0.5, col - 0.5], order=1, mode="constant", cval=np.nan)

    def height(self, lon, lat):
        x, y = self.to_xy(lon, lat)
        return float(self.sample_xy(x, y)[0])

    def local_axes(self, lon, lat):
        """Unit vectors (in projected metres) of local east and north."""
        d = 1e-4
        x0, y0 = self.to_xy(lon, lat)
        xn, yn = self.to_xy(lon, lat + d)
        xe, ye = self.to_xy(lon + d / max(np.cos(np.radians(lat)), 1e-3), lat)
        n = np.array([xn[0] - x0[0], yn[0] - y0[0]])
        e = np.array([xe[0] - x0[0], ye[0] - y0[0]])
        return np.array([x0[0], y0[0]]), e / np.linalg.norm(e), n / np.linalg.norm(n)

    # --- horizon ------------------------------------------------------------
    def horizon(self, lon, lat, mast_heights=(2.0,), n_az=720, max_km=150.0):
        p0, e, n = self.local_axes(lon, lat)
        h0 = self.sample_xy(*p0[:, None])[0]
        # sample distances: dense near, sparse far
        d = np.concatenate([np.arange(self.res, 5000, self.res),
                            np.arange(5000, max_km * 1000, self.res * 2)])
        az = np.radians(np.arange(n_az) * 360.0 / n_az)
        dirs = np.sin(az)[:, None] * e + np.cos(az)[:, None] * n  # (n_az, 2)
        X = p0[0] + dirs[:, 0:1] * d[None, :]
        Y = p0[1] + dirs[:, 1:2] * d[None, :]
        H = self.sample_xy(X, Y)  # (n_az, nd)
        # true central angle via lon/lat of each sample
        lon_s, lat_s = self.to_lonlat(X, Y)
        v0 = _unit(lon, lat)
        vs = _unit(lon_s, lat_s)
        theta = np.arccos(np.clip(np.tensordot(vs, v0, axes=([-1], [0])), -1, 1))
        out = {}
        for m in mast_heights:
            r0 = R_M + h0 + m
            r = R_M + H
            ang = np.degrees(np.arctan2(r * np.cos(theta) - r0, r * np.sin(theta)))
            ang = np.where(np.isfinite(ang), ang, -90.0)
            # edge of the lunar sphere (no terrain): geometric dip of the horizon
            dip = -np.degrees(np.arccos(R_M / r0)) if r0 > R_M else 0.0
            hz = np.maximum(ang.max(axis=1), dip)
            out[m] = hz
        coverage = np.isfinite(H).mean()
        return h0, out, coverage

    def patch(self, lon, lat, half_km=15.0, n=257):
        """Square terrain patch centred on the site, local east/north axes, heights relative to site (m)."""
        p0, e, nn = self.local_axes(lon, lat)
        s = np.linspace(-half_km * 1000, half_km * 1000, n)
        E, N = np.meshgrid(s, s)  # rows = north (south->north), cols = east
        X = p0[0] + E * e[0] + N * nn[0]
        Y = p0[1] + E * e[1] + N * nn[1]
        H = self.sample_xy(X, Y)
        h0 = self.sample_xy(*p0[:, None])[0]
        rel = H - h0
        # include curvature drop so distant ground falls away as it really does
        rel -= (E ** 2 + N ** 2) / (2 * R_M)
        return np.nan_to_num(rel, nan=float(np.nanmin(rel))), (s[1] - s[0])

    def sun_fraction_grid(self, lon, lat, km, step_km, sun_az_el):
        """Score candidate points around an anchor by fraction of time the Sun centre clears the horizon."""
        p0, e, n = self.local_axes(lon, lat)
        best = None
        offs = np.arange(-km, km + 1e-9, step_km) * 1000
        for de in offs:
            for dn in offs:
                if de * de + dn * dn > (km * 1000) ** 2:
                    continue
                x, y = p0 + de * e + dn * n
                lo, la = self.to_lonlat(np.array([x]), np.array([y]))
                yield float(lo[0]), float(la[0])


def _unit(lon, lat):
    lon = np.radians(lon)
    lat = np.radians(lat)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


def visible_fraction(az_el: np.ndarray, hz: np.ndarray) -> float:
    n = len(hz)
    idx = np.round(az_el[:, 0] / (360.0 / n)).astype(int) % n
    return float(np.mean(az_el[:, 1] > hz[idx]))
