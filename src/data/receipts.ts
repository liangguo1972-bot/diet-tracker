import type { Json } from '../lib/database.types'
import { supabase, supabaseConfigError } from '../lib/supabase'
import type { ConfirmReceiptResult, ReceiptAction, ReceiptImport, ReceiptImportCreated, ReceiptImportStatus, ReceiptImportSummary, ReceiptItem, ReceiptItemInput, ReceiptMatchStatus } from '../receipt-types'
import { toDataError, toOperationError } from './errors'

type JsonRecord = Record<string, Json | undefined>

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

function client() {
  if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase 未配置')
  return supabase
}

export async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
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
  async process(receiptImportId: string): Promise<ReceiptImport> {
    const response = await client().functions.invoke('process-receipt', { body: { receiptImportId } })
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
