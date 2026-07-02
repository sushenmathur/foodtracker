import { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus,
  Trash2,
  Droplet,
  Flame,
  Sparkles,
  Camera,
  PencilLine,
  Settings as SettingsIcon,
  X,
  Scale,
  Star,
  Dumbbell,
} from "lucide-react";
import {
  estimateFromText,
  estimateFromImage,
  fileToImage,
  friendlyError,
  DEFAULT_MODEL,
} from "./ai.js";

// ---- Meals & defaults ----
const MEALS = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "snack", label: "Snack" },
];

const DEFAULT_TARGETS = { cal: 2135, p: 173, c: 224, f: 61, waterL: 3.6 };

// Selectable Claude models (all support vision + structured outputs).
const MODEL_OPTIONS = [
  { id: "claude-opus-4-8", label: "Opus" },
  { id: "claude-sonnet-5", label: "Sonnet" },
  { id: "claude-haiku-4-5", label: "Haiku" },
];

// Seeds the "Recently logged" list on first run (Sushen's staples).
const SEED_RECENTS = [
  { name: "Berry protein smoothie mix (150g)", cal: 105, p: 12, c: 15, f: 1 },
  { name: "Coles Perform Protein Yoghurt (150g)", cal: 111, p: 22.5, c: 7.5, f: 1.2 },
  { name: "Muscle Nation protein water (30g)", cal: 95, p: 23.6, c: 2.1, f: 0 },
  { name: "Baker's Life protein bread (2 slices)", cal: 248, p: 23.6, c: 5, f: 12.8 },
  { name: "Low-fat cottage cheese (90g)", cal: 72, p: 10.8, c: 2.7, f: 1.8 },
];

const GLASS_ML = 450; // one tap = one glass
const RECENTS_CAP = 24;
const RECENTS_SHOWN = 10;

const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const emptyDay = () => ({ weight: null, water_ml: 0, items: [], burned: 0 });

// Show whole numbers without a trailing ".0"
const fmt = (n) => {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ---- Storage helpers (async window.storage, see storage.js) ----
async function getJSON(key, fallback) {
  try {
    const res = await window.storage.get(key);
    return res ? JSON.parse(res.value) : fallback;
  } catch {
    return fallback;
  }
}
async function setJSON(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value));
  } catch (e) {
    console.error("save failed", key, e);
  }
}

export default function Tracker() {
  const [today] = useState(() => todayKey());
  const [loading, setLoading] = useState(true);

  const [day, setDay] = useState(emptyDay());
  const [targets, setTargets] = useState(DEFAULT_TARGETS);
  const [recents, setRecents] = useState(SEED_RECENTS);
  const [favourites, setFavourites] = useState([]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [weightHistory, setWeightHistory] = useState({}); // date -> weight

  const [weightInput, setWeightInput] = useState("");
  const [burnInput, setBurnInput] = useState("");
  const [addState, setAddState] = useState(null); // { meal, staged } | null
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ---- Load everything ----
  useEffect(() => {
    (async () => {
      const loaded = await getJSON(`log:${today}`, emptyDay());
      setDay({ ...emptyDay(), ...loaded });
      setTargets(await getJSON("targets", DEFAULT_TARGETS));
      setRecents(await getJSON("recents", SEED_RECENTS));
      setFavourites(await getJSON("favourites", []));
      setApiKey(await getJSON("apiKey", ""));
      setModel(await getJSON("model", DEFAULT_MODEL));

      try {
        const listRes = await window.storage.list("log:");
        const entries = {};
        for (const k of listRes?.keys || []) {
          const parsed = await getJSON(k, null);
          if (parsed && parsed.weight != null) entries[k.replace("log:", "")] = parsed.weight;
        }
        setWeightHistory(entries);
      } catch {}
      setLoading(false);
    })();
  }, [today]);

  const persistDay = (next) => {
    setDay(next);
    setJSON(`log:${today}`, next);
  };

  const pushRecent = (item) => {
    const clean = { name: item.name, cal: item.cal, p: item.p, c: item.c, f: item.f };
    setRecents((prev) => {
      const deduped = prev.filter((r) => !sameName(r.name, clean.name));
      const next = [clean, ...deduped].slice(0, RECENTS_CAP);
      setJSON("recents", next);
      return next;
    });
  };

  const addFavourite = (item) => {
    const clean = { name: item.name, cal: item.cal, p: item.p, c: item.c, f: item.f };
    setFavourites((prev) => {
      if (prev.some((f) => sameName(f.name, clean.name))) return prev;
      const next = [...prev, clean];
      setJSON("favourites", next);
      return next;
    });
  };
  const removeFavourite = (name) => {
    setFavourites((prev) => {
      const next = prev.filter((f) => !sameName(f.name, name));
      setJSON("favourites", next);
      return next;
    });
  };

  const addItems = (meal, items) => {
    const stamped = items.map((it, i) => ({
      id: Date.now().toString(36) + i.toString(36) + Math.random().toString(36).slice(2, 5),
      name: it.name,
      cal: Number(it.cal) || 0,
      p: Number(it.p) || 0,
      c: Number(it.c) || 0,
      f: Number(it.f) || 0,
      meal,
      ts: Date.now(),
    }));
    persistDay({ ...day, items: [...day.items, ...stamped] });
    items.forEach(pushRecent);
  };

  const removeItem = (id) => persistDay({ ...day, items: day.items.filter((i) => i.id !== id) });

  const addWater = () =>
    persistDay({ ...day, water_ml: Math.min(day.water_ml + GLASS_ML, GLASS_ML * 16) });
  const removeWater = () =>
    persistDay({ ...day, water_ml: Math.max(day.water_ml - GLASS_ML, 0) });

  const saveWeight = () => {
    const w = parseFloat(weightInput);
    if (!w) return;
    persistDay({ ...day, weight: w });
    setWeightHistory((h) => ({ ...h, [today]: w }));
    setWeightInput("");
  };

  const addBurned = () => {
    const v = parseFloat(burnInput);
    if (!v) return;
    persistDay({ ...day, burned: (day.burned || 0) + Math.round(v) });
    setBurnInput("");
  };
  const resetBurned = () => persistDay({ ...day, burned: 0 });

  const saveSettings = (next) => {
    setTargets(next.targets);
    setApiKey(next.apiKey);
    setModel(next.model);
    setJSON("targets", next.targets);
    setJSON("apiKey", next.apiKey);
    setJSON("model", next.model);
    setSettingsOpen(false);
  };

  const totals = useMemo(
    () =>
      day.items.reduce(
        (a, it) => ({ cal: a.cal + it.cal, p: a.p + it.p, c: a.c + it.c, f: a.f + it.f }),
        { cal: 0, p: 0, c: 0, f: 0 }
      ),
    [day.items]
  );

  // Exercise calories add to the day's budget (Apple Health would feed this later).
  const burned = day.burned || 0;
  const calorieBudget = targets.cal + burned;
  const calRemaining = calorieBudget - totals.cal;

  // Traffic light on calories consumed vs budget:
  //   <50% consumed → green, 50–80% → amber, >80% (incl. over budget) → red.
  const consumedPct = calorieBudget > 0 ? totals.cal / calorieBudget : 0;
  const calColor =
    consumedPct < 0.5 ? COLORS.green : consumedPct <= 0.8 ? COLORS.gold : COLORS.danger;

  // Weight: latest logged value and change vs the previous entry.
  const weightRows = useMemo(
    () =>
      Object.entries(weightHistory)
        .map(([date, w]) => ({ date, w }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [weightHistory]
  );
  const latestWeight = day.weight ?? (weightRows.length ? weightRows[weightRows.length - 1].w : null);
  const prevWeight = weightRows.length > 1 ? weightRows[weightRows.length - 2].w : null;
  const weightDelta = latestWeight != null && prevWeight != null ? +(latestWeight - prevWeight).toFixed(1) : null;

  const glassesFilled = Math.round(day.water_ml / GLASS_ML);
  const totalGlasses = Math.max(1, Math.round((targets.waterL * 1000) / GLASS_ML));

  const openAdd = (meal = "snack", staged = []) => setAddState({ meal, staged });

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={{ color: COLORS.textMuted, padding: 40 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .num { font-family: 'Space Grotesk', sans-serif; }
        .tap { transition: transform 0.12s ease, opacity 0.12s ease; }
        .tap:active { transform: scale(0.94); }
        button { font-family: 'Inter', sans-serif; cursor: pointer; }
        input, textarea, select { font-family: 'Inter', sans-serif; }
      `}</style>

      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>DAILY MACROS</div>
            <div style={styles.h1}>Sushen's Macro Tracking</div>
          </div>
          <button className="tap" onClick={() => setSettingsOpen(true)} style={styles.iconCircle} aria-label="Settings">
            <SettingsIcon size={18} color={COLORS.text} />
          </button>
        </div>

        {/* Daily summary */}
        <div style={styles.card}>
          <div style={styles.cardLabel}>TODAY</div>
          <div style={styles.wheelRow}>
            <MacroWheel totals={totals} targets={targets} calorieTarget={calorieBudget} calColor={calColor} />
            <div style={styles.macroList}>
              <MacroRow color={COLORS.gold} label="Protein" val={totals.p} goal={targets.p} />
              <MacroRow color={COLORS.sage} label="Carbs" val={totals.c} goal={targets.c} />
              <MacroRow color={COLORS.clay} label="Fat" val={totals.f} goal={targets.f} />
              <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: calColor }}>
                {calRemaining >= 0 ? (
                  <span>
                    <Flame size={12} style={{ verticalAlign: -2 }} /> {fmt(calRemaining)} cal left
                  </span>
                ) : (
                  <span>{fmt(-calRemaining)} cal over</span>
                )}
              </div>
              {burned > 0 && (
                <div style={{ marginTop: 3, fontSize: 11, color: COLORS.textMuted }}>
                  {fmt(targets.cal)} target + {fmt(burned)} exercise
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Meals */}
        {MEALS.map((meal) => {
          const items = day.items.filter((i) => i.meal === meal.key);
          const sub = items.reduce((a, it) => a + it.cal, 0);
          return (
            <div key={meal.key} style={styles.card}>
              <div style={styles.rowBetween}>
                <div style={styles.mealTitle}>
                  {meal.label}
                  <span className="num" style={styles.mealCal}>
                    {sub > 0 ? `${fmt(sub)} cal` : ""}
                  </span>
                </div>
                <button className="tap" onClick={() => openAdd(meal.key)} style={styles.addBtn}>
                  <Plus size={14} /> Add
                </button>
              </div>
              {items.length === 0 ? (
                <div style={styles.emptyState}>Nothing logged.</div>
              ) : (
                items.map((it) => (
                  <div key={it.id} style={styles.itemRow}>
                    <div style={{ minWidth: 0 }}>
                      <div style={styles.itemName}>{it.name}</div>
                      <div style={styles.muted}>
                        {fmt(it.cal)} cal · P{fmt(it.p)} C{fmt(it.c)} F{fmt(it.f)}
                      </div>
                    </div>
                    <button className="tap" onClick={() => removeItem(it.id)} style={styles.iconBtn} aria-label="Remove">
                      <Trash2 size={15} color={COLORS.textMuted} />
                    </button>
                  </div>
                ))
              )}
            </div>
          );
        })}

        {/* Recently logged (10 most recent) */}
        <div style={styles.card}>
          <div style={styles.cardLabel}>RECENTLY LOGGED</div>
          {recents.length === 0 ? (
            <div style={styles.emptyState}>Foods you log will show here for quick re-adding.</div>
          ) : (
            <div style={styles.quickRow}>
              {recents.slice(0, RECENTS_SHOWN).map((r) => (
                <button
                  key={r.name}
                  className="tap"
                  onClick={() => openAdd("snack", [r])}
                  style={styles.quickChip}
                  title={`${fmt(r.cal)} cal · P${fmt(r.p)} C${fmt(r.c)} F${fmt(r.f)}`}
                >
                  <Plus size={11} />
                  {r.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Favourites */}
        {favourites.length > 0 && (
          <div style={styles.card}>
            <div style={styles.cardLabel}>
              <Star size={11} fill={COLORS.gold} color={COLORS.gold} style={{ verticalAlign: -1, marginRight: 4 }} />
              FAVOURITES
            </div>
            <div style={styles.quickRow}>
              {favourites.map((f) => (
                <button
                  key={f.name}
                  className="tap"
                  onClick={() => openAdd("snack", [f])}
                  style={styles.quickChip}
                  title={`${fmt(f.cal)} cal · P${fmt(f.p)} C${fmt(f.c)} F${fmt(f.f)}`}
                >
                  <Plus size={11} />
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Weight (manual) */}
        <div style={styles.card}>
          <div style={styles.rowBetween}>
            <div style={styles.cardLabel}>WEIGHT</div>
            <Scale size={14} color={COLORS.textMuted} />
          </div>
          <div style={styles.weightRow}>
            <div>
              <div className="num" style={styles.bigNum}>
                {latestWeight != null ? `${fmt(latestWeight)}` : "—"}
                {latestWeight != null && <span style={styles.unit}> kg</span>}
              </div>
              <div style={styles.muted}>
                {weightDelta == null
                  ? "Log your weight to start tracking"
                  : weightDelta === 0
                  ? "No change since last entry"
                  : weightDelta < 0
                  ? `Down ${fmt(-weightDelta)} kg since last entry`
                  : `Up ${fmt(weightDelta)} kg since last entry`}
              </div>
            </div>
            <div style={styles.weightInputRow}>
              <input
                type="number"
                inputMode="decimal"
                placeholder="kg"
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                style={{ ...styles.input, width: 84 }}
              />
              <button className="tap" onClick={saveWeight} style={styles.smallBtn}>
                Log
              </button>
            </div>
          </div>
        </div>

        {/* Exercise / calories burned */}
        <div style={styles.card}>
          <div style={styles.rowBetween}>
            <div style={styles.cardLabel}>EXERCISE</div>
            <Dumbbell size={14} color={COLORS.textMuted} />
          </div>
          <div style={styles.weightRow}>
            <div>
              <div className="num" style={styles.bigNum}>
                {fmt(burned)}
                <span style={styles.unit}> cal burned</span>
              </div>
              <div style={styles.muted}>
                {burned > 0 ? "Added to today's calorie budget" : "Log a workout to earn back calories"}
              </div>
            </div>
            <div style={styles.weightInputRow}>
              <input
                type="number"
                inputMode="numeric"
                placeholder="kcal"
                value={burnInput}
                onChange={(e) => setBurnInput(e.target.value)}
                style={{ ...styles.input, width: 84 }}
              />
              <button className="tap" onClick={addBurned} style={styles.smallBtn}>
                Add
              </button>
            </div>
          </div>
          {burned > 0 && (
            <button className="tap" onClick={resetBurned} style={styles.linkBtn}>
              Reset
            </button>
          )}
        </div>

        {/* Water */}
        <div style={styles.card}>
          <div style={styles.rowBetween}>
            <div style={styles.cardLabel}>WATER</div>
            <div className="num" style={{ fontSize: 13, color: COLORS.textMuted }}>
              {(day.water_ml / 1000).toFixed(1)}L / {targets.waterL}L
            </div>
          </div>
          <div style={styles.glassRow}>
            {Array.from({ length: totalGlasses }).map((_, i) => (
              <button
                key={i}
                className="tap"
                onClick={() => (i < glassesFilled ? removeWater() : addWater())}
                style={{
                  ...styles.glass,
                  background: i < glassesFilled ? COLORS.blue : COLORS.track,
                  opacity: i < glassesFilled ? 1 : 0.5,
                }}
                aria-label={i < glassesFilled ? "Remove glass" : "Add glass"}
              >
                <Droplet size={16} color={i < glassesFilled ? "#0F1A20" : COLORS.textMuted} />
              </button>
            ))}
          </div>
        </div>

        <div style={styles.footer}>Tap a meal's Add to log by AI search, photo, or by hand.</div>
      </div>

      {addState && (
        <AddFoodModal
          initialMeal={addState.meal}
          initialStaged={addState.staged}
          apiKey={apiKey}
          model={model}
          recents={recents}
          favourites={favourites}
          onAddFavourite={addFavourite}
          onRemoveFavourite={removeFavourite}
          onClose={() => setAddState(null)}
          onOpenSettings={() => {
            setAddState(null);
            setSettingsOpen(true);
          }}
          onCommit={(meal, items) => {
            addItems(meal, items);
            setAddState(null);
          }}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          targets={targets}
          apiKey={apiKey}
          model={model}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
      )}
    </div>
  );
}

// ---- Macro wheel (three arcs = % of each macro goal met) ----
function MacroWheel({ totals, targets, calorieTarget, calColor }) {
  const R = 70;
  const CIRC = 2 * Math.PI * R;
  const arcLen = CIRC / 3 - 6;
  const pArc = Math.min(1, totals.p / (targets.p || 1)) * arcLen;
  const cArc = Math.min(1, totals.c / (targets.c || 1)) * arcLen;
  const fArc = Math.min(1, totals.f / (targets.f || 1)) * arcLen;
  return (
    <svg width="180" height="180" viewBox="0 0 180 180">
      <g transform="rotate(-90 90 90)">
        <circle cx="90" cy="90" r={R} fill="none" stroke={COLORS.track} strokeWidth="14" />
        <circle cx="90" cy="90" r={R} fill="none" stroke={COLORS.gold} strokeWidth="14"
          strokeDasharray={`${pArc} ${CIRC}`} strokeDashoffset="0" strokeLinecap="round" />
        <circle cx="90" cy="90" r={R} fill="none" stroke={COLORS.sage} strokeWidth="14"
          strokeDasharray={`${cArc} ${CIRC}`} strokeDashoffset={-(CIRC / 3)} strokeLinecap="round" />
        <circle cx="90" cy="90" r={R} fill="none" stroke={COLORS.clay} strokeWidth="14"
          strokeDasharray={`${fArc} ${CIRC}`} strokeDashoffset={-(2 * CIRC / 3)} strokeLinecap="round" />
      </g>
      <text x="90" y="84" textAnchor="middle" className="num" fontSize="26" fontWeight="700" fill={calColor}>
        {fmt(totals.cal)}
      </text>
      <text x="90" y="104" textAnchor="middle" fontSize="11" fill={COLORS.textMuted}>
        of {fmt(calorieTarget)} cal
      </text>
    </svg>
  );
}

function MacroRow({ color, label, val, goal }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
      <div style={{ fontSize: 13, width: 56, color: COLORS.textMuted }}>{label}</div>
      <div className="num" style={{ fontSize: 13, fontWeight: 700 }}>
        {fmt(val)}
        <span style={{ color: COLORS.textMuted, fontWeight: 500 }}>/{fmt(goal)}g</span>
      </div>
    </div>
  );
}

// ---- Add Food modal ----
// Unified staging: AI / photo / manual all fill an editable list of items,
// which the user reviews and then commits to the chosen meal.
function AddFoodModal({
  initialMeal,
  initialStaged,
  apiKey,
  model,
  recents,
  favourites,
  onAddFavourite,
  onRemoveFavourite,
  onClose,
  onOpenSettings,
  onCommit,
}) {
  const [meal, setMeal] = useState(initialMeal);
  const [method, setMethod] = useState(initialStaged.length ? "manual" : "ai");
  const [staged, setStaged] = useState(() =>
    initialStaged.map((it) => ({ name: it.name, cal: it.cal, p: it.p, c: it.c, f: it.f }))
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  const hasKey = !!apiKey;
  const isFav = (name) => name && favourites.some((f) => sameName(f.name, name));

  const addStaged = (items) => setStaged((prev) => [...prev, ...items]);
  const updateStaged = (idx, patch) =>
    setStaged((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeStaged = (idx) => setStaged((prev) => prev.filter((_, i) => i !== idx));

  const toggleFav = (item) => {
    if (!item.name || !item.name.trim()) return;
    if (isFav(item.name)) onRemoveFavourite(item.name);
    else onAddFavourite(item);
  };

  const runText = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const items = await estimateFromText(apiKey, text.trim(), model);
      addStaged(items);
      setText("");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const runPhoto = async (file) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const { base64, mediaType, preview: p } = await fileToImage(file);
      setPreview(p);
      const items = await estimateFromImage(apiKey, base64, mediaType, model);
      addStaged(items);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const validStaged = staged.filter((it) => it.name && it.name.trim());
  const commit = () => {
    const items = validStaged.map((it) => ({
      name: it.name.trim(),
      cal: Number(it.cal) || 0,
      p: Number(it.p) || 0,
      c: Number(it.c) || 0,
      f: Number(it.f) || 0,
    }));
    if (items.length) onCommit(meal, items);
  };

  const methods = [
    { key: "ai", label: "AI search", icon: Sparkles },
    { key: "photo", label: "Photo", icon: Camera },
    { key: "manual", label: "Manual", icon: PencilLine },
  ];

  return (
    <Overlay onClose={onClose} title="Add food">
      {/* Meal picker */}
      <div style={styles.segmented}>
        {MEALS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMeal(m.key)}
            style={{ ...styles.segment, ...(meal === m.key ? styles.segmentActive : {}) }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Method tabs */}
      <div style={styles.tabs}>
        {methods.map((mt) => {
          const Icon = mt.icon;
          return (
            <button
              key={mt.key}
              onClick={() => {
                setMethod(mt.key);
                setError("");
              }}
              style={{ ...styles.tab, ...(method === mt.key ? styles.tabActive : {}) }}
            >
              <Icon size={14} /> {mt.label}
            </button>
          );
        })}
      </div>

      {/* Method input */}
      {method === "ai" &&
        (hasKey ? (
          <div style={styles.form}>
            <textarea
              placeholder="e.g. large flat white and a ham & cheese toastie"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              style={{ ...styles.input, resize: "vertical" }}
            />
            <button className="tap" onClick={runText} disabled={busy} style={styles.primaryBtn}>
              {busy ? "Estimating…" : "Estimate with AI"}
            </button>
          </div>
        ) : (
          <KeyNotice onOpenSettings={onOpenSettings} />
        ))}

      {method === "photo" &&
        (hasKey ? (
          <div style={styles.form}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => runPhoto(e.target.files && e.target.files[0])}
            />
            {preview && <img src={preview} alt="food" style={styles.preview} />}
            <button
              className="tap"
              onClick={() => fileRef.current && fileRef.current.click()}
              disabled={busy}
              style={styles.primaryBtn}
            >
              {busy ? "Analysing…" : preview ? "Choose another photo" : "Take / choose photo"}
            </button>
          </div>
        ) : (
          <KeyNotice onOpenSettings={onOpenSettings} />
        ))}

      {method === "manual" && (
        <div style={styles.form}>
          <button
            className="tap"
            onClick={() => addStaged([{ name: "", cal: "", p: "", c: "", f: "" }])}
            style={styles.secondaryBtn}
          >
            <Plus size={14} /> Add item
          </button>
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      {/* Staged items (editable) */}
      {staged.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={styles.cardLabel}>ITEMS</div>
          {staged.map((it, idx) => (
            <ItemEditor
              key={idx}
              item={it}
              favourited={isFav(it.name)}
              onToggleFav={() => toggleFav(it)}
              onChange={(patch) => updateStaged(idx, patch)}
              onRemove={() => removeStaged(idx)}
            />
          ))}
        </div>
      )}

      {/* Favourites — pull frequent items into the log */}
      {favourites.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={styles.cardLabel}>FAVOURITES</div>
          <div style={styles.quickRow}>
            {favourites.map((f) => (
              <FavChip
                key={f.name}
                item={f}
                onAdd={() => addStaged([{ name: f.name, cal: f.cal, p: f.p, c: f.c, f: f.f }])}
                onRemove={() => onRemoveFavourite(f.name)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recents (10 most recent) */}
      {recents.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={styles.cardLabel}>RECENT</div>
          <div style={styles.quickRow}>
            {recents.slice(0, RECENTS_SHOWN).map((r) => (
              <button
                key={r.name}
                className="tap"
                onClick={() => addStaged([{ name: r.name, cal: r.cal, p: r.p, c: r.c, f: r.f }])}
                style={styles.quickChip}
              >
                <Plus size={11} />
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        className="tap"
        onClick={commit}
        disabled={validStaged.length === 0}
        style={{ ...styles.primaryBtn, marginTop: 14, opacity: validStaged.length === 0 ? 0.5 : 1 }}
      >
        {validStaged.length > 0
          ? `Add ${validStaged.length} to ${MEALS.find((m) => m.key === meal).label}`
          : "Add items to log"}
      </button>
    </Overlay>
  );
}

function ItemEditor({ item, favourited, onToggleFav, onChange, onRemove }) {
  const macros = [
    ["cal", "Cal"],
    ["p", "Protein (g)"],
    ["c", "Carbs (g)"],
    ["f", "Fat (g)"],
  ];
  return (
    <div style={styles.editorCard}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          placeholder="Food name"
          value={item.name}
          onChange={(e) => onChange({ name: e.target.value })}
          style={{ ...styles.input, flex: 1 }}
        />
        <button
          className="tap"
          onClick={onToggleFav}
          style={styles.iconBtn}
          aria-label={favourited ? "Remove from favourites" : "Add to favourites"}
          title={favourited ? "Remove from favourites" : "Add to favourites"}
        >
          <Star size={16} color={favourited ? COLORS.gold : COLORS.textMuted} fill={favourited ? COLORS.gold : "none"} />
        </button>
        <button className="tap" onClick={onRemove} style={styles.iconBtn} aria-label="Remove item">
          <X size={15} color={COLORS.textMuted} />
        </button>
      </div>
      <div style={styles.formGrid}>
        {macros.map(([field, label]) => (
          <label key={field} style={styles.fieldLabel}>
            <span style={styles.miniLabel}>{label}</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={item[field]}
              onChange={(e) => onChange({ [field]: e.target.value })}
              style={styles.input}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function FavChip({ item, onAdd, onRemove }) {
  return (
    <span style={styles.favChip} title={`${fmt(item.cal)} cal · P${fmt(item.p)} C${fmt(item.c)} F${fmt(item.f)}`}>
      <button className="tap" onClick={onAdd} style={styles.favChipMain}>
        <Plus size={11} />
        {item.name}
      </button>
      <button className="tap" onClick={onRemove} style={styles.favChipX} aria-label="Remove favourite">
        <X size={11} color={COLORS.textMuted} />
      </button>
    </span>
  );
}

function KeyNotice({ onOpenSettings }) {
  return (
    <div style={styles.notice}>
      <div style={{ marginBottom: 8 }}>
        AI features need your Anthropic API key. It's stored only in this browser.
      </div>
      <button className="tap" onClick={onOpenSettings} style={styles.secondaryBtn}>
        <SettingsIcon size={14} /> Add key in Settings
      </button>
    </div>
  );
}

// ---- Settings modal ----
function SettingsModal({ targets, apiKey, model, onClose, onSave }) {
  const [t, setT] = useState(targets);
  const [key, setKey] = useState(apiKey);
  const [mdl, setMdl] = useState(model || DEFAULT_MODEL);

  const num = (v) => (v === "" ? "" : Number(v));
  const field = (k) => (e) => setT({ ...t, [k]: num(e.target.value) });

  return (
    <Overlay onClose={onClose} title="Settings">
      <div style={styles.cardLabel}>DAILY TARGETS (MAINTENANCE)</div>
      <div style={styles.settingsGrid}>
        <Labeled label="Calories">
          <input type="number" inputMode="decimal" value={t.cal} onChange={field("cal")} style={styles.input} />
        </Labeled>
        <Labeled label="Protein (g)">
          <input type="number" inputMode="decimal" value={t.p} onChange={field("p")} style={styles.input} />
        </Labeled>
        <Labeled label="Carbs (g)">
          <input type="number" inputMode="decimal" value={t.c} onChange={field("c")} style={styles.input} />
        </Labeled>
        <Labeled label="Fat (g)">
          <input type="number" inputMode="decimal" value={t.f} onChange={field("f")} style={styles.input} />
        </Labeled>
        <Labeled label="Water (L)">
          <input type="number" inputMode="decimal" value={t.waterL} onChange={field("waterL")} style={styles.input} />
        </Labeled>
      </div>

      <div style={{ ...styles.cardLabel, marginTop: 18 }}>AI MODEL</div>
      <div style={styles.segmented}>
        {MODEL_OPTIONS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMdl(m.id)}
            style={{ ...styles.segment, ...(mdl === m.id ? styles.segmentActive : {}) }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div style={styles.hint}>
        Opus is most capable, Haiku is fastest and cheapest, Sonnet is in between. Used for AI food
        search and photo recognition.
      </div>

      <div style={{ ...styles.cardLabel, marginTop: 18 }}>ANTHROPIC API KEY</div>
      <input
        type="password"
        placeholder="sk-ant-…"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        style={styles.input}
        autoComplete="off"
      />
      <div style={styles.hint}>
        Used only from this browser. Stored locally, never uploaded anywhere but Anthropic. Get a key
        at console.anthropic.com.
      </div>

      <button
        className="tap"
        onClick={() =>
          onSave({
            targets: {
              cal: Number(t.cal) || 0,
              p: Number(t.p) || 0,
              c: Number(t.c) || 0,
              f: Number(t.f) || 0,
              waterL: Number(t.waterL) || 0,
            },
            apiKey: key.trim(),
            model: mdl || DEFAULT_MODEL,
          })
        }
        style={{ ...styles.primaryBtn, marginTop: 16 }}
      >
        Save
      </button>
    </Overlay>
  );
}

function Labeled({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: COLORS.textMuted }}>{label}</span>
      {children}
    </label>
  );
}

function Overlay({ title, onClose, children }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div style={styles.modalTitle}>{title}</div>
          <button className="tap" onClick={onClose} style={styles.iconBtn} aria-label="Close">
            <X size={18} color={COLORS.text} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const COLORS = {
  bg: "#17140F",
  card: "#211D17",
  border: "#332C22",
  text: "#F5EFE4",
  textMuted: "#A79C89",
  gold: "#E3A438",
  green: "#6FB07F",
  sage: "#7C9473",
  clay: "#B97155",
  blue: "#5C8AA8",
  danger: "#C25450",
  track: "#332C22",
};

const styles = {
  page: {
    minHeight: "100vh",
    background: COLORS.bg,
    color: COLORS.text,
    fontFamily: "'Inter', sans-serif",
    padding: "20px 14px 40px",
  },
  container: { maxWidth: 440, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 },
  eyebrow: { fontSize: 11, letterSpacing: 1.5, color: COLORS.textMuted, marginBottom: 2 },
  h1: { fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700 },
  iconCircle: {
    width: 38, height: 38, borderRadius: 19, background: COLORS.card,
    border: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "center",
  },
  card: {
    background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 16,
    padding: 16, marginBottom: 12,
  },
  cardLabel: { fontSize: 11, letterSpacing: 1.2, color: COLORS.textMuted, fontWeight: 600, marginBottom: 10 },
  wheelRow: { display: "flex", alignItems: "center", gap: 16 },
  macroList: { flex: 1 },
  rowBetween: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  mealTitle: { fontSize: 15, fontWeight: 700, display: "flex", alignItems: "baseline", gap: 8 },
  mealCal: { fontSize: 12, color: COLORS.textMuted, fontWeight: 500 },
  addBtn: {
    display: "flex", alignItems: "center", gap: 4, background: "transparent",
    color: COLORS.gold, border: `1px solid ${COLORS.gold}`, borderRadius: 20,
    padding: "5px 12px", fontSize: 12, fontWeight: 600,
  },
  itemRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
    padding: "10px 0", borderTop: `1px solid ${COLORS.border}`, marginTop: 10,
  },
  itemName: { fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  emptyState: { fontSize: 13, color: COLORS.textMuted, padding: "6px 0" },
  quickRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  quickChip: {
    display: "flex", alignItems: "center", gap: 4, background: COLORS.bg,
    border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "6px 10px",
    fontSize: 11.5, color: COLORS.text, whiteSpace: "nowrap", maxWidth: "100%",
  },
  favChip: {
    display: "inline-flex", alignItems: "stretch", background: COLORS.bg,
    border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: "hidden", maxWidth: "100%",
  },
  favChipMain: {
    display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none",
    padding: "6px 8px 6px 10px", fontSize: 11.5, color: COLORS.text, whiteSpace: "nowrap",
  },
  favChipX: {
    background: "transparent", border: "none", borderLeft: `1px solid ${COLORS.border}`,
    padding: "0 7px", display: "flex", alignItems: "center",
  },
  weightRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 },
  bigNum: { fontSize: 32, fontWeight: 700 },
  unit: { fontSize: 15, color: COLORS.textMuted, fontWeight: 500 },
  weightInputRow: { display: "flex", gap: 6 },
  linkBtn: {
    background: "transparent", border: "none", color: COLORS.textMuted, fontSize: 12,
    padding: "8px 0 0", textDecoration: "underline",
  },
  input: {
    background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8,
    padding: "9px 10px", color: COLORS.text, fontSize: 13, width: "100%", outline: "none",
  },
  smallBtn: {
    background: COLORS.gold, color: "#1A1400", border: "none", borderRadius: 8,
    padding: "0 16px", fontWeight: 700, fontSize: 13,
  },
  glassRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 },
  glass: {
    width: 32, height: 32, borderRadius: 8, border: "none",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  footer: { textAlign: "center", fontSize: 11, color: COLORS.textMuted, marginTop: 8 },

  // Modal
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
    alignItems: "flex-end", justifyContent: "center", zIndex: 50, padding: "0",
  },
  modal: {
    background: COLORS.card, border: `1px solid ${COLORS.border}`,
    borderRadius: "18px 18px 0 0", padding: 18, width: "100%", maxWidth: 460,
    maxHeight: "92vh", overflowY: "auto",
  },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  modalTitle: { fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700 },
  segmented: {
    display: "flex", gap: 4, background: COLORS.bg, border: `1px solid ${COLORS.border}`,
    borderRadius: 10, padding: 4, marginBottom: 12,
  },
  segment: {
    flex: 1, background: "transparent", border: "none", color: COLORS.textMuted,
    padding: "7px 4px", borderRadius: 7, fontSize: 12.5, fontWeight: 600,
  },
  segmentActive: { background: COLORS.card, color: COLORS.text, border: `1px solid ${COLORS.border}` },
  tabs: { display: "flex", gap: 6, marginBottom: 12 },
  tab: {
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
    background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textMuted,
    borderRadius: 9, padding: "9px 6px", fontSize: 12.5, fontWeight: 600,
  },
  tabActive: { color: "#1A1400", background: COLORS.gold, border: `1px solid ${COLORS.gold}` },
  form: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 8 },
  fieldLabel: { display: "flex", flexDirection: "column", gap: 3 },
  miniLabel: { fontSize: 10, color: COLORS.textMuted, letterSpacing: 0.3 },
  primaryBtn: {
    background: COLORS.gold, color: "#1A1400", border: "none", borderRadius: 9,
    padding: "11px", fontWeight: 700, fontSize: 13, width: "100%",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  },
  secondaryBtn: {
    background: "transparent", color: COLORS.text, border: `1px solid ${COLORS.border}`,
    borderRadius: 9, padding: "10px", fontWeight: 600, fontSize: 13,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  },
  editorCard: {
    background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 10,
    padding: 10, marginBottom: 8,
  },
  preview: { width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 10 },
  error: {
    background: "rgba(194,84,80,0.15)", border: `1px solid ${COLORS.danger}`, color: COLORS.text,
    borderRadius: 9, padding: "9px 11px", fontSize: 12.5, margin: "10px 0 4px",
  },
  notice: {
    background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 10,
    padding: 12, fontSize: 13, color: COLORS.textMuted,
  },
  settingsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  hint: { fontSize: 11.5, color: COLORS.textMuted, marginTop: 6, lineHeight: 1.4 },
};
