# foodtracker

Macro tracking app with analytics, weight trends and nutrition logging.

A single-page React tracker for a 3-week cut: daily calorie/macro logging with
quick-add presets, weight logging with goal progress, and water intake tracking.
Data persists in the browser via `localStorage` (one entry per day, keyed
`log:YYYY-MM-DD`).

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL (defaults to http://localhost:5173).

## Build

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production build locally
```

## Structure

- `src/Tracker.jsx` — the whole app: profile constants, macro wheel, food log, water tracker
- `src/storage.js` — async key-value storage shim over `localStorage` (`window.storage`)
- `src/main.jsx` — entry point

Adjust the plan (goals, dates, quick-add foods) by editing `PROFILE` and
`QUICK_ADDS` at the top of `src/Tracker.jsx`.
