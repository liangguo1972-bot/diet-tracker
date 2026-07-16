import type { Json } from '../lib/database.types'
import { supabase, supabaseConfigError } from '../lib/supabase'
import type { ConfirmReceiptResult, ReceiptAction, ReceiptImport, ReceiptImportCreated, ReceiptImportStatus, ReceiptImportSummary, ReceiptIngredientOption, ReceiptItem, ReceiptItemInput, ReceiptMatchStatus } from '../receipt-types'
import { toDataError, toOperationError } from './errors'

type JsonRecord = Record<string, Json | undefined>
type ReceiptOcrImage = { imageBase64: string; imageContentType: string }

const ocrTargetBytes = 3_500_000
const ocrMaxDimension = 2400

const record = (value: Json | undefined, label: string): JsonRecord => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${label}格式无效。`)
  return value
}
const list = (value: Json | undefined): Json[] => Array.isArray(value) ? value : []
const text = (value: Json | undefined): string => typeof value === 'string' ? value : ''
const optionalText = (value: Json | undefined): string | null => typeof value === 'string' && value ? value : null
const numeric = (value: Json | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const statuses: ReceiptImportStatus[] = ['uploaded', 'processing', 'ready_for_review', 'failed', 'confirmed', 'cancelled']
const matches: ReceiptMatchStatus[] = ['matched', 'possible_match', 'unmatched', 'ignored']
const actions: ReceiptAction[] = ['add_to_inventory', 'ignore']
const member = <T extends string>(value: Json | undefined, values: T[], fallback: T): T => values.includes(text(value) as T) ? text(value) as T : fallback

export function parseReceiptCreated(value: Json): ReceiptImportCreated {
  const data = record(value, '小票任务')
  return {
    receiptImportId: text(data.receiptImportId),
    storagePath: text(data.storagePath),
    status: member(data.status, statuses, 'uploaded'),
    reused: data.reused === true,
  }
}

const parseReceiptItem = (value: Json): ReceiptItem => {
  const item = record(value, '小票商品')
  return {
    receiptItemId: text(item.receiptItemId),
    position: numeric(item.position) ?? 0,
    rawName: text(item.rawName),
    rawQuantity: numeric(item.rawQuantity),
    rawUnit: optionalText(item.rawUnit),
    rawPrice: numeric(item.rawPrice),
    ingredientId: optionalText(item.ingredientId),
    ingredientName: optionalText(item.ingredientName),
    matchStatus: member(item.matchStatus, matches, 'unmatched'),
    matchConfidence: numeric(item.matchConfidence),
    confirmedName: text(item.confirmedName) || text(item.rawName),
    confirmedQuantity: numeric(item.confirmedQuantity),
    confirmedUnit: text(item.confirmedUnit) || text(item.rawUnit),
    storage: text(item.storage),
    action: member(item.action, actions, 'add_to_inventory'),
  }
}

export function parseReceiptImport(value: Json): ReceiptImport {
  const data = record(value, '小票详情')
  return {
    receiptImportId: text(data.receiptImportId),
    status: member(data.status, statuses, 'uploaded'),
    fileName: text(data.fileName),
    contentType: text(data.contentType),
    storagePath: text(data.storagePath),
    merchantName: optionalText(data.merchantName),
    purchasedOn: optionalText(data.purchasedOn),
    errorCode: optionalText(data.errorCode),
    items: list(data.items).map(parseReceiptItem),
  }
}

export function parseReceiptImports(value: Json): ReceiptImportSummary[] {
  return list(value).map((entry) => {
    const data = record(entry, '小票导入记录')
    return {
      receiptImportId: text(data.receiptImportId),
      status: member(data.status, statuses, 'uploaded'),
      fileName: text(data.fileName),
      merchantName: optionalText(data.merchantName),
      purchasedOn: optionalText(data.purchasedOn),
      errorCode: optionalText(data.errorCode),
      createdAt: text(data.createdAt),
      confirmedAt: optionalText(data.confirmedAt),
    }
  })
}

export function parseConfirmReceipt(value: Json): ConfirmReceiptResult {
  const data = record(value, '确认入库结果')
  return {
    receiptImportId: text(data.receiptImportId),
    status: 'confirmed',
    inventoryCount: numeric(data.inventoryCount) ?? 0,
    alreadyConfirmed: data.alreadyConfirmed === true,
  }
}

export function parseReceiptIngredients(value: Json): ReceiptIngredientOption[] {
  return list(value).map((entry) => {
    const item = record(entry, '食材搜索结果')
    return {
      ingredientId: text(item.ingredient_id),
      name: text(item.name),
      category: optionalText(item.category),
      packageSpec: optionalText(item.package_spec),
      storageGuidance: optionalText(item.storage_guidance),
      isVerified: item.is_verified === true,
    }
  })
}

function client() {
  if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase 未配置')
  return supabase
}

export async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error ?? new Error('照片读取失败。'))
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : ''
    const separator = result.indexOf(',')
    if (separator < 0) reject(new Error('照片读取失败。'))
    else resolve(result.slice(separator + 1))
  }
  reader.readAsDataURL(blob)
})

async function prepareReceiptOcrImage(source: Blob): Promise<ReceiptOcrImage> {
  if (source.size <= ocrTargetBytes) {
    return { imageBase64: await blobToBase64(source), imageContentType: source.type || 'image/jpeg' }
  }

  const image = await createImageBitmap(source, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, ocrMaxDimension / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('照片处理失败。')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    const qualities = [0.84, 0.72, 0.6]
    let compressed: Blob | null = null
    for (const quality of qualities) {
      compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (compressed && compressed.size <= ocrTargetBytes) break
    }
    if (!compressed || compressed.size > ocrTargetBytes) throw new Error('照片处理失败。')
    return { imageBase64: await blobToBase64(compressed), imageContentType: 'image/jpeg' }
  } finally {
    image.close()
  }
}

export const receiptAdapter = {
  async create(file: File, hash: string): Promise<ReceiptImportCreated> {
    const { data, error } = await client().rpc('create_receipt_import', {
      p_file_name: file.name,
      p_content_type: file.type,
      p_file_size_bytes: file.size,
      p_file_hash: hash,
    })
    if (error) throw toDataError(error)
    return parseReceiptCreated(data)
  },
  async upload(path: string, file: File): Promise<void> {
    const { error } = await client().storage.from('receipt-source').upload(path, file, { contentType: file.type, upsert: false })
    if (error && !/already exists|duplicate/i.test(error.message)) throw toOperationError(error)
  },
  async get(receiptImportId: string): Promise<ReceiptImport> {
    const { data, error } = await client().rpc('get_receipt_import', { p_receipt_import_id: receiptImportId })
    if (error) throw toDataError(error)
    return parseReceiptImport(data)
  },
  async list(limit = 5): Promise<ReceiptImportSummary[]> {
    const { data, error } = await client().rpc('list_receipt_imports', { p_limit: limit })
    if (error) throw toDataError(error)
    return parseReceiptImports(data)
  },
  async searchIngredients(query: string): Promise<ReceiptIngredientOption[]> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []
    const { data, error } = await client().rpc('search_receipt_ingredients', { p_query: normalizedQuery })
    if (error) throw toDataError(error)
    return parseReceiptIngredients(data)
  },
  async process(receiptImportId: string, selectedFile?: File): Promise<ReceiptImport> {
    const current = await this.get(receiptImportId)
    let source: Blob = selectedFile ?? new Blob()
    if (!selectedFile) {
      const { data, error } = await client().storage.from('receipt-source').download(current.storagePath)
      if (error || !data) throw toOperationError(error ?? new Error('照片暂时无法读取。'))
      source = data
    }
    const ocrImage = await prepareReceiptOcrImage(source)
    const response = await client().functions.invoke('process-receipt', {
      body: { receiptImportId, ...ocrImage },
    })
    const draft = await this.get(receiptImportId)
    if (response.error && draft.status !== 'failed') throw toOperationError(response.error)
    return draft
  },
  async update(receiptImportId: string, items: ReceiptItemInput[]): Promise<ReceiptImport> {
    const { data, error } = await client().rpc('update_receipt_items', {
      p_receipt_import_id: receiptImportId,
      p_items: items as unknown as Json,
    })
    if (error) throw toDataError(error)
    return parseReceiptImport(data)
  },
  async confirm(receiptImportId: string, idempotencyKey: string): Promise<ConfirmReceiptResult> {
    try {
      const { data, error } = await client().rpc('confirm_receipt_import', {
        p_receipt_import_id: receiptImportId,
        p_idempotency_key: idempotencyKey,
      })
      if (error) throw toOperationError(error)
      return parseConfirmReceipt(data)
    } catch (reason) {
      throw toOperationError(reason)
    }
  },
}
