# LunarDestination

**Where and when to land at the Moon's south pole.**
NASA Space Apps Challenge 2026 · *Lunar Landing Site Navigator* · Team **Khagolshastra**

LunarDestination lets mission planners, educators and the public compare south pole landing sites and dates in seconds. It shows where the Sun and Earth sit relative to the **real terrain horizon** of each site, so you can judge solar power and direct-to-Earth radio contact at a glance.

## What you can do

- **Stand on the Moon.** A first-person 3D view from 2 m above the site, on real LOLA terrain, with the Sun and Earth at their true size and position. Earth's phase comes from the same sunlight.
- **See the whole Moon.** A rotating globe lit by the real Sun at the chosen time, with every candidate site as a pin.
- **Find good dates fast.** A day-by-day ribbon from Nov 2026 to Dec 2028, plus "nearest better" and "best of all" suggestions.
- **Know the time left.** Countdowns to the next sunset and Earthset, with markers on the time bar.
- **Read solar elevation prominently**, against the terrain height in the Sun's direction, and the sunlight reaching a vertical or a flat panel.
- **Compare scenarios.** Every site × every month grid, pinned site-and-date scenarios ranked side by side, and exact sunlight and contact windows with CSV export.
- **Understand why small changes matter.** 2027 sunlight maps around each site (moving 1 km can change sunlight from 12% to 83%), date shifts, and mast height.
- **See how alien it is.** The Sun's path over Bengaluru and over the lunar site on the same day.
- **Replay Chandrayaan-3** at the Shiv Shakti point, with ISRO's mission events on the timeline.
- **Print the horizon** as a cut-and-roll paper ring for classrooms. Explain mode adds plain-language notes for educators.

## How the numbers are made

1. **Sun and Earth positions:** JPL DE421 ephemeris and NAIF's lunar orientation model (MOON_ME frame), hourly, light-time corrected. The browser turns Moon-centred vectors into azimuth and elevation for any point, with exact parallax.
2. **Terrain horizon:** for each site, the highest terrain angle in 720 directions out to 150 km from LOLA `LDEM_80S_80M` (80 m/px), on a spherical Moon (R = 1737.4 km).
3. **No atmosphere:** no refraction is applied. The horizon is the terrain, or the edge of the lunar sphere where nothing blocks the view (for example −4.09° from Malapert's 4.4 km summit, matched exactly by the computed horizon).
4. **Visibility:** the Sun counts while any part of its 0.53° disk clears the horizon; Earth counts when its centre does.
5. **Site points:** NASA has not published exact coordinates for its candidate regions. Each region is anchored on its IAU feature, and the point is the sunniest spot in 2027 found on a 2 km grid and refined on a 400 m grid.

### Validation

Against JPL Horizons (DE441) for 1 Jan 2001, the sub-Earth and sub-solar points on the Moon agree to within **0.006°** (about 1/50 of the Sun's width). The Horizons output is in `validation/`.

## Run it locally

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in web/dist
```

## Rebuild the data (optional)

The processed data is already in `web/public/data`. To regenerate it, download `LDEM_80S_80M.IMG` from the [PDS Geosciences Node](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/), convert it with the snippet in `pipeline/README-data.md`, then:

```bash
pip install -r pipeline/requirements.txt
cd pipeline && python3 build.py --dem ../dem/ldem_80s_80m.tif
```

## Deploy

Pushing to `main` builds and publishes the site with GitHub Pages (`.github/workflows/deploy.yml`). In the repository settings, set **Pages → Source** to **GitHub Actions**.

## Known limits

- Terrain covers 80–90°S. Chandrayaan-3 (69°S) and typed-in points use a smooth-sphere horizon.
- Ephemeris covers Nov 2026 – Dec 2028 (and Aug–Oct 2023 for the replay).
- Earth visibility is geometric line of sight, not a full link budget. Panel figures are sunlight on the panel, not electrical output.
- The ground texture in the first-person view is generated regolith detail; the terrain shape and shadows are real LOLA data.

Credits for all data and imagery: [ATTRIBUTION.md](ATTRIBUTION.md).
