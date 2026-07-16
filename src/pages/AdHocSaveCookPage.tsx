import { useRef, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { isAuthenticationRequired, isFr002Error } from '../data/errors'
import { fr002Adapter, parseSavedCookWithoutRecipe } from '../data/fr002'
import type { AdHocCookDraft, SavedCookWithoutRecipe } from '../fr002-types'
import { amount, newIdempotencyKey } from '../lib/fr002'
import { isAdHocCookDraftComplete, toSaveCookWithoutRecipeInput } from '../lib/fr004'

export function AdHocSaveCookPage({ draft, onBack, onSaved, onTab, onSessionExpired }: {
  draft: AdHocCookDraft; onBack: () => void; onSaved: (result: SavedCookWithoutRecipe) => void; onTab: (tab: MainTab) => void; onSessionExpired: () => void
}) {
  const [saving, setSaving] = useState(false), [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null), [networkUnknown, setNetworkUnknown] = useState(false)
  const [key, setKey] = useState<string | null>(null)
  const savingRef = useRef(false)
  async function save() {
    if (savingRef.current || !isAdHocCookDraftComplete(draft)) return
    const operationKey = key ?? newIdempotencyKey(); setKey(operationKey); savingRef.current = true; setSaving(true); setError(null)
    try { onSaved(await fr002Adapter.saveCookWithoutRecipe(toSaveCookWithoutRecipeInput(draft), operationKey)) }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else { setError(reason instanceof Error ? reason.message : '保存失败，草稿已保留。'); setNetworkUnknown(isFr002Error(reason, 'NETWORK_UNKNOWN')) }
    } finally { savingRef.current = false; setSaving(false) }
  }
  async function check() {
    if (!key || checking) return
    setChecking(true); setError(null)
    try {
      const result = await fr002Adapter.getOperationResult('save_cook_without_recipe', key, parseSavedCookWithoutRecipe)
      if (result) onSaved(result.response); else setError('服务端还没有成功结果。可以使用原操作编号手动重试。')
    } catch (reason) { if (isAuthenticationRequired(reason)) onSessionExpired(); else setError(reason instanceof Error ? reason.message : '结果查询失败。') }
    finally { setChecking(false) }
  }
  return <main className="phone page cook-page adhoc-page"><div className="page-content with-action">
    <header className="topbar centered"><button className="back-button" disabled={saving || networkUnknown} onClick={onBack}>返回</button><h1>保存成品</h1><span /></header>
    <section className="section-card cook-summary"><span className="eyebrow-label">无菜谱生成</span><h2>{draft.name}</h2><p>成品保存后会立即进入记餐选择器。下一步需要确认菜谱，确认失败不会撤销成品。</p></section>
    <section className="section-card save-summary"><div className="section-heading"><span>本锅内容</span><small>{amount(draft.totalServings)} 份</small></div>{draft.items.map((item) => <p key={item.inventoryId}><b>{item.name}</b><span>{amount(item.quantityUsed ?? 0)} {item.unit}{item.ingredientId ? ` · ${amount(item.grams ?? 0)}g` : ' · 仅扣库存'}</span></p>)}</section>
    {error && <div className="save-error" role="alert"><b>暂时无法保存</b><span>{error}</span>{networkUnknown && <><button className="secondary-button" disabled={checking} onClick={check}>{checking ? '正在确认…' : '确认服务端结果'}</button><button className="text-button" disabled={saving} onClick={save}>使用原操作编号重试</button></>}</div>}
    {key && <p className="operation-note">本次操作编号已保留，不会重复扣库存。</p>}
  </div><div className="sticky-actions"><button className="primary-button" disabled={saving || networkUnknown} onClick={save}>{saving ? '正在保存…' : '保存成品并确认菜谱'}</button></div><BottomNav active="厨房" onChange={onTab} /></main>
}
