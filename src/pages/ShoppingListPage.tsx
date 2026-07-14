import { useCallback, useEffect, useRef, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired, isFr002Error } from '../data/errors'
import { fr002Adapter, parseShoppingList } from '../data/fr002'
import type { CompletePurchaseItemInput, ShoppingItemDraft, ShoppingListData } from '../fr002-types'
import { amount, createShoppingDraft, localDateKey, newIdempotencyKey } from '../lib/fr002'

const parseOperationShoppingList = (value: Parameters<typeof parseShoppingList>[0]) => {
  const result = parseShoppingList(value)
  if (!result) throw new Error('采购操作结果无效。')
  return result
}

export function ShoppingListPage({ planId, initialList, onBack, onDone, onTab, onSessionExpired }: {
  planId: string
  initialList: ShoppingListData | null
  onBack: () => void
  onDone: () => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [list, setList] = useState<ShoppingListData | null>(initialList)
  const [drafts, setDrafts] = useState<ShoppingItemDraft[]>(initialList ? createShoppingDraft(initialList, localDateKey()) : [])
  const [loading, setLoading] = useState(!initialList)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)
  const [networkUnknown, setNetworkUnknown] = useState(false)
  const savingRef = useRef(false)

  const applyList = useCallback((next: ShoppingListData) => {
    setList(next)
    setDrafts(createShoppingDraft(next, localDateKey()))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fr002Adapter.getShoppingList(planId)
      if (result) applyList(result)
      else setList(null)
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '采购清单加载失败。')
    } finally { setLoading(false) }
  }, [applyList, onSessionExpired, planId])

  useEffect(() => { void load() }, [load])

  function updateDraft(index: number, changes: Partial<ShoppingItemDraft>) {
    if (networkUnknown) return
    setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item))
    setIdempotencyKey(null)
    setError(null)
    setErrorCode(null)
    setNotice(null)
  }

  const pendingPurchases = drafts.filter((item) => item.status === 'pending' && item.toPurchaseGrams > 0)
  const submitItems = pendingPurchases
    .filter((item) => item.quantity !== null && item.quantity > 0 && item.unit.trim())
    .map(({ name: _name, toPurchaseGrams: _grams, status: _status, quantity, ...item }): CompletePurchaseItemInput => ({ ...item, quantity: quantity ?? 0 }))
  const valid = pendingPurchases.length > 0 && submitItems.length === pendingPurchases.length

  async function complete() {
    if (!list || savingRef.current || !valid) return
    const key = idempotencyKey ?? newIdempotencyKey()
    setIdempotencyKey(key)
    savingRef.current = true
    setSaving(true)
    setError(null)
    setErrorCode(null)
    try {
      const result = await fr002Adapter.completePurchase(list.id, submitItems, key)
      applyList(result)
      setIdempotencyKey(null)
      setNetworkUnknown(false)
      setNotice(result.status === 'completed' ? '采购已经完成，真实库存已更新。' : '本次采购已写入库存，清单仍有未完成项目。')
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else {
        setError(reason instanceof Error ? reason.message : '采购完成失败，输入已保留。')
        setErrorCode(isFr002Error(reason) ? reason.code : null)
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
    setError(null)
    try {
      const result = await fr002Adapter.getOperationResult('complete_purchase', idempotencyKey, parseOperationShoppingList)
      if (result) {
        applyList(result.response)
        setIdempotencyKey(null)
        setNetworkUnknown(false)
        setNotice('已确认服务端完成了本次采购。')
      } else setError('没有查到成功结果。请使用原操作编号重试。')
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '操作结果查询失败。')
    } finally { setChecking(false) }
  }

  async function copyList() {
    if (!list) return
    const text = list.items.filter((item) => item.toPurchaseGrams > 0 && item.status === 'pending').map((item) => `${item.name} ${amount(item.toPurchaseGrams)}g`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setNotice('采购清单已复制。')
    } catch { setError('浏览器没有允许复制，请手动选择清单内容。') }
  }

  function resetConflictedOperation() {
    if (!window.confirm('确认放弃原操作编号并重新提交当前采购内容吗？')) return
    setIdempotencyKey(null)
    setError(null)
    setErrorCode(null)
    setNetworkUnknown(false)
  }

  return (
    <main className="phone page grocery-page">
      <div className="page-content with-action">
        <header className="topbar centered"><button className="back-button" onClick={onBack} disabled={saving}>返回</button><h1>采购清单</h1><button className="text-button neutral" onClick={() => void copyList()} disabled={!list || loading}>复制</button></header>
        {notice && <div className="success-banner" role="status">{notice}</div>}
        {loading && <LoadingState rows={7} />}
        {error && !list && <ErrorState message={error} onRetry={load} />}
        {!loading && !list && <EmptyState title="还没有采购清单" detail="确认本周食谱并成功生成后再查看。" />}
        {list && (
          <>
            <section className="shopping-stack">
              {drafts.map((item, index) => (
                <article className={`section-card shopping-card ${item.status === 'completed' ? 'completed' : ''}`} key={item.shoppingListItemId}>
                  <div className="ingredient-heading"><span><b>{item.name}</b><small>{item.toPurchaseGrams > 0 ? `待购 ${amount(item.toPurchaseGrams)}g` : '库存已覆盖，无需采购'}</small></span><span className={`status-chip ${item.status === 'completed' ? 'success' : ''}`}>{item.status === 'completed' ? '已入库' : '待采购'}</span></div>
                  {item.status === 'pending' && item.toPurchaseGrams > 0 && (
                    <div className="purchase-fields">
                      <label>购买数量<input type="number" min="0.01" step="0.01" value={item.quantity ?? ''} disabled={networkUnknown} onChange={(event) => updateDraft(index, { quantity: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                      <label>量词<input value={item.unit} disabled={networkUnknown} onChange={(event) => updateDraft(index, { unit: event.target.value, quantity: null, gramsPerUnit: null })} /></label>
                      <label>存放位置<input value={item.storage} disabled={networkUnknown} onChange={(event) => updateDraft(index, { storage: event.target.value })} /></label>
                      <label>购买日期<input type="date" value={item.purchaseDate} disabled={networkUnknown} onChange={(event) => updateDraft(index, { purchaseDate: event.target.value })} /></label>
                      <label>到期日期<input type="date" value={item.expiresOn ?? ''} disabled={networkUnknown} onChange={(event) => updateDraft(index, { expiresOn: event.target.value || null })} /></label>
                      {item.unit !== 'g' && <label>每单位克重<input type="number" min="0.01" step="0.01" value={item.gramsPerUnit ?? ''} disabled={networkUnknown} placeholder="只有可信来源才填写" onChange={(event) => updateDraft(index, { gramsPerUnit: event.target.value === '' ? null : Number(event.target.value) })} /></label>}
                    </div>
                  )}
                  {item.status === 'completed' && <p className="completed-copy">已入库 {amount(item.quantity ?? 0)} {item.unit}{item.storage ? ` · ${item.storage}` : ''}</p>}
                </article>
              ))}
            </section>
            {pendingPurchases.length === 0 && list.status !== 'completed' && <EmptyState title="库存已经覆盖清单" detail="当前没有需要购买的克重项目。清单无需提交新的库存。" />}
            {list.status === 'completed' && <button className="secondary-button wide" onClick={onDone}>去厨房查看库存</button>}
          </>
        )}
        {error && list && <div className="save-error" role="alert"><b>操作没有完成</b><span>{error}</span>{networkUnknown && <><button className="secondary-button" onClick={() => void checkResult()} disabled={checking}>{checking ? '正在确认…' : '确认服务端结果'}</button><button className="text-button" onClick={() => void complete()} disabled={saving}>使用原操作编号重试</button></>}{(errorCode === 'CONFLICT' || errorCode === 'INVALID_REFERENCE') && <button className="secondary-button" onClick={() => void load()}>重新加载清单</button>}{errorCode === 'IDEMPOTENCY_CONFLICT' && <button className="secondary-button" onClick={resetConflictedOperation}>确认后重新开始操作</button>}</div>}
        {idempotencyKey && <p className="operation-note">本次采购操作编号已保留。重复提交不会重复入库。</p>}
      </div>
      <div className="sticky-actions"><button className="primary-button" onClick={() => void complete()} disabled={!list || saving || networkUnknown || !valid || list.status === 'completed'}>{saving ? '正在完成采购…' : list?.status === 'completed' ? '采购已完成' : '完成采购并写入库存'}</button></div>
      <BottomNav active="采购" onChange={onTab} />
    </main>
  )
}
