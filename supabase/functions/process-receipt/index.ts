import { createClient } from "jsr:@supabase/supabase-js@2";

type RecognitionItem = { name?: unknown; line?: unknown; quantity?: unknown; unit?: unknown; price?: unknown };
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
    return [{
      name,
      line: typeof item.content === "string" ? item.content : name,
      quantity: fieldNumber(value.Quantity),
      unit: fieldText(value.Unit) || null,
      price: fieldNumber(value.TotalPrice) ?? fieldNumber(value.Price) ?? fieldNumber(value.UnitPrice),
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
  const { data, error } = await service.rpc("apply_receipt_recognition", {
    p_receipt_import_id: receiptImportId,
    p_raw_text: typeof recognized.rawText === "string" ? recognized.rawText : null,
    p_items: items,
    p_provider: "azure_document_intelligence",
  });
  if (error) return await fail(service, receiptImportId, "OCR_RESPONSE_INVALID", 502);
  return json(data as Record<string, unknown>);
});
