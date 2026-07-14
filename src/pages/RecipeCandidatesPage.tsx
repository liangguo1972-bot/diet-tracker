import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { CandidateStatus, DrawnRecipe, RecipeCandidate, WeeklyPlan } from '../fr002-types'
import { amount, prettyDate } from '../lib/fr002'

const statusLabels: Record<CandidateStatus, string> = {
  wanted: '想吃',
  candidate: '候选',
  kept: '保留',
  skipped: '跳过',
}

export function RecipeCandidatesPage({ weekStart, onDrawn, onPlan, onTab, onSessionExpired }: {
  weekStart: string
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

  return (
    <main className="phone page grocery-page">
      <div className="page-content with-action">
        <header className="topbar"><h1>采购</h1><span className="date-note">{prettyDate(weekStart)} 开始</span></header>
        <section className="candidate-hero"><span className="eyebrow-label">候选菜池</span><h2>翻一张，决定这周吃什么</h2><p>随机结果只来自你的真实候选菜池。</p></section>
        {loading && <LoadingState rows={7} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && items.length === 0 && <EmptyState title="候选菜池为空" detail="当前接口只读取已存在的候选食谱。这里不会显示设计样例。" />}
        {!loading && items.length > 0 && (
          <section className="section-card candidate-list">
            <div className="section-heading"><span>心愿单 / 候选菜池</span><small>{items.length} 道</small></div>
            {items.map((item) => (
              <article className="candidate-card" key={item.recipeId}>
                <div><span className="status-chip">{statusLabels[item.status]}</span><h3>{item.name}</h3><p>{amount(item.servings)} 份 · {item.allVerified ? '营养已验证' : '营养含估算'}</p></div>
                <div className="candidate-actions">
                  <button disabled={changingId === item.recipeId} onClick={() => void changeStatus(item, item.status === 'kept' ? 'candidate' : 'kept')}>{item.status === 'kept' ? '取消保留' : '保留'}</button>
                  <button disabled={changingId === item.recipeId} onClick={() => void changeStatus(item, item.status === 'skipped' ? 'candidate' : 'skipped')}>{item.status === 'skipped' ? '恢复' : '跳过'}</button>
                </div>
              </article>
            ))}
          </section>
        )}
        {existingPlan && <button className="secondary-button wide" onClick={() => onPlan(existingPlan)}>查看已保存的本周食谱</button>}
      </div>
      <div className="sticky-actions"><button className="primary-button" onClick={() => void draw()} disabled={loading || drawing || items.every((item) => item.status === 'skipped')}>{drawing ? '随机抽取中…' : '抽取本周食谱'}</button></div>
      <BottomNav active="采购" onChange={onTab} />
    </main>
  )
}
