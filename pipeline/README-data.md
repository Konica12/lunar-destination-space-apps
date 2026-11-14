# Converting the LOLA DEM

`LDEM_80S_80M.IMG` is 7600 × 7600 little-endian int16, 0.5 m per unit, polar stereographic (spherical, R = 1737.4 km, true scale at the pole), 80 m/px, pole at pixel 3799.5 (see the PDS `.LBL`). Convert it to a GeoTIFF once:

```python
import numpy as np, rasterio
from rasterio.transform import from_origin
n = 7600
a = np.fromfile('LDEM_80S_80M.IMG', dtype='<i2').reshape(n, n)
crs = '+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs'
with rasterio.open('dem/ldem_80s_80m.tif', 'w', driver='GTiff', width=n, height=n, count=1, dtype='int16',
                   crs=crs, transform=from_origin(-304000, 304000, 80, 80), compress='deflate', tiled=True) as d:
    d.write(a, 1); d.scales = (0.5,)
```

Orientation was verified with known features: Shackleton, Haworth and Faustini floors come out low, Mons Malapert and Mons Mouton high.
