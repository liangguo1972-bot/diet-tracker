import { createClient } from "jsr:@supabase/supabase-js@2";

type RecognitionItem = { name?: unknown; line?: unknown; quantity?: unknown; unit?: unknown; price?: unknown };

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const fail = async (service: ReturnType<typeof createClient>, receiptImportId: string, code: string, status: number) => {
  await service.rpc("mark_receipt_import_failed", {
    p_receipt_import_id: receiptImportId,
    p_error_code: code,
    p_error_message: null,
  });
  return json({ error: code }, status);
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) return json({ error: "AUTH_REQUIRED" }, 401);

  let receiptImportId: string;
  try {
    const body = await request.json();
    receiptImportId = typeof body.receiptImportId === "string" ? body.receiptImportId : "";
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
  const { data: image, error: downloadError } = await service.storage.from("receipt-source").download(importData.storagePath);
  if (downloadError || !image) return await fail(service, receiptImportId, "RECEIPT_FILE_UNAVAILABLE", 422);

  let providerResponse: Response;
  try {
    const bytes = new Uint8Array(await image.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const imageBase64 = btoa(binary);
    providerResponse = await fetch(ocrUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${ocrApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64, contentType: importData.contentType }),
    });
  } catch {
    return await fail(service, receiptImportId, "OCR_UNAVAILABLE", 502);
  }
  if (!providerResponse.ok) return await fail(service, receiptImportId, "OCR_UNAVAILABLE", 502);

  let recognized: { rawText?: unknown; items?: unknown };
  try {
    recognized = await providerResponse.json();
  } catch {
    return await fail(service, receiptImportId, "OCR_RESPONSE_INVALID", 502);
  }
  if (!Array.isArray(recognized.items)) return await fail(service, receiptImportId, "OCR_RESPONSE_INVALID", 502);
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
    p_provider: "configured_ocr",
  });
  if (error) return await fail(service, receiptImportId, "OCR_RESPONSE_INVALID", 502);
  return json(data as Record<string, unknown>);
});
