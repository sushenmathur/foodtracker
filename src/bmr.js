// BMR / TDEE / macro-target calculation for the setup interview.
// Ported from the provided nutrition-setup flow: Mifflin-St Jeor BMR,
// standard activity multipliers, goal-based deficit/surplus, and
// sports-nutrition macro splits. Pure functions — no UI.

export const ACTIVITY = [
  { key: "sedentary", label: "Sedentary", helper: "Little to no exercise, desk job" },
  { key: "light", label: "Lightly active", helper: "Light exercise 1–3 days/week" },
  { key: "moderate", label: "Moderately active", helper: "Moderate exercise 3–5 days/week" },
  { key: "very", label: "Very active", helper: "Hard exercise 6–7 days/week" },
  { key: "athlete", label: "Athlete", helper: "Intense daily training or physical job" },
];
const ACTIVITY_FACTOR = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725, athlete: 1.9 };

export const GOALS = [
  { key: "lose", label: "Lose weight" },
  { key: "maintain", label: "Maintain" },
  { key: "gain", label: "Gain weight" },
];

export const PACE = [
  { key: "gentle", label: "Gentle", helper: "Slow and easy to stick with" },
  { key: "steady", label: "Steady", helper: "A solid, sustainable pace" },
  { key: "aggressive", label: "Aggressive", helper: "Faster results, more discipline" },
];

function toKg(v, unit) {
  const n = parseFloat(v) || 0;
  return unit === "metric" ? n : n * 0.453592;
}
function toLb(v, unit) {
  const n = parseFloat(v) || 0;
  return unit === "metric" ? n * 2.20462 : n;
}
function heightToCm(a) {
  if (a.unit === "metric") return parseFloat(a.heightCm) || 0;
  const ft = parseFloat(a.heightFt) || 0;
  const inch = parseFloat(a.heightIn) || 0;
  return (ft * 12 + inch) * 2.54;
}

export function computePlan(a) {
  const heightCm = heightToCm(a);
  const weightKg = toKg(a.weight, a.unit);
  const weightLb = toLb(a.weight, a.unit);
  const age = parseFloat(a.age) || 0;

  const bmr =
    a.sex === "male"
      ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;

  const tdee = bmr * (ACTIVITY_FACTOR[a.activity] || 1.2);

  let dailyCalories;
  if (a.goal === "maintain") {
    dailyCalories = tdee;
  } else if (a.goal === "lose") {
    const deficit = { gentle: 250, steady: 500, aggressive: 750 }[a.pace] || 500;
    dailyCalories = Math.max(tdee - deficit, a.sex === "male" ? 1500 : 1200);
  } else {
    const surplus = { gentle: 250, steady: 325, aggressive: 400 }[a.pace] || 325;
    dailyCalories = tdee + surplus;
  }

  const proteinFactor = a.goal === "lose" || a.activity === "athlete" ? 1.0 : 0.8;
  const proteinG = proteinFactor * weightLb;
  const fatG = 0.35 * weightLb;
  let carbsG = (dailyCalories - proteinG * 4 - fatG * 9) / 4;
  if (carbsG < 0) carbsG = 0;

  const waterL = 0.7 * weightLb * 0.0295735;

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    dailyCalories: Math.round(dailyCalories),
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
    carbsG: Math.round(carbsG),
    waterL: Math.round(waterL * 10) / 10,
  };
}

// Steps shown in the interview. Pace only matters when not maintaining.
export function planSteps(answers) {
  const base = ["sex", "age", "height", "weight", "activity", "goal"];
  return answers.goal === "maintain" ? base : [...base, "pace"];
}

export function planIsValid(key, a) {
  switch (key) {
    case "sex":
      return a.sex === "male" || a.sex === "female";
    case "age":
      return parseFloat(a.age) > 0 && parseFloat(a.age) < 120;
    case "height":
      return a.unit === "metric"
        ? parseFloat(a.heightCm) > 0
        : parseFloat(a.heightFt) > 0 || parseFloat(a.heightIn) > 0;
    case "weight":
      return parseFloat(a.weight) > 0;
    case "activity":
      return !!a.activity;
    case "goal":
      return !!a.goal;
    case "pace":
      return !!a.pace;
    default:
      return true;
  }
}

export const EMPTY_PROFILE = {
  sex: "",
  age: "",
  unit: "metric",
  heightCm: "",
  heightFt: "",
  heightIn: "",
  weight: "",
  activity: "",
  goal: "",
  pace: "",
};
