import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { CandidateStatus, DrawnRecipe, RecipeCandidate, WeeklyPlan } from '../fr002-types'
import { amount } from '../lib/fr002'

export function RecipeCandidatesPage({ weekStart, onAddRecipe, onDrawn, onPlan, onTab, onSessionExpired }: {
  weekStart: string
  onAddRecipe: () => void
  onDrawn: (recipes: DrawnRecipe[]) => void
  onPlan: (plan: WeeklyPlan) => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [items, setItems] = useState<RecipeCandidate[]>([])
  const [existingPlan, setExistingPlan] = useState<WeeklyPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [drawing, setDrawing] = useState(false)
  const [changingId, setChangingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [candidates, planData] = await Promise.all([
        fr002Adapter.listRecipeCandidates(),
        fr002Adapter.getWeeklyPlan(weekStart),
      ])
      setItems(candidates)
      setExistingPlan(planData.plan)
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '采购数据加载失败。')
    } finally { setLoading(false) }
  }, [onSessionExpired, weekStart])

  useEffect(() => { void load() }, [load])

  async function changeStatus(item: RecipeCandidate, status: CandidateStatus) {
    if (changingId) return
    setChangingId(item.recipeId)
    setError(null)
    try {
      await fr002Adapter.setRecipeCandidateStatus(item.recipeId, status, item.position)
      setItems((current) => current.map((candidate) => candidate.recipeId === item.recipeId ? { ...candidate, status } : candidate))
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '候选状态保存失败。')
    } finally { setChangingId(null) }
  }

  async function draw() {
    const eligibleCount = items.filter((item) => item.status !== 'skipped').length
    if (drawing || eligibleCount === 0) return
    setDrawing(true)
    setError(null)
    try {
      const result = await fr002Adapter.drawRecipeCandidates(Math.min(4, eligibleCount))
      if (result.length === 0) setError('没有可抽取的真实候选食谱。')
      else onDrawn(result)
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '随机抽取失败。')
    } finally { setDrawing(false) }
  }

  const visibleItems = items.slice(0, 3)
  const remainingCount = Math.max(0, items.length - visibleItems.length)

  return (
    <main className="phone page grocery-page">
      <div className="page-content">
        <header className="topbar"><h1>采购</h1><button className="text-button neutral" onClick={onAddRecipe}>添加菜谱</button></header>
        <section className="candidate-hero">
          <span>候选菜池</span>
          <div className="candidate-hero-number"><b>{items.length}</b><span>道备选</span></div>
          <p>抽一次，从菜池里随机定下这周吃什么。</p>
          <button onClick={() => void draw()} disabled={loading || drawing || items.every((item) => item.status === 'skipped')}>{drawing ? '随机抽取中…' : '抽一次'}</button>
        </section>
        {loading && <LoadingState rows={7} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && items.length === 0 && <EmptyState title="候选菜池为空" detail="当前接口只读取已存在的候选食谱。这里不会显示设计样例。" />}
        {!loading && items.length > 0 && (
          <section className="candidate-section">
            <div className="section-heading"><span>心愿单 / 候选菜池</span><small>点整行切换保留 / 跳过</small></div>
            <div className="candidate-list">
              {visibleItems.map((item) => {
                const kept = item.status !== 'skipped'
                return <button className="candidate-card" key={item.recipeId} disabled={changingId === item.recipeId} onClick={() => void changeStatus(item, kept ? 'skipped' : 'kept')}>
                  <span><b>{item.name}</b><small>{amount(item.servings)} 份 · {item.allVerified ? '营养已验证' : '营养含估算'}</small></span>
                  <span className={`candidate-state ${kept ? 'kept' : 'skipped'}`}>{kept && <i aria-hidden="true" />} {kept ? '保留' : '跳过'}</span>
                </button>
              })}
              {remainingCount > 0 && <button className="candidate-expand" onClick={() => onTab('candidate-pool' as MainTab)}>展开其余 {remainingCount} 道&nbsp; ⌄</button>}
            </div>
          </section>
        )}
        {existingPlan && <button className="secondary-button wide" onClick={() => onPlan(existingPlan)}>查看已保存的本周食谱</button>}
      </div>
      <BottomNav active="采购" onChange={onTab} />
    </main>
  )
}
