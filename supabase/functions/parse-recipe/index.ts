import { createClient } from "jsr:@supabase/supabase-js@2";

type ParsedItem = {
  rawText: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  grams: number | null;
  role: "main" | "seasoning";
  needsGrams: boolean;
  defaultAction: "keep" | "ignore";
};

type ParsedRecipe = {
  recipeName: string;
  servings: number | null;
  items: ParsedItem[];
};

type OpenAIResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

const PROVIDER = "openai";
const DEFAULT_MODEL = "gpt-5-mini";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_OUTPUT_TOKENS = 2500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Max-Age": "86400",
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    recipeName: { type: "string" },
    servings: { type: ["number", "null"] },
    items: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          rawText: { type: "string" },
          name: { type: "string" },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          grams: { type: ["number", "null"] },
          role: { type: "string", enum: ["main", "seasoning"] },
          needsGrams: { type: "boolean" },
          defaultAction: { type: "string", enum: ["keep", "ignore"] },
        },
        required: [
          "rawText",
          "name",
          "quantity",
          "unit",
          "grams",
          "role",
          "needsGrams",
          "defaultAction",
        ],
      },
    },
  },
  required: ["recipeName", "servings", "items"],
};

const instructions = `You extract an editable recipe draft from pasted recipe text.

Return only ingredients and a suggested recipe name. Do not include cooking steps as ingredients.
Preserve the language used by the source when naming the recipe and ingredients.

Business rules:
1. Main nutrition sources include meat, eggs, dairy, soy products, staples, major vegetables, and fruit. Set role to main and defaultAction to keep.
2. Salt, pepper, soy sauce, vinegar, minced garlic, spices, and water are seasonings. Set role to seasoning and defaultAction to ignore.
3. Oil, sugar, and sesame paste are caloric seasonings. They are still returned, but defaultAction is ignore so the user can actively add them back.
4. Never infer grams from common knowledge, package size, nutrition data, or serving size.
5. Set grams only when the source explicitly gives g, kg, or mg. Convert kg and mg deterministically to grams.
6. For non-weight units such as 个, 盒, 半个, 少许, 适量, cup, tbsp, or piece, keep the original quantity and unit, set grams to null, and set needsGrams to true for a main item.
7. An ignored seasoning without explicit grams may set needsGrams to false because it is not saved by default.
8. Do not create or guess any ingredient ID. The database performs ingredient matching after the user reviews this draft.
9. If servings are not explicitly stated, return null.`;

const seasoningNames = new Set([
  "盐", "海盐", "胡椒", "黑胡椒", "白胡椒", "胡椒粉", "酱油", "生抽", "老抽",
  "醋", "陈醋", "米醋", "蒜", "大蒜", "蒜末", "香料", "水", "清水",
  "油", "食用油", "橄榄油", "糖", "白糖", "红糖", "芝麻酱",
  "salt", "sea salt", "pepper", "black pepper", "white pepper", "soy sauce", "vinegar",
  "garlic", "minced garlic", "spice", "spices", "water", "oil", "cooking oil", "olive oil",
  "sugar", "brown sugar", "sesame paste", "tahini",
]);

const normalizeUnit = (value: string | null) => {
  const unit = value?.trim().toLowerCase() ?? "";
  if (unit === "g" || unit === "gram" || unit === "grams" || unit === "克") return "g";
  if (unit === "kg" || unit === "kilogram" || unit === "kilograms" || unit === "公斤" || unit === "千克") return "kg";
  if (unit === "mg" || unit === "milligram" || unit === "milligrams" || unit === "毫克") return "mg";
  return value?.trim() || null;
};

const deterministicGrams = (quantity: number | null, unit: string | null) => {
  if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) return null;
  if (unit === "g") return quantity;
  if (unit === "kg") return quantity * 1000;
  if (unit === "mg") return quantity / 1000;
  return null;
};

const normalizeDraft = (value: unknown): ParsedRecipe | null => {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<ParsedRecipe>;
  if (typeof draft.recipeName !== "string" || !Array.isArray(draft.items) || draft.items.length === 0 || draft.items.length > 100) {
    return null;
  }

  const items: ParsedItem[] = [];
  for (const candidate of draft.items) {
    if (!candidate || typeof candidate !== "object") return null;
    const item = candidate as Partial<ParsedItem>;
    const rawText = typeof item.rawText === "string" ? item.rawText.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!rawText || !name) return null;

    const quantity = typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
      ? item.quantity
      : null;
    const unit = normalizeUnit(typeof item.unit === "string" ? item.unit : null);
    const grams = deterministicGrams(quantity, unit);
    const knownSeasoning = seasoningNames.has(name.toLowerCase());
    const role: "main" | "seasoning" = knownSeasoning || item.role === "seasoning" ? "seasoning" : "main";
    const defaultAction: "keep" | "ignore" = role === "seasoning" ? "ignore" : "keep";
    const needsGrams = role === "main" && grams === null;

    items.push({ rawText, name, quantity, unit, grams, role, needsGrams, defaultAction });
  }

  const servings = typeof draft.servings === "number" && Number.isFinite(draft.servings) && draft.servings > 0
    ? draft.servings
    : null;
  return { recipeName: draft.recipeName.trim(), servings, items };
};

const outputText = (response: OpenAIResponse) => {
  for (const output of response.output ?? []) {
    if (output.type !== "message") continue;
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return null;
};

const privacyIdentifier = async (userId: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) return json({ error: "AUTH_REQUIRED" }, 401);

  let recipeText = "";
  try {
    const body = await request.json();
    recipeText = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return json({ error: "RECIPE_PARSE_INPUT_INVALID" }, 400);
  }
  if (!recipeText) return json({ error: "RECIPE_PARSE_INPUT_INVALID" }, 400);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return json({ error: "AUTH_REQUIRED" }, 401);

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("RECIPE_PARSE_MODEL")?.trim() || DEFAULT_MODEL;
  if (!apiKey) return json({ error: "RECIPE_PARSE_NOT_CONFIGURED" }, 503);

  const { data: quota, error: quotaError } = await userClient.rpc("claim_recipe_parse_call", {
    p_input_chars: Array.from(recipeText).length,
    p_provider: PROVIDER,
    p_model: model,
  });
  if (quotaError) {
    const code = quotaError.message === "RATE_LIMITED" ? "RATE_LIMITED" : "RECIPE_PARSE_INPUT_INVALID";
    return json({ error: code, details: quotaError.details || null }, code === "RATE_LIMITED" ? 429 : 400);
  }

  const parseCallId = typeof quota?.parseCallId === "string" ? quota.parseCallId : "";
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const finish = async (status: "succeeded" | "failed", errorCode: string | null, usage?: OpenAIResponse["usage"]) => {
    if (!parseCallId) return;
    await service.rpc("complete_recipe_parse_call", {
      p_parse_call_id: parseCallId,
      p_status: status,
      p_error_code: errorCode,
      p_input_tokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : null,
      p_output_tokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : null,
    });
  };

  let providerResponse: Response;
  try {
    providerResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "minimal" },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        safety_identifier: await privacyIdentifier(userData.user.id),
        instructions,
        input: recipeText,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "recipe_parse_draft",
            strict: true,
            schema,
          },
        },
      }),
    });
  } catch {
    await finish("failed", "RECIPE_PARSE_UNAVAILABLE");
    return json({ error: "RECIPE_PARSE_UNAVAILABLE" }, 502);
  }

  if (!providerResponse.ok) {
    await finish("failed", "RECIPE_PARSE_UNAVAILABLE");
    return json({ error: "RECIPE_PARSE_UNAVAILABLE" }, 502);
  }

  let providerBody: OpenAIResponse;
  try {
    providerBody = await providerResponse.json() as OpenAIResponse;
  } catch {
    await finish("failed", "RECIPE_PARSE_RESPONSE_INVALID");
    return json({ error: "RECIPE_PARSE_RESPONSE_INVALID" }, 502);
  }

  const text = outputText(providerBody);
  let draft: ParsedRecipe | null = null;
  try {
    draft = text ? normalizeDraft(JSON.parse(text)) : null;
  } catch {
    draft = null;
  }
  if (!draft) {
    await finish("failed", "RECIPE_PARSE_RESPONSE_INVALID", providerBody.usage);
    return json({ error: "RECIPE_PARSE_RESPONSE_INVALID" }, 502);
  }

  await finish("succeeded", null, providerBody.usage);
  return json({ ...draft, provider: PROVIDER, model, quota });
});
