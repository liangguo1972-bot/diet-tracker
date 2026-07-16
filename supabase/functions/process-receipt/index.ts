import { createClient } from "jsr:@supabase/supabase-js@2";

type RecognitionItem = { name?: unknown; line?: unknown; quantity?: unknown; unit?: unknown; price?: unknown };
type IngredientCandidate = {
  id: string;
  candidateKey: string;
  name: string;
  category: string | null;
  packageSpec: string | null;
};
type MatchSuggestion = {
  position: number;
  normalizedName: string;
  suggestedCandidateKey: string | null;
  suggestedIngredientName: string | null;
  confidence: "high" | "medium" | "low" | "none";
  reason: string;
  specificationSensitive: boolean;
};
type OpenAIResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};
type AzureField = {
  content?: unknown;
  valueString?: unknown;
  valueNumber?: unknown;
  valueCurrency?: { amount?: unknown };
  valueArray?: AzureField[];
  valueObject?: Record<string, AzureField>;
};
type AzureAnalyzeOperation = {
  status?: unknown;
  analyzeResult?: {
    content?: unknown;
    documents?: Array<{ fields?: Record<string, AzureField> }>;
  };
};

const AZURE_API_VERSION = "2024-11-30";
const AZURE_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const OCR_POLL_ATTEMPTS = 30;
const OCR_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MATCH_MODEL = "gpt-5-mini";
const MATCH_PROVIDER = "openai";
const MAX_INGREDIENT_CANDIDATES = 200;
const MAX_MATCH_OUTPUT_TOKENS = 2500;

const matchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          position: { type: "integer", minimum: 0 },
          normalizedName: { type: "string" },
          suggestedCandidateKey: { type: ["string", "null"] },
          suggestedIngredientName: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["high", "medium", "low", "none"] },
          reason: { type: "string" },
          specificationSensitive: { type: "boolean" },
        },
        required: [
          "position",
          "normalizedName",
          "suggestedCandidateKey",
          "suggestedIngredientName",
          "confidence",
          "reason",
          "specificationSensitive",
        ],
      },
    },
  },
  required: ["suggestions"],
};

const matchInstructions = `You suggest mappings from grocery receipt product names to a user's existing ingredient catalog.

Return exactly one suggestion for every receipt item position. Use only candidateKey values supplied in the catalog. Never invent an ingredient ID or candidate key.

Rules:
1. Translate and normalize abbreviations when useful. For example, branded or abbreviated banana product names can suggest the existing ingredient 香蕉.
2. A suggestion is review-only. Do not describe it as confirmed.
3. Product specifications matter for nutrition. Yogurt and milk variants such as plain, unsweetened, Greek, low-fat, skim, whole, fortified, or high-calcium are specification-sensitive. Set specificationSensitive to true. If the catalog does not contain a sufficiently specific ingredient, use null or low confidence instead of mapping to a generic nutrition item.
4. Preserve meaningful product type, fat level, sugar status, preparation, and fortification details in normalizedName.
5. If there is no useful catalog candidate, suggestedCandidateKey must be null. suggestedIngredientName may contain a concise Chinese search suggestion for manual review.
6. Keep reason short and explain the evidence or uncertainty. Do not infer quantity, unit, nutrition, or inventory data.`;

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

const fail = async (service: ReturnType<typeof createClient>, receiptImportId: string, code: string, status: number) => {
  await service.rpc("mark_receipt_import_failed", {
    p_receipt_import_id: receiptImportId,
    p_error_code: code,
    p_error_message: null,
  });
  return json({ error: code }, status);
};

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

const confidenceNumber = (confidence: MatchSuggestion["confidence"]) => {
  if (confidence === "high") return 0.85;
  if (confidence === "medium") return 0.65;
  if (confidence === "low") return 0.4;
  return null;
};

const normalizeSuggestions = (value: unknown, itemCount: number): MatchSuggestion[] | null => {
  if (!value || typeof value !== "object") return null;
  const suggestions = (value as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions) || suggestions.length !== itemCount) return null;
  const positions = new Set<number>();
  const normalized: MatchSuggestion[] = [];
  for (const value of suggestions) {
    if (!value || typeof value !== "object") return null;
    const item = value as Partial<MatchSuggestion>;
    if (!Number.isInteger(item.position) || (item.position as number) < 0 || (item.position as number) >= itemCount
      || positions.has(item.position as number)
      || typeof item.normalizedName !== "string"
      || (item.suggestedCandidateKey !== null && typeof item.suggestedCandidateKey !== "string")
      || (item.suggestedIngredientName !== null && typeof item.suggestedIngredientName !== "string")
      || !["high", "medium", "low", "none"].includes(item.confidence ?? "")
      || typeof item.reason !== "string"
      || typeof item.specificationSensitive !== "boolean") return null;
    positions.add(item.position as number);
    normalized.push(item as MatchSuggestion);
  }
  return normalized.sort((left, right) => left.position - right.position);
};

const enrichWithAiSuggestions = async (
  userClient: ReturnType<typeof createClient>,
  service: ReturnType<typeof createClient>,
  userId: string,
  receiptImportId: string,
  items: Array<Record<string, unknown>>,
) => {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return { items, status: "not_configured", provider: null as string | null };

  const { data: ingredientRows, error: ingredientError } = await userClient.from("ingredients")
    .select("id,name,category,package_spec")
    .order("name")
    .limit(MAX_INGREDIENT_CANDIDATES);
  if (ingredientError) return { items, status: "unavailable", provider: MATCH_PROVIDER };
  if (!ingredientRows?.length) return { items, status: "not_requested", provider: null as string | null };

  const candidates: IngredientCandidate[] = ingredientRows.map((ingredient, index) => ({
    id: ingredient.id,
    candidateKey: `c${index}`,
    name: ingredient.name,
    category: ingredient.category,
    packageSpec: ingredient.package_spec,
  }));
  const model = Deno.env.get("RECEIPT_MATCH_MODEL")?.trim() || DEFAULT_MATCH_MODEL;
  const providerInput = {
    receiptItems: items.map((item, position) => ({ position, rawName: item.name })),
    ingredientCatalog: candidates.map(({ candidateKey, name, category, packageSpec }) => ({
      candidateKey,
      name,
      category,
      packageSpec,
    })),
  };
  const inputHash = await sha256(JSON.stringify(providerInput));
  const { data: claim, error: claimError } = await userClient.rpc("claim_receipt_ai_match_call", {
    p_receipt_import_id: receiptImportId,
    p_input_hash: inputHash,
    p_item_count: items.length,
    p_provider: MATCH_PROVIDER,
    p_model: model,
  });
  if (claimError) {
    return {
      items,
      status: claimError.message === "RATE_LIMITED" ? "rate_limited" : "unavailable",
      provider: MATCH_PROVIDER,
    };
  }

  const claimData = claim && typeof claim === "object" ? claim as Record<string, unknown> : {};
  const matchCallId = typeof claimData.matchCallId === "string" ? claimData.matchCallId : "";
  const finish = async (
    status: "succeeded" | "failed",
    response: MatchSuggestion[] | null,
    errorCode: string | null,
    usage?: OpenAIResponse["usage"],
  ) => {
    if (!matchCallId) return;
    await service.rpc("complete_receipt_ai_match_call", {
      p_match_call_id: matchCallId,
      p_status: status,
      p_response: response,
      p_error_code: errorCode,
      p_input_tokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : null,
      p_output_tokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : null,
    });
  };

  let suggestions: MatchSuggestion[] | null = null;
  if (claimData.mode === "cached") {
    suggestions = normalizeSuggestions({ suggestions: claimData.response }, items.length);
  } else if (claimData.mode === "busy") {
    return { items, status: "unavailable", provider: MATCH_PROVIDER };
  } else if (claimData.mode === "call") {
    let providerResponse: Response;
    try {
      providerResponse = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          store: false,
          reasoning: { effort: "minimal" },
          max_output_tokens: MAX_MATCH_OUTPUT_TOKENS,
          safety_identifier: await sha256(userId),
          instructions: matchInstructions,
          input: JSON.stringify(providerInput),
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "receipt_ingredient_suggestions",
              strict: true,
              schema: matchSchema,
            },
          },
        }),
      });
    } catch {
      await finish("failed", null, "RECEIPT_MATCH_UNAVAILABLE");
      return { items, status: "unavailable", provider: MATCH_PROVIDER };
    }
    if (!providerResponse.ok) {
      await finish("failed", null, "RECEIPT_MATCH_UNAVAILABLE");
      return { items, status: "unavailable", provider: MATCH_PROVIDER };
    }
    let providerBody: OpenAIResponse;
    try {
      providerBody = await providerResponse.json() as OpenAIResponse;
    } catch {
      await finish("failed", null, "RECEIPT_MATCH_RESPONSE_INVALID");
      return { items, status: "unavailable", provider: MATCH_PROVIDER };
    }
    try {
      const text = outputText(providerBody);
      suggestions = text ? normalizeSuggestions(JSON.parse(text), items.length) : null;
    } catch {
      suggestions = null;
    }
    if (!suggestions) {
      await finish("failed", null, "RECEIPT_MATCH_RESPONSE_INVALID", providerBody.usage);
      return { items, status: "unavailable", provider: MATCH_PROVIDER };
    }
    await finish("succeeded", suggestions, null, providerBody.usage);
  }

  if (!suggestions) return { items, status: "unavailable", provider: MATCH_PROVIDER };
  const candidatesByKey = new Map(candidates.map((candidate) => [candidate.candidateKey, candidate]));
  const enriched = items.map((item, position) => {
    const suggestion = suggestions?.find((entry) => entry.position === position);
    if (!suggestion) return item;
    const candidate = suggestion.suggestedCandidateKey
      ? candidatesByKey.get(suggestion.suggestedCandidateKey)
      : undefined;
    return {
      ...item,
      suggestedIngredientId: candidate?.id ?? null,
      suggestedName: candidate?.name ?? suggestion.suggestedIngredientName ?? suggestion.normalizedName,
      suggestionConfidence: confidenceNumber(suggestion.confidence),
      suggestionReason: suggestion.specificationSensitive
        ? `规格敏感，需确认。${suggestion.reason}`.slice(0, 300)
        : suggestion.reason.slice(0, 300),
      suggestionSource: MATCH_PROVIDER,
    };
  });
  return { items: enriched, status: "applied", provider: MATCH_PROVIDER };
};

const fieldText = (field?: AzureField) => {
  if (typeof field?.valueString === "string") return field.valueString.trim();
  if (typeof field?.content === "string") return field.content.trim();
  return "";
};

const fieldNumber = (field?: AzureField) => {
  if (typeof field?.valueNumber === "number" && Number.isFinite(field.valueNumber)) return field.valueNumber;
  const amount = field?.valueCurrency?.amount;
  if (typeof amount === "number" && Number.isFinite(amount)) return amount;
  if (typeof field?.content !== "string") return null;
  const parsed = Number(field.content.replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const mapAzureReceipt = (operation: AzureAnalyzeOperation) => {
  const fields = operation.analyzeResult?.documents?.[0]?.fields;
  const itemFields = Array.isArray(fields?.Items?.valueArray) ? fields.Items.valueArray : [];
  const items = itemFields.flatMap((item) => {
    const value = item.valueObject;
    if (!value) return [];
    const name = fieldText(value.Description) || fieldText(value.Name);
    if (!name) return [];
    const unit = fieldText(value.Unit) || null;
    const providerQuantity = fieldNumber(value.Quantity);
    const price = fieldNumber(value.TotalPrice) ?? fieldNumber(value.Price) ?? fieldNumber(value.UnitPrice);
    const quantityMatchesPrice = providerQuantity !== null && price !== null
      && Math.abs(providerQuantity - price) <= 0.000001;
    const quantity = providerQuantity !== null && providerQuantity > 0 && unit && !quantityMatchesPrice
      ? providerQuantity
      : null;
    return [{
      name,
      line: typeof item.content === "string" ? item.content : name,
      quantity,
      unit,
      price,
    }];
  });
  return {
    rawText: typeof operation.analyzeResult?.content === "string" ? operation.analyzeResult.content : null,
    items,
  };
};

const analyzeWithAzure = async (endpoint: string, apiKey: string, source: Uint8Array) => {
  const baseUrl = endpoint.replace(/\/+$/, "");
  const analyzeUrl = `${baseUrl}/documentintelligence/documentModels/prebuilt-receipt:analyze` +
    `?_overload=analyzeDocument&api-version=${AZURE_API_VERSION}`;
  const analyzeResponse = await fetch(analyzeUrl, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ base64Source: toBase64(source) }),
  });
  if (analyzeResponse.status !== 202) throw new Error(`AZURE_ANALYZE_${analyzeResponse.status}`);
  const operationLocation = analyzeResponse.headers.get("Operation-Location");
  if (!operationLocation) throw new Error("AZURE_OPERATION_LOCATION_MISSING");

  for (let attempt = 0; attempt < OCR_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const resultResponse = await fetch(operationLocation, {
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
    });
    if (!resultResponse.ok) throw new Error(`AZURE_RESULT_${resultResponse.status}`);
    const operation = await resultResponse.json() as AzureAnalyzeOperation;
    if (operation.status === "succeeded") return mapAzureReceipt(operation);
    if (operation.status === "failed") throw new Error("AZURE_ANALYZE_FAILED");
  }
  throw new Error("AZURE_ANALYZE_TIMEOUT");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) return json({ error: "AUTH_REQUIRED" }, 401);

  let receiptImportId: string;
  let inlineImageBase64: string | null = null;
  let inlineImageContentType: string | null = null;
  try {
    const body = await request.json();
    receiptImportId = typeof body.receiptImportId === "string" ? body.receiptImportId : "";
    inlineImageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : null;
    inlineImageContentType = typeof body.imageContentType === "string" ? body.imageContentType : null;
  } catch {
    return json({ error: "RECEIPT_RECOGNITION_INVALID" }, 400);
  }
  if (!receiptImportId) return json({ error: "RECEIPT_RECOGNITION_INVALID" }, 400);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return json({ error: "AUTH_REQUIRED" }, 401);
  const { data: receipt, error: receiptError } = await userClient.rpc("get_receipt_import", {
    p_receipt_import_id: receiptImportId,
  });
  if (receiptError || !receipt || typeof receipt !== "object") return json({ error: "INVALID_REFERENCE" }, 404);
  const importData = receipt as { status?: string; storagePath?: string; contentType?: string };
  if (importData.status !== "uploaded" && importData.status !== "failed") return json({ error: "STATUS_CONFLICT" }, 409);
  if (!importData.storagePath || !importData.contentType) return json({ error: "INVALID_REFERENCE" }, 404);

  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await service.from("receipt_imports")
    .update({ status: "processing", error_code: null, error_message: null, updated_at: new Date().toISOString() })
    .eq("id", receiptImportId)
    .eq("user_id", userData.user.id);

  const ocrUrl = Deno.env.get("RECEIPT_OCR_URL");
  const ocrApiKey = Deno.env.get("RECEIPT_OCR_API_KEY");
  if (!ocrUrl || !ocrApiKey) return await fail(service, receiptImportId, "OCR_NOT_CONFIGURED", 503);

  let sourceBytes: Uint8Array;
  if (inlineImageBase64) {
    if (!inlineImageContentType || !OCR_CONTENT_TYPES.has(inlineImageContentType)) {
      return await fail(service, receiptImportId, "RECEIPT_RECOGNITION_INVALID", 400);
    }
    const { data: exists, error: existsError } = await service.storage.from("receipt-source").exists(importData.storagePath);
    if (existsError || !exists) return await fail(service, receiptImportId, "RECEIPT_FILE_UNAVAILABLE", 422);
    try {
      sourceBytes = fromBase64(inlineImageBase64);
    } catch {
      return await fail(service, receiptImportId, "RECEIPT_RECOGNITION_INVALID", 400);
    }
  } else {
    const { data: image, error: downloadError } = await service.storage.from("receipt-source").download(importData.storagePath);
    if (downloadError || !image) return await fail(service, receiptImportId, "RECEIPT_FILE_UNAVAILABLE", 422);
    sourceBytes = new Uint8Array(await image.arrayBuffer());
  }
  if (sourceBytes.length === 0 || sourceBytes.length > AZURE_MAX_SOURCE_BYTES) {
    return await fail(service, receiptImportId, "OCR_UNAVAILABLE", 502);
  }

  let recognized: { rawText: string | null; items: RecognitionItem[] };
  try {
    recognized = await analyzeWithAzure(ocrUrl, ocrApiKey, sourceBytes);
  } catch (error) {
    console.error("receipt OCR provider failed", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return await fail(service, receiptImportId, "OCR_UNAVAILABLE", 502);
  }
  if (!Array.isArray(recognized.items) || recognized.items.length === 0) {
    return await fail(service, receiptImportId, "OCR_RESPONSE_INVALID", 502);
  }
  const items = (recognized.items as RecognitionItem[]).map((item) => ({
    name: typeof item.name === "string" ? item.name : "",
    line: typeof item.line === "string" ? item.line : null,
    quantity: typeof item.quantity === "number" || typeof item.quantity === "string" ? item.quantity : null,
    unit: typeof item.unit === "string" ? item.unit : null,
    price: typeof item.price === "number" || typeof item.price === "string" ? item.price : null,
  }));
  const enrichment = await enrichWithAiSuggestions(
    userClient,
    service,
    userData.user.id,
    receiptImportId,
    items,
  );
  const { data, error } = await service.rpc("apply_receipt_recognition", {
    p_receipt_import_id: receiptImportId,
    p_raw_text: typeof recognized.rawText === "string" ? recognized.rawText : null,
    p_items: enrichment.items,
    p_provider: "azure_document_intelligence",
  });
  if (error) return await fail(service, receiptImportId, "OCR_RESPONSE_INVALID", 502);
  const { error: suggestionStatusError } = await service.from("receipt_imports")
    .update({
      suggestion_status: enrichment.status,
      suggestion_provider: enrichment.provider,
      updated_at: new Date().toISOString(),
    })
    .eq("id", receiptImportId)
    .eq("user_id", userData.user.id);
  if (suggestionStatusError) console.error("receipt suggestion status update failed");
  return json({ ...(data as Record<string, unknown>), suggestionStatus: enrichment.status });
});
