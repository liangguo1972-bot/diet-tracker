import { BottomNav, type MainTab } from '../components/BottomNav'
import { ErrorState, LoadingState } from '../components/Status'
import type { CookDraft } from '../fr002-types'
import { amount, isCookDraftComplete, removeCookUsage, updateCookUsage } from '../lib/fr002'

const statusLabel = {
  ready: '库存充足',
  partial: '库存不足',
  missing: '缺少库存',
  unit_confirmation_required: '需确认量词',
} as const

export function CookPage({ draft, loading, error, onRetry, onDraft, onPick, onBack, onContinue, onTab }: {
  draft: CookDraft | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onDraft: (draft: CookDraft) => void
  onPick: (ingredientId: string, ingredientName: string, usageIndex?: number) => void
  onBack: () => void
  onContinue: () => void
  onTab: (tab: MainTab) => void
}) {
  const complete = draft ? isCookDraftComplete(draft) : false

  return (
    <main className="phone page cook-page">
      <div className="page-content with-action">
        <header className="topbar centered"><button className="back-button" onClick={onBack}>返回</button><h1>做饭</h1><span /></header>
        {loading && <LoadingState rows={7} />}
        {error && <ErrorState message={error} onRetry={onRetry} />}
        {draft && !loading && !error && (
          <>
            <section className="section-card cook-summary">
              <span className="eyebrow-label">{draft.planItemId ? '来自本周食谱' : '食谱'}</span>
              <h2>{draft.recipeName}</h2>
              <p>这里只确认真实库存批次和本次用量。营养克重由后端计算。</p>
            </section>
            <section>
              <div className="feature-title"><span><b>需要食材</b><small>逐项确认库存和用量</small></span></div>
              <div className="ingredient-stack">
                {draft.ingredients.map((ingredient) => (
                  <article className="section-card ingredient-card" key={ingredient.ingredientId}>
                    <div className="ingredient-heading"><span><b>{ingredient.name}</b><small>食谱参考 {amount(ingredient.referenceGrams)}g</small></span><span className={`status-chip ${ingredient.availabilityStatus === 'ready' ? 'success' : 'warning'}`}>{statusLabel[ingredient.availabilityStatus]}</span></div>
                    {ingredient.usages.length === 0 ? (
                      <div className="missing-stock"><p>没有选择可扣减库存。</p><button className="secondary-button" onClick={() => onPick(ingredient.ingredientId, ingredient.name)}>选择库存</button></div>
                    ) : ingredient.usages.map((usage, usageIndex) => {
                      const invalid = usage.quantityUsed !== null && usage.quantityUsed > usage.quantity
                      return (
                        <div className="usage-row" key={usage.inventoryId}>
                          <div className="usage-copy"><b>{usage.name}</b><small>可用 {amount(usage.quantity)} {usage.unit}{usage.storage ? ` · ${usage.storage}` : ''}</small></div>
                          <label>本次使用<input type="number" min="0.01" max={usage.quantity} step="0.01" value={usage.quantityUsed ?? ''} onChange={(event) => {
                            const value = event.target.value === '' ? null : Number(event.target.value)
                            onDraft(updateCookUsage(draft, ingredient.ingredientId, usageIndex, value !== null && Number.isFinite(value) ? value : null))
                          }} /><span>{usage.unit}</span></label>
                          <div className="usage-actions"><button className="text-button neutral" onClick={() => onPick(ingredient.ingredientId, ingredient.name, usageIndex)}>更换</button><button className="remove-button" onClick={() => onDraft(removeCookUsage(draft, ingredient.ingredientId, usageIndex))}>移除</button></div>
                          {usage.quantityUsed === null && <small className="field-error">请输入与库存相同量词的使用量。</small>}
                          {invalid && <small className="field-error">使用量不能超过当前库存。</small>}
                        </div>
                      )
                    })}
                    {ingredient.usages.length > 0 && <button className="add-inline" onClick={() => onPick(ingredient.ingredientId, ingredient.name)}>＋ 添加同一种食材的其他批次</button>}
                  </article>
                ))}
              </div>
            </section>
            {!complete && <p className="save-error" role="status"><b>还不能继续</b><span>每种食材都需要选择库存，并填写大于 0 且不超过库存的同单位用量。</span></p>}
          </>
        )}
      </div>
      <div className="sticky-actions"><button className="primary-button" disabled={!complete || loading} onClick={onContinue}>确认本次用量</button></div>
      <BottomNav active="厨房" onChange={onTab} />
    </main>
  )
}
