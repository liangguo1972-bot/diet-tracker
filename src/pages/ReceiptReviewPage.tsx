import { useCallback, useEffect, useRef, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { ErrorState, LoadingState } from '../components/Status'
import { Fr002Error, isAuthenticationRequired, isFr002Error } from '../data/errors'
import { parseConfirmReceipt, receiptAdapter } from '../data/receipts'
import { fr002Adapter } from '../data/fr002'
import type { ReceiptImport, ReceiptIngredientOption, ReceiptItem, ReceiptMatchStatus } from '../receipt-types'
import { amount, newIdempotencyKey } from '../lib/fr002'

const labels: Record<ReceiptMatchStatus, string> = {
  matched: '已匹配',
  possible_match: '建议匹配',
  unmatched: '未匹配',
  ignored: '已忽略',
}

const storageOptions = ['常温', '冷藏', '冷冻'] as const
const itemStatus = (item: ReceiptItem): ReceiptMatchStatus => item.action === 'ignore' ? 'ignored' : item.matchStatus
const validItem = (item: ReceiptItem) => item.action === 'ignore' || Boolean(item.confirmedName.trim() && storageOptions.includes(item.storage as typeof storageOptions[number]))
const quantityReviewText = (receipt: ReceiptImport, items: ReceiptItem[]) => {
  const evidence = receipt.quantityReviewEvidence
  const reviewCount = items.filter((item) => item.action !== 'ignore' && item.quantityNeedsConfirmation).length
  const checks: string[] = []
  if (evidence.netSalesVerified === false) checks.push('金额合计未通过')
  if (evidence.soldItemsVerified === false) checks.push('商品件数未通过')
  if (evidence.netSalesVerified === true && evidence.soldItemsVerified === true) checks.push('合计与商品件数已核对')
  if (reviewCount > 0) checks.push(`还有 ${reviewCount} 项数量需要确认`)
  return checks.join('，') || '部分商品数量需要确认'
}
const receiptDateLabel = (date: string | null) => {
  const match = date && /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return match ? `${Number(match[2])}月${Number(match[3])}日` : '日期未知'
}

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
  const [matchingItemId, setMatchingItemId] = useState<string | null>(null)
  const [matchQuery, setMatchQuery] = useState('')
  const [matchOptions, setMatchOptions] = useState<ReceiptIngredientOption[]>([])
  const [matchLoading, setMatchLoading] = useState(false)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [matchSearched, setMatchSearched] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
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
    setFieldErrors((current) => { const next = { ...current }; delete next[id]; return next })
  }

  function useSuggestion(item: ReceiptItem) {
    const suggestion = suggestionRef.current.get(item.receiptItemId)
    if (!suggestion) return
    edit(item.receiptItemId, { ingredientId: suggestion.ingredientId, ingredientName: suggestion.ingredientName, matchStatus: 'matched', action: 'add_to_inventory' })
    closeIngredientSearch()
  }

  function changeQuantity(item: ReceiptItem, difference: number) {
    const current = item.confirmedQuantity ?? 0
    edit(item.receiptItemId, { confirmedQuantity: Math.max(0.01, Math.round((current + difference) * 100) / 100), quantityNeedsConfirmation: false })
  }

  function closeIngredientSearch() {
    setMatchingItemId(null)
    setMatchQuery('')
    setMatchOptions([])
    setMatchLoading(false)
    setMatchError(null)
    setMatchSearched(false)
  }

  function openIngredientSearch(item: ReceiptItem) {
    setMatchingItemId(item.receiptItemId)
    setMatchQuery(item.ingredientName || item.confirmedName || item.rawName)
    setMatchOptions([])
    setMatchLoading(false)
    setMatchError(null)
    setMatchSearched(false)
  }

  async function searchIngredients() {
    if (!matchingItemId || matchLoading) return
    const query = matchQuery.trim()
    if (!query) {
      setMatchOptions([])
      setMatchSearched(false)
      setMatchError('请输入食材名称后搜索。')
      return
    }
    setMatchLoading(true)
    setMatchError(null)
    setMatchSearched(true)
    try { setMatchOptions(await receiptAdapter.searchIngredients(query)) }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setMatchError(reason instanceof Error ? reason.message : '食材搜索失败。')
    } finally { setMatchLoading(false) }
  }

  const addable = items.filter((item) => item.action === 'add_to_inventory')
  const invalidCount = items.filter((item) => !validItem(item)).length
  const canConfirm = receipt?.status === 'ready_for_review' && items.length > 0 && addable.length > 0 && invalidCount === 0
  const counts = {
    review: items.filter((item) => item.action !== 'ignore' && (itemStatus(item) === 'possible_match' || item.quantityNeedsConfirmation || !validItem(item))).length,
    ignored: items.filter((item) => itemStatus(item) === 'ignored').length,
  }
  const readyCount = items.length - counts.review - counts.ignored

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
        ingredientId: item.action === 'ignore' || item.matchStatus !== 'matched' ? null : item.ingredientId,
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
        if (reason instanceof Fr002Error && reason.details?.receiptItemId) setFieldErrors({ [reason.details.receiptItemId]: reason.message })
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
    <main className={`phone page receipt-page${matchingItemId ? ' receipt-searching' : ''}`}>
      <div className="page-content with-action receipt-review-content">
        <header className="topbar receipt-header"><button className="back-button" onClick={leave} disabled={saving} aria-label="返回">←</button><h1>确认小票</h1><span className="receipt-count">{items.length} 项</span></header>
        {loading && <LoadingState rows={7} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {receipt && !loading && !error && receipt.status !== 'ready_for_review' && <ErrorState message={receipt.status === 'failed' ? '这张小票识别失败，请返回上传页查看记录。' : receipt.status === 'confirmed' ? '这张小票已经完成入库。' : '小票还没有进入可确认状态。'} onRetry={load} />}
        {receipt?.status === 'ready_for_review' && !loading && !error && <>
          <section className="receipt-date-card" aria-label="购买日期">
            <span>购买日期</span>
            <strong>{receiptDateLabel(receipt.purchasedOn)}</strong>
            {receipt.quantityReviewStatus !== 'not_applicable' && <p className={receipt.quantityReviewStatus === 'verified' ? 'verified' : ''}>{receipt.quantityReviewStatus === 'verified' ? '整单数量已核对' : quantityReviewText(receipt, items)}</p>}
          </section>
          <section className="receipt-filter-summary">
            <div><span className="active">待确认 {counts.review}</span><span>已就绪 {readyCount}</span><span>已忽略 {counts.ignored}</span></div>
          </section>
          {items.length === 0 && <div className="status-card empty-card"><span className="empty-mark">0</span><b>没有可确认商品</b><p>识别结果为空，不能写入库存。</p></div>}
          <div className="receipt-item-stack">{items.map((item) => {
            const status = itemStatus(item)
            const suggestion = suggestionRef.current.get(item.receiptItemId)
            if (item.action === 'ignore') return <article className="section-card receipt-item receipt-item-collapsed" key={item.receiptItemId}><div className="receipt-item-title"><span className="status-chip">已忽略</span><b>{item.rawName}</b></div><button className="text-button neutral" onClick={() => edit(item.receiptItemId, { action: 'add_to_inventory', matchStatus: suggestion ? 'possible_match' : 'unmatched' })}>恢复此项</button></article>
            return <article className={`section-card receipt-item ${status}`} key={item.receiptItemId}>
              <div className="receipt-item-title"><span className={`status-chip ${status === 'matched' ? 'success' : status === 'possible_match' ? 'warning' : ''}`}>{status === 'unmatched' ? '未匹配 · 可修改名称' : status === 'possible_match' ? '建议匹配 · 需确认' : !validItem(item) && status === 'matched' ? '需确认规格' : labels[status]}</span><button className="text-button neutral receipt-ignore" onClick={() => edit(item.receiptItemId, { action: 'ignore' })}>忽略此项</button></div>
              <div className="receipt-raw-name"><small>小票原文</small><span>{item.rawName}</span></div>
              <input className="receipt-name-input" aria-label="库存名称" value={item.confirmedName} onChange={(event) => edit(item.receiptItemId, { confirmedName: event.target.value })} />
              <div className="receipt-control-row"><span>匹配食材</span><div className="receipt-match-field">{status === 'matched' && item.ingredientName ? `已选择：${item.ingredientName}` : suggestion?.ingredientName ? `建议：${suggestion.ingredientName}` : '选择食材'}</div><div className="receipt-match-actions">{suggestion && status !== 'matched' && <button className="text-button" onClick={() => useSuggestion(item)}>采用建议</button>}<button className="text-button" onClick={() => openIngredientSearch(item)}>{status === 'matched' ? '更换' : '搜索'}</button></div></div>
              {matchingItemId === item.receiptItemId && <div className="ingredient-search-panel"><div className="ingredient-search-heading"><b>为“{item.confirmedName}”匹配食材</b><button className="text-button neutral" onClick={closeIngredientSearch}>收起</button></div><div className="ingredient-search-form"><input aria-label="搜索已有食材" value={matchQuery} onChange={(event) => { setMatchQuery(event.target.value); setMatchOptions([]); setMatchError(null); setMatchSearched(false) }} onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })} onKeyDown={(event) => { if (event.key === 'Enter') void searchIngredients() }} placeholder="输入食材名称，例如香蕉" /><button className="secondary-button" disabled={matchLoading || !matchQuery.trim()} onClick={() => void searchIngredients()}>搜索</button></div>{matchLoading && <small>正在搜索…</small>}{matchError && <small className="field-error">{matchError}</small>}{matchSearched && !matchLoading && !matchError && matchOptions.length === 0 && <small>没有匹配，可保留为库存占位</small>}<div className="ingredient-search-results">{matchOptions.map((option) => <button className="ingredient-search-result" key={option.ingredientId} onClick={() => { edit(item.receiptItemId, { ingredientId: option.ingredientId, ingredientName: option.name, matchStatus: 'matched' }); closeIngredientSearch() }}><span><b>{option.name}</b><small>{[option.category, option.packageSpec].filter(Boolean).join(' · ') || '已有食材'}</small></span><strong>{option.isVerified ? '已验证' : '选择'}</strong></button>)}</div></div>}
              <div className="receipt-control-row"><span className="receipt-quantity-heading">数量{item.quantityNeedsConfirmation && <small>请确认数量</small>}</span><div className="receipt-quantity-stepper"><button disabled={(item.confirmedQuantity ?? 1) <= 0.01} onClick={() => changeQuantity(item, -1)}>−</button><input aria-label="数量" type="number" min="0.01" step="0.01" value={item.confirmedQuantity ?? 1} onChange={(event) => edit(item.receiptItemId, { confirmedQuantity: event.target.value === '' ? null : Number(event.target.value), quantityNeedsConfirmation: false })} /><button onClick={() => changeQuantity(item, 1)}>＋</button></div><span className="receipt-unit-label">{item.confirmedUnit || '件'}</span>{item.quantityNeedsConfirmation && <span className="quantity-estimate-badge">估</span>}{item.quantitySource === 'whole_foods_verified' && !item.quantityNeedsConfirmation && <small className="quantity-verified-label">数量已核对</small>}</div>
              <div className="receipt-control-row"><span>存放</span><div className="storage-segments">{storageOptions.map((option) => <button className={item.storage === option ? 'active' : ''} key={option} onClick={() => edit(item.receiptItemId, { storage: option })}>{option}</button>)}</div></div>
              {fieldErrors[item.receiptItemId] && <small className="field-error">{fieldErrors[item.receiptItemId]}</small>}
              <div className="receipt-actions"><button className={`text-button ${status === 'matched' ? 'neutral' : ''}`} onClick={() => edit(item.receiptItemId, { ingredientId: null, ingredientName: null, matchStatus: 'unmatched' })}>{status === 'matched' ? '改为库存占位' : '保留为库存占位'}</button></div>
            </article>
          })}</div>
          {saveError && <div className="save-error" role="alert"><b>确认入库失败</b><span>{saveError}</span><span>你的全部修改仍保留在当前页面。</span>{networkUnknown && <><button className="secondary-button" disabled={checking} onClick={checkResult}>{checking ? '正在确认…' : '确认服务端结果'}</button><button className="text-button" disabled={saving} onClick={confirm}>使用原操作编号重试</button></>}</div>}
          {idempotencyKey && <p className="operation-note">本次操作编号已保留，重复提交不会重复入库。</p>}
        </>}
      </div>
      <div className="sticky-actions receipt-sticky-actions">{invalidCount > 0 && <small className="save-hint">请检查需要补充的商品信息</small>}<button className="primary-button" disabled={!canConfirm || saving || networkUnknown} onClick={confirm}>{saving ? '正在确认入库…' : `确认入库 · ${amount(addable.length)}项`}</button></div>
      <BottomNav active="厨房" onChange={onTab} />
    </main>
  )
}
