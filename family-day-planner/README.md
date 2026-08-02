# Family Day Builder

A phone-first family itinerary generator inspired by the general idea of turning a few free hours into a practical local plan. It uses original branding and code.

## What it does

- Accepts kids' ages, city or GPS location, date, starting time, available hours, budget, energy level, and interests
- Uses Open-Meteo for geocoding and a live 16-day weather forecast
- Uses OpenStreetMap data through Overpass for nearby parks, playgrounds, pools, libraries, museums, zoos, attractions, cinemas, and snack stops
- Scores places for distance, weather, budget, interests, pace, and mixed ages
- Builds a timed itinerary with travel buffers and links for maps, venue websites, hours, or tickets
- Provides a separate search link for date-specific live family events
- Saves plans locally, supports copy/share, works offline after the first visit, and can be installed as a PWA
- Requires no account, server, API key, or paid service

## Run locally

From the repository root:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000/family-day-planner/
```

## GitHub Pages

Once merged into `main`, the existing repository Pages deployment should publish this folder at:

```text
https://duhfreakinduh.github.io/headsup-ai/family-day-planner/
```

## Important limitations

OpenStreetMap place records are community maintained. Hours, prices, admission rules, accessibility, and closures can be missing or outdated. The UI tells users to confirm details before leaving.

The free MVP does not scrape commercial event or ticket platforms. The “live family events” button opens a date-and-location web search. A later version could add a licensed event provider through a small server-side proxy so an API key is not exposed in the browser.

## Suggested next upgrades

1. Route optimization between every stop instead of distance from the starting point
2. Venue opening-hours validation for the selected date and time
3. Optional Ticketmaster, PredictHQ, or local-city calendar integration
4. Parent accounts and cloud plan syncing
5. Admin-curated Fort Worth favorites and safety notes
6. Revenue options such as affiliate ticket links or a paid unlimited-plan tier
