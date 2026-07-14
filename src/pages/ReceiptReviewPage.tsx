import { useCallback, useEffect, useRef, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired, isFr002Error } from '../data/errors'
import { parseConfirmReceipt, receiptAdapter } from '../data/receipts'
import { fr002Adapter } from '../data/fr002'
import type { ReceiptImport, ReceiptItem, ReceiptMatchStatus } from '../receipt-types'
import { newIdempotencyKey } from '../lib/fr002'

const labels: Record<ReceiptMatchStatus, string> = {
  matched: '已匹配',
  possible_match: '需要确认',
  unmatched: '未匹配',
  ignored: '已忽略',
}

const order: ReceiptMatchStatus[] = ['matched', 'possible_match', 'unmatched', 'ignored']

const itemStatus = (item: ReceiptItem): ReceiptMatchStatus => item.action === 'ignore' ? 'ignored' : item.matchStatus
const validItem = (item: ReceiptItem) => item.action === 'ignore' || Boolean(item.confirmedName.trim() && item.confirmedUnit.trim() && item.confirmedQuantity && item.confirmedQuantity > 0)

export function ReceiptReviewPage({ receiptImportId, onBack, onConfirmed, onTab, onSessionExpired }: {
  receiptImportId: string
  onBack: () => void
  onConfirmed: (inventoryCount: number) => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [receipt, setReceipt] = useState<ReceiptImport | null>(null)
  const [items, setItems] = useState<ReceiptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [networkUnknown, setNetworkUnknown] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const suggestionRef = useRef(new Map<string, { ingredientId: string; ingredientName: string | null }>())
  const savingRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await receiptAdapter.get(receiptImportId)
      setReceipt(result)
      setItems(result.items)
      suggestionRef.current = new Map(result.items.filter((item) => item.ingredientId).map((item) => [item.receiptItemId, { ingredientId: item.ingredientId!, ingredientName: item.ingredientName }]))
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '小票确认数据加载失败。')
    } finally { setLoading(false) }
  }, [onSessionExpired, receiptImportId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!dirty) return
    const protectDraft = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', protectDraft)
    return () => window.removeEventListener('beforeunload', protectDraft)
  }, [dirty])

  function edit(id: string, change: Partial<ReceiptItem>) {
    if (networkUnknown) return
    setItems((current) => current.map((item) => item.receiptItemId === id ? { ...item, ...change } : item))
    setDirty(true)
    setIdempotencyKey(null)
    setSaveError(null)
  }

  function useSuggestion(item: ReceiptItem) {
    const suggestion = suggestionRef.current.get(item.receiptItemId)
    if (!suggestion) return
    edit(item.receiptItemId, { ingredientId: suggestion.ingredientId, ingredientName: suggestion.ingredientName, matchStatus: 'matched', action: 'add_to_inventory' })
  }

  const addable = items.filter((item) => item.action === 'add_to_inventory')
  const canConfirm = receipt?.status === 'ready_for_review' && items.length > 0 && addable.length > 0 && items.every(validItem)

  function leave() {
    if (dirty && !window.confirm('当前修改尚未入库，确认离开吗？')) return
    onBack()
  }

  async function confirm() {
    if (!canConfirm || savingRef.current) return
    const key = idempotencyKey ?? newIdempotencyKey()
    setIdempotencyKey(key)
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      await receiptAdapter.update(receiptImportId, items.map((item) => ({
        receiptItemId: item.receiptItemId,
        ingredientId: item.action === 'ignore' ? null : item.ingredientId,
        action: item.action,
        confirmedName: item.confirmedName,
        confirmedQuantity: item.confirmedQuantity,
        confirmedUnit: item.confirmedUnit,
        storage: item.storage,
      })))
      const result = await receiptAdapter.confirm(receiptImportId, key)
      onConfirmed(result.inventoryCount)
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else {
        setSaveError(reason instanceof Error ? reason.message : '确认入库失败，修改内容已保留。')
        setNetworkUnknown(isFr002Error(reason, 'NETWORK_UNKNOWN'))
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function checkResult() {
    if (!idempotencyKey || checking) return
    setChecking(true)
    setSaveError(null)
    try {
      const result = await fr002Adapter.getOperationResult('confirm_receipt_import', idempotencyKey, parseConfirmReceipt)
      if (result) onConfirmed(result.response.inventoryCount)
      else setSaveError('没有查到成功结果。请保留当前页面，并使用原操作编号重试。')
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setSaveError(reason instanceof Error ? reason.message : '操作结果查询失败。')
    } finally { setChecking(false) }
  }

  return (
    <main className="phone page receipt-page">
      <div className="page-content with-action">
        <header className="topbar centered"><button className="back-button" onClick={leave} disabled={saving}>返回</button><h1>确认小票</h1><span /></header>
        {loading && <LoadingState rows={7} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {receipt && !loading && !error && receipt.status !== 'ready_for_review' && <ErrorState message={receipt.status === 'failed' ? '这张小票识别失败，请返回上传页查看记录。' : receipt.status === 'confirmed' ? '这张小票已经完成入库。' : '小票还没有进入可确认状态。'} onRetry={load} />}
        {receipt?.status === 'ready_for_review' && !loading && !error && (
          <>
            <section className="receipt-summary"><span className="eyebrow-label">待确认</span><h2>{receipt.merchantName || receipt.fileName}</h2><p>{items.length} 条识别结果。确认前可以修改名称、数量、量词和存放位置。</p></section>
            {items.length === 0 && <div className="status-card empty-card"><span className="empty-mark">0</span><b>没有可确认商品</b><p>识别结果为空，不能写入库存。</p></div>}
            {order.map((status) => {
              const group = items.filter((item) => itemStatus(item) === status)
              if (group.length === 0) return null
              return <section key={status}><div className="feature-title"><span><b>{labels[status]}</b><small>{group.length} 项</small></span></div><div className="receipt-item-stack">{group.map((item) => {
                const suggestion = suggestionRef.current.get(item.receiptItemId)
                return <article className={`section-card receipt-item ${status}`} key={item.receiptItemId}>
                  <div className="receipt-item-title"><span className={`status-chip ${status === 'matched' ? 'success' : status === 'possible_match' ? 'warning' : ''}`}>{labels[status]}</span><b>{item.rawName}</b></div>
                  {item.action !== 'ignore' && <div className="receipt-fields">
                    <label>库存名称<input value={item.confirmedName} onChange={(event) => edit(item.receiptItemId, { confirmedName: event.target.value })} /></label>
                    <label>数量<input type="number" min="0.01" step="0.01" value={item.confirmedQuantity ?? ''} onChange={(event) => edit(item.receiptItemId, { confirmedQuantity: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                    <label>量词<input value={item.confirmedUnit} onChange={(event) => edit(item.receiptItemId, { confirmedUnit: event.target.value })} placeholder="例如 盒、袋、g" /></label>
                    <label>存放位置<input value={item.storage} onChange={(event) => edit(item.receiptItemId, { storage: event.target.value })} placeholder="例如 冷藏" /></label>
                  </div>}
                  {item.action !== 'ignore' && item.ingredientId && <p className="match-note">关联食材：{item.ingredientName || '已有食材'}</p>}
                  {item.action !== 'ignore' && !item.ingredientId && <p className="match-note warning">将作为库存占位。可用于做饭扣减，但不会进入记餐单品选择器。</p>}
                  {!validItem(item) && <small className="field-error">入库项必须填写名称、大于 0 的数量和量词。</small>}
                  <div className="receipt-actions">
                    {suggestion && item.matchStatus !== 'matched' && <button className="secondary-button" onClick={() => useSuggestion(item)}>匹配“{suggestion.ingredientName || '已有食材'}”</button>}
                    {item.action !== 'ignore' && item.ingredientId && <button className="text-button neutral" onClick={() => edit(item.receiptItemId, { ingredientId: null, ingredientName: null, matchStatus: 'unmatched' })}>改为库存占位</button>}
                    <button className="text-button neutral" onClick={() => edit(item.receiptItemId, item.action === 'ignore' ? { action: 'add_to_inventory', matchStatus: suggestion ? 'possible_match' : 'unmatched' } : { action: 'ignore' })}>{item.action === 'ignore' ? '恢复此项' : '忽略此项'}</button>
                  </div>
                </article>
              })}</div></section>
            })}
            {saveError && <div className="save-error" role="alert"><b>确认入库失败</b><span>{saveError}</span><span>你的全部修改仍保留在当前页面。</span>{networkUnknown && <><button className="secondary-button" disabled={checking} onClick={checkResult}>{checking ? '正在确认…' : '确认服务端结果'}</button><button className="text-button" disabled={saving} onClick={confirm}>使用原操作编号重试</button></>}</div>}
            {idempotencyKey && <p className="operation-note">本次操作编号已保留，重复提交不会重复入库。</p>}
          </>
        )}
      </div>
      <div className="sticky-actions"><button className="primary-button" disabled={!canConfirm || saving || networkUnknown} onClick={confirm}>{saving ? '正在确认入库…' : `确认入库${addable.length ? ` · ${addable.length} 项` : ''}`}</button></div>
      <BottomNav active="厨房" onChange={onTab} />
    </main>
  )
}
