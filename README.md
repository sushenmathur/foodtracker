# foodtracker

**Sushen Macro Tracking** — a single-page meal-logging app in the style of
MyFitnessPal / GymStreak: log food to Breakfast / Lunch / Dinner / Snack,
track calories and macros against editable daily targets, and add foods three
ways — AI text search, AI photo recognition, or by hand. Data persists in the
browser via `localStorage`.

## Features

- **Meal logging** into Breakfast, Lunch, Dinner and Snack, each with its own
  calorie subtotal.
- **AI food search** — describe a food ("large flat white and a ham & cheese
  toastie") and Claude estimates calories, protein, carbs and fat.
- **AI photo recognition** — snap or upload a photo of a meal and get instant
  macro estimates (Claude vision).
- **Manual entry** — type in name and macros directly; every estimate is
  editable before you commit it.
- **Recently logged** — recent foods appear as chips for one-tap re-adding.
- **Editable targets** — set your maintenance calories, protein, carbs, fat and
  water goal in Settings.
- **Weight** — manual weight logging with change-since-last-entry.
- **Water** — tap-to-fill glasses toward your daily goal.

## AI setup (bring your own key)

The AI features call Claude directly from your browser using **your own
Anthropic API key**. Because this is a static site with no backend and the repo
is public, there's no server to hold a shared key — so:

1. Open **Settings** (gear icon, top right).
2. Paste your Anthropic API key (get one at `console.anthropic.com`).
3. It's stored only in this browser's `localStorage`. Your key and food data
   never go anywhere except Anthropic's API when you run an estimate.

Model defaults to `claude-opus-4-8` (with vision + structured outputs); you can
change it under Settings → Advanced. You pay Anthropic per request (roughly a
fraction of a cent per text lookup, a little more per photo). Manual entry works
with no key.

## Apple Health / weight & exercise sync

Weight is entered **manually** today, and **exercise calories burned** are
entered manually in the Exercise card — burned calories are added to that day's
calorie budget (the standard "eat back exercise calories" model), and the
traffic-light on calories remaining reflects the adjusted budget.

Live Apple Health (HealthKit) sync is not possible from a web app — HealthKit is
only accessible to **native iOS apps**, and a page served over the web has no API
to read or write it.

To add real Health sync later, this app would need to be wrapped as a native iOS
app — e.g. with **Capacitor** (`@capacitor-community/health` /
`@perfood/capacitor-healthkit`) or **React Native** (`react-native-health`) —
which exposes HealthKit through a native plugin. The web build here could be
reused as the UI inside that shell. Two integration points are already in place:

- **Weight** → written to `day.weight` (currently from the manual input; would be
  read from HealthKit body-mass samples).
- **Active energy / calories burned** → written to `day.burned` (currently from
  the manual Exercise input; would be read from HealthKit active-energy samples)
  and automatically offset against the daily calorie target.

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL (defaults to http://localhost:5173).

## Build & deploy

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production build locally
```

Pushes to this branch auto-deploy to GitHub Pages via
`.github/workflows/deploy-pages.yml`.

## Structure

- `src/Tracker.jsx` — the whole app: summary wheel, meal sections, add-food
  modal (AI/photo/manual), recents, weight, water, settings.
- `src/ai.js` — Claude calls: text + vision macro estimation (structured
  outputs), image downscaling, and error handling.
- `src/storage.js` — async key-value store over `localStorage` (`window.storage`).
- `src/main.jsx` — entry point.

Daily logs are stored as `log:YYYY-MM-DD`; targets, recents and the API key have
their own keys.
