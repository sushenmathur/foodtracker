import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Droplet, Flame, TrendingDown } from "lucide-react";

// ---- Profile (Sushen's plan) ----
const PROFILE = {
  name: "Sushen",
  startWeight: 78.5,
  goalWeight: 77.0,
  startDate: "2026-07-01",
  weeks: 3,
  calGoal: 2135,
  proteinGoal: 173,
  carbGoal: 224,
  fatGoal: 61,
  waterGoalL: 3.6,
  bmr: 1700,
  tdee: 2635,
};

const QUICK_ADDS = [
  { name: "Berry protein smoothie mix (150g)", cal: 105, p: 12, c: 15, f: 1 },
  { name: "Coles Perform Protein Yoghurt (150g)", cal: 111, p: 22.5, c: 7.5, f: 1.2 },
  { name: "Muscle Nation protein water (30g)", cal: 95, p: 23.6, c: 2.1, f: 0 },
  { name: "Baker's Life protein bread (2 slices)", cal: 248, p: 23.6, c: 5, f: 12.8 },
  { name: "Low-fat cottage cheese (90g)", cal: 72, p: 10.8, c: 2.7, f: 1.8 },
];

const GLASS_ML = 450; // one tap = one glass
const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function emptyDay() {
  return { weight: null, water_ml: 0, items: [] };
}

export default function Tracker() {
  const [today] = useState(() => todayKey());
  const [day, setDay] = useState(emptyDay());
  const [history, setHistory] = useState({}); // date -> {weight}
  const [loading, setLoading] = useState(true);
  const [weightInput, setWeightInput] = useState("");
  const [form, setForm] = useState({ name: "", cal: "", p: "", c: "", f: "" });
  const [showForm, setShowForm] = useState(false);

  const dayNum = Math.min(
    PROFILE.weeks * 7,
    Math.max(1, daysBetween(PROFILE.startDate, today) + 1)
  );
  const totalDays = PROFILE.weeks * 7;

  // ---- Load ----
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(`log:${today}`);
        if (res) setDay(JSON.parse(res.value));
      } catch {
        setDay(emptyDay());
      }
      try {
        const listRes = await window.storage.list("log:");
        if (listRes?.keys?.length) {
          const entries = {};
          for (const k of listRes.keys) {
            try {
              const r = await window.storage.get(k);
              if (r) {
                const parsed = JSON.parse(r.value);
                if (parsed.weight) entries[k.replace("log:", "")] = parsed.weight;
              }
            } catch {}
          }
          setHistory(entries);
        }
      } catch {}
      setLoading(false);
    })();
  }, [today]);

  // ---- Save helper ----
  const persist = async (next) => {
    setDay(next);
    try {
      await window.storage.set(`log:${today}`, JSON.stringify(next));
    } catch (e) {
      console.error("save failed", e);
    }
  };

  const totals = useMemo(() => {
    return day.items.reduce(
      (acc, it) => ({
        cal: acc.cal + it.cal,
        p: acc.p + it.p,
        c: acc.c + it.c,
        f: acc.f + it.f,
      }),
      { cal: 0, p: 0, c: 0, f: 0 }
    );
  }, [day.items]);

  const addItem = () => {
    if (!form.name || !form.cal) return;
    const item = {
      id: Date.now().toString(36),
      name: form.name,
      cal: Number(form.cal) || 0,
      p: Number(form.p) || 0,
      c: Number(form.c) || 0,
      f: Number(form.f) || 0,
    };
    const next = { ...day, items: [...day.items, item] };
    persist(next);
    setForm({ name: "", cal: "", p: "", c: "", f: "" });
    setShowForm(false);
  };

  const quickAdd = (preset) => {
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...preset };
    persist({ ...day, items: [...day.items, item] });
  };

  const removeItem = (id) => {
    const next = { ...day, items: day.items.filter((i) => i.id !== id) };
    persist(next);
  };

  const addWater = () => {
    const next = { ...day, water_ml: Math.min(day.water_ml + GLASS_ML, GLASS_ML * 12) };
    persist(next);
  };
  const removeWater = () => {
    const next = { ...day, water_ml: Math.max(day.water_ml - GLASS_ML, 0) };
    persist(next);
  };

  const saveWeight = () => {
    const w = parseFloat(weightInput);
    if (!w) return;
    const next = { ...day, weight: w };
    persist(next);
    setHistory((h) => ({ ...h, [today]: w }));
    setWeightInput("");
  };

  const lastWeight = day.weight ?? Object.values(history).slice(-1)[0] ?? PROFILE.startWeight;
  const weightLost = +(PROFILE.startWeight - lastWeight).toFixed(1);
  const weightToGo = +(lastWeight - PROFILE.goalWeight).toFixed(1);

  // Macro wheel geometry: three arcs, each a third of the ring,
  // filled by % of that macro's goal met
  const R = 70;
  const CIRC = 2 * Math.PI * R;
  const arcLen = CIRC / 3 - 6; // gap between arcs
  const pArc = Math.min(1, totals.p / PROFILE.proteinGoal) * arcLen;
  const cArc = Math.min(1, totals.c / PROFILE.carbGoal) * arcLen;
  const fArc = Math.min(1, totals.f / PROFILE.fatGoal) * arcLen;

  const calRemaining = PROFILE.calGoal - totals.cal;
  const glassesFilled = Math.round(day.water_ml / GLASS_ML);
  const totalGlasses = Math.round((PROFILE.waterGoalL * 1000) / GLASS_ML);

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
        .glass-btn { transition: transform 0.12s ease, opacity 0.12s ease; }
        .glass-btn:active { transform: scale(0.9); }
        button { font-family: 'Inter', sans-serif; cursor: pointer; }
        input { font-family: 'Inter', sans-serif; }
      `}</style>

      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>DAY {dayNum} OF {totalDays}</div>
            <div style={styles.h1}>{PROFILE.name}'s cut</div>
          </div>
          <div style={styles.pill}>
            <TrendingDown size={14} color={COLORS.gold} />
            <span className="num" style={{ fontWeight: 700, fontSize: 13 }}>
              {weightToGo > 0 ? `${weightToGo} kg to go` : "goal reached"}
            </span>
          </div>
        </div>

        {/* Weight card */}
        <div style={styles.card}>
          <div style={styles.cardLabel}>WEIGHT</div>
          <div style={styles.weightRow}>
            <div>
              <div className="num" style={styles.bigNum}>{lastWeight}</div>
              <div style={styles.muted}>kg · {weightLost >= 0 ? `down ${weightLost}` : `up ${-weightLost}`} from {PROFILE.startWeight}</div>
            </div>
            <div style={styles.weightInputRow}>
              <input
                type="number"
                inputMode="decimal"
                placeholder={String(lastWeight)}
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                style={styles.input}
              />
              <button onClick={saveWeight} style={styles.smallBtn}>Log</button>
            </div>
          </div>
          <WeightBar start={PROFILE.startWeight} goal={PROFILE.goalWeight} current={lastWeight} />
        </div>

        {/* Macro wheel */}
        <div style={styles.card}>
          <div style={styles.cardLabel}>TODAY'S FUEL</div>
          <div style={styles.wheelRow}>
            <svg width="180" height="180" viewBox="0 0 180 180">
              <g transform="rotate(-90 90 90)">
                <circle cx="90" cy="90" r={R} fill="none" stroke={COLORS.track} strokeWidth="14" />
                {/* protein arc */}
                <circle
                  cx="90" cy="90" r={R} fill="none" stroke={COLORS.gold} strokeWidth="14"
                  strokeDasharray={`${pArc} ${CIRC}`} strokeDashoffset="0" strokeLinecap="round"
                />
                {/* carb arc */}
                <circle
                  cx="90" cy="90" r={R} fill="none" stroke={COLORS.sage} strokeWidth="14"
                  strokeDasharray={`${cArc} ${CIRC}`} strokeDashoffset={-(CIRC / 3)} strokeLinecap="round"
                />
                {/* fat arc */}
                <circle
                  cx="90" cy="90" r={R} fill="none" stroke={COLORS.clay} strokeWidth="14"
                  strokeDasharray={`${fArc} ${CIRC}`} strokeDashoffset={-(2 * CIRC / 3)} strokeLinecap="round"
                />
              </g>
              <text x="90" y="84" textAnchor="middle" className="num" fontSize="26" fontWeight="700" fill={COLORS.text}>
                {totals.cal}
              </text>
              <text x="90" y="104" textAnchor="middle" fontSize="11" fill={COLORS.textMuted}>
                of {PROFILE.calGoal} cal
              </text>
            </svg>
            <div style={styles.macroList}>
              <MacroRow color={COLORS.gold} label="Protein" val={totals.p} goal={PROFILE.proteinGoal} unit="g" />
              <MacroRow color={COLORS.sage} label="Carbs" val={totals.c} goal={PROFILE.carbGoal} unit="g" />
              <MacroRow color={COLORS.clay} label="Fat" val={totals.f} goal={PROFILE.fatGoal} unit="g" />
              <div style={{ marginTop: 8, fontSize: 12, color: COLORS.textMuted }}>
                {calRemaining >= 0
                  ? <span><Flame size={12} style={{ verticalAlign: -2 }} /> {calRemaining} cal left today</span>
                  : <span style={{ color: COLORS.danger }}>{-calRemaining} cal over</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Food log */}
        <div style={styles.card}>
          <div style={styles.rowBetween}>
            <div style={styles.cardLabel}>LOGGED TODAY</div>
            <button onClick={() => setShowForm((s) => !s)} style={styles.addBtn}>
              <Plus size={14} /> Add
            </button>
          </div>

          <div style={styles.quickRow}>
            {QUICK_ADDS.map((preset) => (
              <button key={preset.name} onClick={() => quickAdd(preset)} style={styles.quickChip}>
                <Plus size={11} />
                {preset.name}
              </button>
            ))}
          </div>

          {showForm && (
            <div style={styles.form}>
              <input placeholder="Food name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={styles.input} />
              <div style={styles.formGrid}>
                <input placeholder="kcal" type="number" inputMode="numeric" value={form.cal} onChange={(e) => setForm({ ...form, cal: e.target.value })} style={styles.input} />
                <input placeholder="protein g" type="number" inputMode="numeric" value={form.p} onChange={(e) => setForm({ ...form, p: e.target.value })} style={styles.input} />
                <input placeholder="carbs g" type="number" inputMode="numeric" value={form.c} onChange={(e) => setForm({ ...form, c: e.target.value })} style={styles.input} />
                <input placeholder="fat g" type="number" inputMode="numeric" value={form.f} onChange={(e) => setForm({ ...form, f: e.target.value })} style={styles.input} />
              </div>
              <button onClick={addItem} style={styles.primaryBtn}>Add to log</button>
            </div>
          )}

          {day.items.length === 0 && !showForm && (
            <div style={styles.emptyState}>Nothing logged yet. Tap Add to start.</div>
          )}
          {day.items.map((it) => (
            <div key={it.id} style={styles.itemRow}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{it.name}</div>
                <div style={styles.muted}>
                  {it.cal} cal · P{it.p} C{it.c} F{it.f}
                </div>
              </div>
              <button onClick={() => removeItem(it.id)} style={styles.iconBtn}>
                <Trash2 size={15} color={COLORS.textMuted} />
              </button>
            </div>
          ))}
        </div>

        {/* Water */}
        <div style={styles.card}>
          <div style={styles.rowBetween}>
            <div style={styles.cardLabel}>WATER</div>
            <div className="num" style={{ fontSize: 13, color: COLORS.textMuted }}>
              {(day.water_ml / 1000).toFixed(1)}L / {PROFILE.waterGoalL}L
            </div>
          </div>
          <div style={styles.glassRow}>
            {Array.from({ length: totalGlasses }).map((_, i) => (
              <button
                key={i}
                className="glass-btn"
                onClick={() => (i < glassesFilled ? removeWater() : addWater())}
                style={{
                  ...styles.glass,
                  background: i < glassesFilled ? COLORS.blue : COLORS.track,
                  opacity: i < glassesFilled ? 1 : 0.5,
                }}
              >
                <Droplet size={16} color={i < glassesFilled ? "#0F1A20" : COLORS.textMuted} />
              </button>
            ))}
          </div>
        </div>

        <div style={styles.footer}>
          BMR {PROFILE.bmr} · TDEE {PROFILE.tdee} · steady pace, high-protein
        </div>
      </div>
    </div>
  );
}

function MacroRow({ color, label, val, goal, unit }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
      <div style={{ fontSize: 13, width: 56, color: COLORS.textMuted }}>{label}</div>
      <div className="num" style={{ fontSize: 13, fontWeight: 700 }}>
        {val}<span style={{ color: COLORS.textMuted, fontWeight: 500 }}>/{goal}{unit}</span>
      </div>
    </div>
  );
}

function WeightBar({ start, goal, current }) {
  const span = start - goal;
  const progressed = Math.min(1, Math.max(0, (start - current) / span));
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ position: "relative", height: 6, background: COLORS.track, borderRadius: 3 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${progressed * 100}%`,
            background: COLORS.gold,
            borderRadius: 3,
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: COLORS.textMuted }}>
        <span>{start}</span>
        <span>{goal} goal</span>
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
  pill: {
    display: "flex", alignItems: "center", gap: 5, background: COLORS.card,
    border: `1px solid ${COLORS.border}`, borderRadius: 20, padding: "6px 12px",
  },
  card: {
    background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 16,
    padding: 16, marginBottom: 12,
  },
  cardLabel: { fontSize: 11, letterSpacing: 1.2, color: COLORS.textMuted, fontWeight: 600, marginBottom: 10 },
  weightRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  bigNum: { fontSize: 32, fontWeight: 700 },
  muted: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  weightInputRow: { display: "flex", gap: 6 },
  input: {
    background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8,
    padding: "8px 10px", color: COLORS.text, fontSize: 13, width: "100%", outline: "none",
  },
  smallBtn: {
    background: COLORS.gold, color: "#1A1400", border: "none", borderRadius: 8,
    padding: "0 14px", fontWeight: 700, fontSize: 13,
  },
  wheelRow: { display: "flex", alignItems: "center", gap: 16 },
  macroList: { flex: 1 },
  rowBetween: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  addBtn: {
    display: "flex", alignItems: "center", gap: 4, background: "transparent",
    color: COLORS.gold, border: `1px solid ${COLORS.gold}`, borderRadius: 20,
    padding: "5px 12px", fontSize: 12, fontWeight: 600,
  },
  quickRow: { display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0 2px" },
  quickChip: {
    display: "flex", alignItems: "center", gap: 4, background: COLORS.bg,
    border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "6px 10px",
    fontSize: 11.5, color: COLORS.text, whiteSpace: "nowrap",
  },
  form: { display: "flex", flexDirection: "column", gap: 8, margin: "10px 0" },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 },
  primaryBtn: {
    background: COLORS.gold, color: "#1A1400", border: "none", borderRadius: 8,
    padding: "10px", fontWeight: 700, fontSize: 13,
  },
  emptyState: { fontSize: 13, color: COLORS.textMuted, padding: "8px 0" },
  itemRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 0", borderTop: `1px solid ${COLORS.border}`,
  },
  iconBtn: { background: "transparent", border: "none", padding: 4 },
  glassRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 },
  glass: {
    width: 32, height: 32, borderRadius: 8, border: "none",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  footer: { textAlign: "center", fontSize: 11, color: COLORS.textMuted, marginTop: 8 },
};
