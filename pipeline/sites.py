"""Candidate sites.

NASA has not published exact coordinates for its Artemis III candidate
regions (each roughly 15 x 15 km). We anchor each region on its named IAU
feature (USGS Gazetteer of Planetary Nomenclature) and, once LOLA terrain is
available, move the observation point to the most-sunlit spot within
`search_km` of that anchor (see horizon.py: choose_points).
"""

GAZ = "https://planetarynames.wr.usgs.gov/Feature/"

SITES = [
    dict(id="malapert-massif", name="Malapert Massif", kind="artemis",
         anchor=("Mons Malapert", -85.98, -1.67, GAZ + "16338"), search_km=15),
    dict(id="haworth", name="Haworth", kind="artemis",
         anchor=("Haworth crater", -87.45, -5.17, GAZ + "14502"), search_km=35),
    dict(id="mons-mouton", name="Mons Mouton", kind="artemis",
         anchor=("Mons Mouton", -84.6, 31.0, GAZ + "16070"), search_km=20),
    dict(id="nobile-rim", name="Nobile Rim", kind="artemis",
         anchor=("Nobile crater", -85.28, 53.27, GAZ + "4321"), search_km=45),
    dict(id="de-gerlache-rim", name="de Gerlache Rim", kind="artemis",
         anchor=("de Gerlache crater", -88.48, -88.34, GAZ + "1439"), search_km=25),
    dict(id="slater-plain", name="Slater Plain", kind="artemis",
         anchor=("Slater crater", -88.08, 111.29, None), search_km=25),
    dict(id="cabeus-b-peak", name="Peak near Cabeus B", kind="artemis",
         anchor=("Cabeus B crater", -82.26, -54.58, GAZ + "8058"), search_km=35),
    dict(id="shackleton-ridge", name="Shackleton connecting ridge", kind="classic",
         anchor=("Shackleton crater rim / connecting ridge", -89.45, -137.3, None), search_km=6),
]

MISSIONS = [
    dict(id="chandrayaan-3", name="Chandrayaan-3 (Shiv Shakti point)", kind="mission",
         lat=-69.373, lon=32.319,
         window=("2023-08-15T00:00", "2023-10-15T00:00"),
         events=[
             ("2023-08-23T12:33", "Vikram lands"),
             ("2023-09-02T00:00", "Pragyan rover put to sleep"),
             ("2023-09-04T02:30", "Vikram put to sleep"),
             ("2023-09-22T00:00", "Wake-up attempts begin, no response"),
         ],
         source="ISRO mission updates"),
]

MAIN_WINDOW = ("2026-11-01T00:00", "2029-01-01T00:00")
