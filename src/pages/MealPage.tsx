import { useRef, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { isAuthenticationRequired, isMealComponentNotFound, isMealNotFound } from '../data/errors'
import { mealMutationAdapter } from '../data/meals'
import { MIN_SERVINGS, removeDraftItem, SERVING_STEP, setDraftItemServings } from '../lib/draft'
import type { MealDraft, MealType, SaveMealInput } from '../types'

const mealTypes: MealType[] = ['早餐', '早午餐', '午餐', '晚餐', '加餐']
export function MealPage({ draft, onDraft, onBack, onPick, onTab, onSaved, onMealMissing, onSessionExpired }: {
  draft: MealDraft
  onDraft: (draft: MealDraft) => void
  onBack: () => void
  onPick: (kind: 'cook_session' | 'ingredient') => void
  onTab: (tab: MainTab) => void
  onSaved: (mode: 'created' | 'updated') => void
  onMealMissing: () => void
  onSessionExpired: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)

  function setServings(index: number, value: number) {
    onDraft(setDraftItemServings(draft, index, value))
  }

  function removeItem(index: number) {
    onDraft(removeDraftItem(draft, index))
  }

  async function save() {
    if (savingRef.current || !draft.items.length) return
    savingRef.current = true
    const input: SaveMealInput = {
      eatenOn: draft.eatenOn,
      mealType: draft.mealType,
      note: draft.note.trim() || undefined,
      items: draft.items.map((item) => item.sourceType === 'cook_session'
        ? { sourceType: 'cook_session', cookSessionId: item.sourceId, servings: item.servings }
        : { sourceType: 'ingredient', ingredientId: item.sourceId, servings: item.servings }),
    }
    setSaving(true); setError(null)
    try {
      if (draft.mealId) {
        await mealMutationAdapter.updateMeal(draft.mealId, input)
        onSaved('updated')
      } else {
        await mealMutationAdapter.saveMeal(input)
        onSaved('created')
      }
    }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else if (isMealNotFound(reason)) onMealMissing()
      else if (isMealComponentNotFound(reason)) setError(reason.message)
      else setError(reason instanceof Error ? `${reason.message} 草稿已保留。` : '保存失败。草稿已保留。')
    }
    finally { savingRef.current = false; setSaving(false) }
  }

  return (
    <main className="phone page meal-page">
      <div className="page-content with-action">
        <header className="topbar centered"><button className="back-button" onClick={onBack}>返回</button><h1>{draft.mealId ? '编辑一餐' : '记一餐'}</h1><span /></header>
        <section className="section-card"><div className="section-heading"><span>餐次</span></div><div className="meal-type-row">{mealTypes.map((type) => <button key={type} className={draft.mealType === type ? 'active' : ''} onClick={() => onDraft({ ...draft, mealType: type })}>{type}</button>)}</div><p className="muted">{draft.eatenOn} · 选择这一餐的类型</p></section>
        <section><p className="small-label">这餐吃了什么</p><div className="section-card draft-list">{draft.items.length === 0 && <p className="muted empty-line">还没有添加内容。</p>}{draft.items.map((item, index) => {
          const atMin = item.servings <= MIN_SERVINGS
          const atMax = item.availableServings !== null && item.servings >= item.availableServings
          return <div className="draft-row" key={`${item.sourceType}-${item.sourceId}`}><span><b>{item.name}</b><small>{item.sourceType === 'cook_session' ? '成品' : '单品'} · {Math.round(item.nutrition.kcal * item.servings)} kcal{item.estimated ? ' · 估' : ''}{item.availableServings !== null ? ` · 最多 ${item.availableServings} 份` : ''}</small></span><span className="item-actions"><span className="stepper"><button aria-label={`减少${item.name}份数`} disabled={atMin} onClick={() => setServings(index, item.servings - SERVING_STEP)}>−</button><input aria-label={`${item.name}份数`} type="number" min={MIN_SERVINGS} max={item.availableServings ?? undefined} step={MIN_SERVINGS} value={item.servings} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) setServings(index, value) }} /><button aria-label={`增加${item.name}份数`} disabled={atMax} onClick={() => setServings(index, item.servings + SERVING_STEP)}>＋</button></span><button className="remove-button" onClick={() => removeItem(index)}>删除</button></span></div>
        })}<button className="add-row" onClick={() => onPick('cook_session')}>添加成品</button><button className="add-row" onClick={() => onPick('ingredient')}>添加单品</button></div></section>
        <label className="note-field">备注<textarea value={draft.note} onChange={(e) => onDraft({ ...draft, note: e.target.value })} placeholder="可选" /></label>
        {error && <p className="save-error" role="alert"><b>暂时无法保存</b><span>{error}</span></p>}
      </div>
      <div className="sticky-actions">{draft.items.length === 0 && <small className="save-hint">添加内容后才能保存</small>}<button className="primary-button" onClick={save} disabled={saving || draft.items.length === 0}>{saving ? '正在保存…' : draft.mealId ? '保存修改' : '保存这一餐'}</button></div>
      <BottomNav active="记录" onChange={onTab} />
    </main>
  )
}
