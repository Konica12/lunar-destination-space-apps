# Data and image credits

| What | Source |
|---|---|
| Sun, Earth and Moon positions | JPL DE421 planetary ephemeris (NASA/JPL), via the `de421` Python package |
| Moon orientation (MOON_PA / MOON_ME frames) | NAIF kernels `moon_pa_de421_1900-2050.bpc`, `moon_080317.tf`, `moon_assoc_me.tf` (NASA/JPL NAIF), shipped in `kernels/` |
| Terrain, horizons, sunlight maps | LRO LOLA `LDEM_80S_80M` (LRO LOLA Science Team, NASA GSFC; NASA PDS Geosciences Node) |
| Globe colour map `web/public/textures/moon_color_4k.jpg` | NASA Scientific Visualization Studio, CGI Moon Kit (LRO LROC WAC mosaic) — https://svs.gsfc.nasa.gov/4720/ |
| Globe relief `web/public/textures/moon_normal_2k.jpg` | NASA SVS CGI Moon Kit, from LRO LOLA data — https://svs.gsfc.nasa.gov/4720/ |
| Candidate region anchors | IAU / USGS Gazetteer of Planetary Nomenclature — https://planetarynames.wr.usgs.gov/ |
| Chandrayaan-3 landing point and mission dates | ISRO public mission updates |
| Validation reference | JPL Horizons (DE441), sub-Earth and sub-solar points, saved in `validation/` |

NASA imagery and data are not copyrighted in the United States; credit is given as requested by NASA's media guidelines. The resized globe textures were obtained from a public NASA Space Apps 2026 repository that credits the same NASA SVS source.
