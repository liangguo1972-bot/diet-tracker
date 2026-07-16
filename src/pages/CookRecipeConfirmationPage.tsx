import { useCallback, useEffect, useRef, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired, isFr002Error } from '../data/errors'
import { fr002Adapter, parseCreatedRecipeFromCook } from '../data/fr002'
import type { CookRecipeConfirmation, CreatedRecipeFromCook } from '../fr002-types'
import { amount, newIdempotencyKey } from '../lib/fr002'

export function CookRecipeConfirmationPage({ cookSessionId, onBack, onConfirmed, onTab, onSessionExpired }: {
  cookSessionId: string; onBack: () => void; onConfirmed: (result: CreatedRecipeFromCook) => void; onTab: (tab: MainTab) => void; onSessionExpired: () => void
}) {
  const [data, setData] = useState<CookRecipeConfirmation | null>(null), [name, setName] = useState('')
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null), [saveError, setSaveError] = useState<string | null>(null), [networkUnknown, setNetworkUnknown] = useState(false)
  const [key, setKey] = useState<string | null>(null); const savingRef = useRef(false)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { const result = await fr002Adapter.getCookRecipeConfirmation(cookSessionId); setData(result); setName(result.recipeName ?? result.name) }
    catch (reason) { if (isAuthenticationRequired(reason)) onSessionExpired(); else setError(reason instanceof Error ? reason.message : '菜谱确认内容加载失败。') }
    finally { setLoading(false) }
  }, [cookSessionId, onSessionExpired])
  useEffect(() => { void load() }, [load])
  const editName = (value: string) => { if (networkUnknown) return; setName(value); setKey(null); setSaveError(null) }
  async function confirm() {
    if (savingRef.current || !data || !name.trim()) return
    const operationKey = key ?? newIdempotencyKey(); setKey(operationKey); savingRef.current = true; setSaving(true); setSaveError(null)
    try { onConfirmed(await fr002Adapter.createRecipeFromCookSession(data.cookSessionId, name, operationKey)) }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else { setSaveError(reason instanceof Error ? reason.message : '菜谱确认失败，成品仍已保存。'); setNetworkUnknown(isFr002Error(reason, 'NETWORK_UNKNOWN')) }
    } finally { savingRef.current = false; setSaving(false) }
  }
  async function check() {
    if (!key || checking) return; setChecking(true); setSaveError(null)
    try { const result = await fr002Adapter.getOperationResult('create_recipe_from_cook_session', key, parseCreatedRecipeFromCook); if (result) onConfirmed(result.response); else setSaveError('服务端还没有成功结果。请使用原操作编号重试。') }
    catch (reason) { if (isAuthenticationRequired(reason)) onSessionExpired(); else setSaveError(reason instanceof Error ? reason.message : '结果查询失败。') }
    finally { setChecking(false) }
  }
  return <main className="phone page cook-page adhoc-page"><div className="page-content with-action">
    <header className="topbar centered"><button className="back-button" disabled={saving} onClick={onBack}>稍后确认</button><h1>菜谱确认</h1><span /></header>
    {loading && <LoadingState rows={7} />}{error && <ErrorState message={error} onRetry={load} />}
    {data && !loading && !error && <>
      <section className="section-card cook-summary"><span className="eyebrow-label">从本锅生成</span><h2>{data.name}</h2><p>成品已经保存，可用于记餐。确认后，下列已匹配食材会生成候选菜谱。</p></section>
      <section className="section-card form-stack"><label>菜谱名称<input value={name} maxLength={120} disabled={networkUnknown} onChange={(e) => editName(e.target.value)} /></label></section>
      <section className="section-card compact-list"><div className="section-heading"><span>主要食材</span><small>来自本锅</small></div>{data.items.map((item) => <div className="feature-row static" key={item.ingredientId}><span><b>{item.ingredientName}</b><small>{item.isVerified ? '已验证食材' : '营养为估算'}</small></span><strong>{amount(item.grams)}g</strong></div>)}{data.unmatchedItems.map((item) => <div className="feature-row static muted-row" key={item.inventoryId}><span><b>{item.name}</b><small>库存占位，不进入菜谱</small></span><strong>{amount(item.quantityUsed)} {item.unit}</strong></div>)}</section>
      {saveError && <div className="save-error" role="alert"><b>菜谱尚未确认</b><span>{saveError} 成品不会被撤销，可以稍后继续。</span>{networkUnknown && <><button className="secondary-button" disabled={checking} onClick={check}>{checking ? '正在确认…' : '确认服务端结果'}</button><button className="text-button" disabled={saving} onClick={confirm}>使用原操作编号重试</button></>}</div>}
    </>}
  </div><div className="sticky-actions"><button className="primary-button" disabled={loading || saving || networkUnknown || !name.trim()} onClick={confirm}>{saving ? '正在确认…' : '确认并加入候选菜池'}</button></div><BottomNav active="厨房" onChange={onTab} /></main>
}
