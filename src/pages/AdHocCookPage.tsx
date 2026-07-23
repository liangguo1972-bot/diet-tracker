import { BottomNav, type MainTab } from '../components/BottomNav'
import type { AdHocCookDraft } from '../fr002-types'
import { amount } from '../lib/fr002'
import { isAdHocCookDraftComplete } from '../lib/fr004'

export function AdHocCookPage({ draft, onDraft, onPick, onBack, onContinue, onTab }: {
  draft: AdHocCookDraft; onDraft: (draft: AdHocCookDraft) => void; onPick: () => void; onBack: () => void; onContinue: () => void; onTab: (tab: MainTab) => void
}) {
  const update = (index: number, patch: Partial<AdHocCookDraft['items'][number]>) => onDraft({ ...draft, items: draft.items.map((item, current) => current === index ? { ...item, ...patch } : item) })
  const complete = isAdHocCookDraftComplete(draft)
  return <main className="phone page cook-page adhoc-page adhoc-cook-page">
    <div className="page-content with-action">
      <header className="topbar centered"><button className="back-button" onClick={onBack}>返回</button><h1>无菜谱做饭</h1><span /></header>
      <section className="section-card cook-summary"><span className="eyebrow-label">无菜谱</span><h2>随手做一锅</h2><p>已匹配食材填写本次扣减量和主要食材克重。库存占位只扣库存，不计算营养，也不会写入菜谱。</p></section>
      <section className="section-card form-stack"><label>成品名称<input value={draft.name} maxLength={120} onChange={(e) => onDraft({ ...draft, name: e.target.value })} placeholder="例如：番茄鸡蛋" /></label><label>总份数<input type="number" min="0.01" step="0.25" value={draft.totalServings} onChange={(e) => onDraft({ ...draft, totalServings: Number(e.target.value) })} /></label></section>
      <section><div className="feature-title"><span><b>主要食材</b><small>按真实库存单位填写</small></span><button className="text-button" onClick={onPick}>重新选择</button></div>
        <div className="ingredient-stack">{draft.items.map((item, index) => <article className="section-card adhoc-ingredient-card" key={item.inventoryId}>
          <div className="ingredient-heading"><span><b>{item.name}</b><small>库存 {amount(item.quantity)} {item.unit}</small></span><span className={`status-chip ${item.ingredientId ? 'success' : 'warning'}`}>{item.ingredientId ? '已匹配' : '库存占位'}</span></div>
          <label>本次使用<input type="number" min="0.01" max={item.quantity} step="0.01" value={item.quantityUsed ?? ''} onChange={(e) => update(index, { quantityUsed: e.target.value === '' ? null : Number(e.target.value) })} /><span>{item.unit}</span></label>
          {item.ingredientId && <label>主要食材克重<input type="number" min="0.01" step="0.1" value={item.grams ?? ''} onChange={(e) => update(index, { grams: e.target.value === '' ? null : Number(e.target.value) })} /><span>g</span></label>}
          {!item.ingredientId && <p className="scope-note">这项只按 {item.unit} 扣减，不进入营养或候选菜谱。</p>}
        </article>)}</div>
      </section>
      <section className="section-card form-stack"><label>备注<textarea value={draft.note} onChange={(e) => onDraft({ ...draft, note: e.target.value })} placeholder="可选" /></label></section>
      {!complete && <p className="save-error"><b>还不能继续</b><span>需要成品名、至少一种已匹配食材，以及每项有效使用量。已匹配食材还需填写克重。</span></p>}
    </div>
    <div className="sticky-actions"><button className="primary-button" disabled={!complete} onClick={onContinue}>保存成品</button></div><BottomNav active="厨房" onChange={onTab} />
  </main>
}
