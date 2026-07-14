import { useRef, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { isAuthenticationRequired, isFr002Error } from '../data/errors'
import { fr002Adapter, parseSavedCook } from '../data/fr002'
import type { CookDraft, SavedCookSession } from '../fr002-types'
import { amount, isCookDraftComplete, newIdempotencyKey, toSaveCookInput } from '../lib/fr002'

export function SaveCookPage({ draft, onDraft, onBack, onSaved, onTab, onSessionExpired }: {
  draft: CookDraft
  onDraft: (draft: CookDraft) => void
  onBack: () => void
  onSaved: (result: SavedCookSession) => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)
  const [networkUnknown, setNetworkUnknown] = useState(false)
  const savingRef = useRef(false)

  const edit = (next: CookDraft) => {
    if (networkUnknown) return
    setIdempotencyKey(null)
    setError(null)
    setErrorCode(null)
    onDraft(next)
  }

  async function save() {
    if (savingRef.current || !isCookDraftComplete(draft) || draft.totalServings <= 0 || !draft.name.trim()) return
    const key = idempotencyKey ?? newIdempotencyKey()
    setIdempotencyKey(key)
    savingRef.current = true
    setSaving(true)
    setError(null)
    setErrorCode(null)
    try {
      const result = await fr002Adapter.saveCookSession(toSaveCookInput(draft), key)
      onSaved(result)
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else {
        setError(reason instanceof Error ? reason.message : '保存失败，草稿已保留。')
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
      const result = await fr002Adapter.getOperationResult('save_cook_session', idempotencyKey, parseSavedCook)
      if (result) onSaved(result.response)
      else setError('没有查到成功结果。请使用原操作编号重试，不要新建一次保存。')
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '操作结果查询失败。')
    } finally { setChecking(false) }
  }

  function resetConflictedOperation() {
    if (!window.confirm('确认放弃原操作编号并重新提交当前草稿吗？')) return
    setIdempotencyKey(null)
    setError(null)
    setErrorCode(null)
    setNetworkUnknown(false)
  }

  return (
    <main className="phone page cook-page">
      <div className="page-content with-action">
        <header className="topbar centered"><button className="back-button" onClick={onBack} disabled={saving}>返回</button><h1>保存成品</h1><span /></header>
        <section className="section-card cook-summary">
          <span className="eyebrow-label">本次完成</span>
          <h2>{draft.recipeName}</h2>
          <p>保存成功后，真实成品会出现在厨房首页和记餐成品选择器中。</p>
        </section>
        <section className="section-card form-stack">
          <label>成品名称<input value={draft.name} disabled={networkUnknown} onChange={(event) => edit({ ...draft, name: event.target.value })} /></label>
          <label>总份数<input type="number" min="0.01" step="0.25" value={draft.totalServings} disabled={networkUnknown} onChange={(event) => edit({ ...draft, totalServings: Number(event.target.value) })} /></label>
          <label>制作日期<input type="date" value={draft.cookedOn} disabled={networkUnknown} onChange={(event) => edit({ ...draft, cookedOn: event.target.value })} /></label>
          <label>备注<textarea value={draft.note} disabled={networkUnknown} onChange={(event) => edit({ ...draft, note: event.target.value })} placeholder="可选" /></label>
        </section>
        <section className="section-card save-summary">
          <div className="section-heading"><span>将扣减库存</span><small>{draft.ingredients.length} 种食材</small></div>
          {draft.ingredients.flatMap((ingredient) => ingredient.usages.map((usage) => <p key={usage.inventoryId}><b>{ingredient.name}</b><span>{amount(usage.quantityUsed ?? 0)} {usage.unit}</span></p>))}
        </section>
        {error && <div className="save-error" role="alert"><b>暂时无法保存</b><span>{error}</span>{networkUnknown && <><button className="secondary-button" onClick={checkResult} disabled={checking}>{checking ? '正在确认…' : '确认服务端结果'}</button><button className="text-button" onClick={save} disabled={saving}>使用原操作编号重试</button></>}{errorCode === 'IDEMPOTENCY_CONFLICT' && <button className="secondary-button" onClick={resetConflictedOperation}>确认后重新开始操作</button>}</div>}
        {idempotencyKey && <p className="operation-note">本次操作编号已保留。重复点击不会重复扣库存。</p>}
      </div>
      <div className="sticky-actions"><button className="primary-button" onClick={save} disabled={saving || networkUnknown || draft.totalServings <= 0 || !draft.name.trim()}>{saving ? '正在保存…' : '保存为成品'}</button></div>
      <BottomNav active="厨房" onChange={onTab} />
    </main>
  )
}
