// Claude-powered nutrition estimation.
//
// Runs entirely in the browser using the user's own Anthropic API key
// (stored locally, never sent anywhere but Anthropic). This is the only
// workable approach for a static site with no backend — see README.
//
// Uses claude-opus-4-8 with:
//   - vision (base64 image input) for photo recognition
//   - structured outputs (output_config.format) so macros come back as
//     validated JSON rather than prose we'd have to scrape.
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-opus-4-8";

// JSON schema the model is constrained to. One entry per distinct food/dish;
// all values are for the whole described portion (not per 100g).
const MACRO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          cal: { type: "number" },
          p: { type: "number" },
          c: { type: "number" },
          f: { type: "number" },
        },
        required: ["name", "cal", "p", "c", "f"],
      },
    },
  },
  required: ["items"],
};

const SYSTEM = `You are a nutrition estimator for a macro-tracking app used in Australia.
Given a text description or a photo of food, estimate the nutrition for the portion described (or a typical single serving if no portion is given).
Return one entry per distinct food or dish. Prefer Australian supermarket products and portion norms where relevant.
All values are for the whole described portion, NOT per 100g: "cal" in kilocalories, "p" (protein), "c" (carbs) and "f" (fat) in grams.
Round calories to whole numbers; macros may use one decimal. Be realistic rather than conservative.`;

function round1(v) {
  const n = Number(v) || 0;
  return Math.round(n * 10) / 10;
}

function makeClient(apiKey, model) {
  if (!apiKey) throw new Error("No API key set. Add one in Settings.");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  return { client, model: model || DEFAULT_MODEL };
}

function parseItems(message) {
  if (message.stop_reason === "refusal") {
    throw new Error("Claude declined to answer that request.");
  }
  const block = message.content.find((b) => b.type === "text");
  if (!block) throw new Error("Empty response from Claude.");
  let data;
  try {
    data = JSON.parse(block.text);
  } catch {
    throw new Error("Could not read Claude's response.");
  }
  const items = (data.items || [])
    .map((it) => ({
      name: String(it.name || "Food").trim(),
      cal: Math.max(0, Math.round(Number(it.cal) || 0)),
      p: round1(it.p),
      c: round1(it.c),
      f: round1(it.f),
    }))
    .filter((it) => it.name);
  if (!items.length) throw new Error("No food detected. Try describing it differently.");
  return items;
}

export async function estimateFromText(apiKey, description, model) {
  const { client, model: m } = makeClient(apiKey, model);
  const message = await client.messages.create({
    model: m,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: `Estimate macros for: ${description}` }],
    output_config: { format: { type: "json_schema", schema: MACRO_SCHEMA } },
  });
  return parseItems(message);
}

export async function estimateFromImage(apiKey, base64, mediaType, model) {
  const { client, model: m } = makeClient(apiKey, model);
  const message = await client.messages.create({
    model: m,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          {
            type: "text",
            text: "Identify the food in this photo and estimate the macros for the portion shown.",
          },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: MACRO_SCHEMA } },
  });
  return parseItems(message);
}

// Map SDK/network errors to a short, user-facing message.
export function friendlyError(err) {
  const status = err && err.status;
  if (status === 401) return "Invalid API key — check it in Settings.";
  if (status === 403) return "This API key isn't permitted to use that model.";
  if (status === 429) return "Rate limited by Anthropic — try again shortly.";
  if (status === 400) return err.message || "The request was rejected.";
  const msg = (err && err.message) || "";
  if (msg.includes("Failed to fetch") || msg.includes("Network")) {
    return "Network error reaching Claude. Check your connection.";
  }
  return msg || "Something went wrong.";
}

// Read an image File into a downscaled JPEG base64 string (keeps requests
// small and cheap). Returns { base64, mediaType, preview (data URL) }.
export async function fileToImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the image."));
    image.src = dataUrl;
  });

  const maxEdge = 1024;
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: out.split(",")[1], mediaType: "image/jpeg", preview: out };
}
