import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { RecipeCandidate } from '../fr002-types'
import { amount } from '../lib/fr002'
import { AddRecipePage } from './AddRecipePage'

type CandidateFilter = 'all' | 'kept' | 'skipped'

export function CandidatePoolPage({ onBack, onTab, onSessionExpired }: {
  onBack: () => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [items, setItems] = useState<RecipeCandidate[]>([])
  const [filter, setFilter] = useState<CandidateFilter>('all')
  const [loading, setLoading] = useState(true)
  const [changingId, setChangingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addingRecipe, setAddingRecipe] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setItems(await fr002Adapter.listRecipeCandidates()) }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '候选菜池加载失败。')
    }
    finally { setLoading(false) }
  }, [onSessionExpired])

  useEffect(() => { void load() }, [load])

  async function toggleStatus(item: RecipeCandidate) {
    if (changingId) return
    const status = item.status === 'skipped' ? 'kept' : 'skipped'
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

  if (addingRecipe) return <AddRecipePage onBack={() => setAddingRecipe(false)} onTab={onTab} />

  const keptCount = items.filter((item) => item.status !== 'skipped').length
  const skippedCount = items.length - keptCount
  const visibleItems = items.filter((item) => filter === 'all' || (filter === 'kept' ? item.status !== 'skipped' : item.status === 'skipped'))

  return <main className="phone page candidate-pool-page">
    <div className="page-content">
      <header className="candidate-pool-header">
        <button className="candidate-pool-back" onClick={onBack}><span aria-hidden="true">←</span><b>候选菜池</b></button>
        <button className="text-button neutral" onClick={() => setAddingRecipe(true)}>添加菜谱</button>
      </header>

      <div className="candidate-filter" aria-label="筛选候选菜谱">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部 {items.length}</button>
        <button className={filter === 'kept' ? 'active' : ''} onClick={() => setFilter('kept')}>保留 {keptCount}</button>
        <button className={filter === 'skipped' ? 'active' : ''} onClick={() => setFilter('skipped')}>跳过 {skippedCount}</button>
      </div>

      {loading && <LoadingState rows={7} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && items.length === 0 && <EmptyState title="候选菜池为空" detail="添加真实菜谱后，候选项会显示在这里。" />}
      {!loading && !error && items.length > 0 && visibleItems.length === 0 && <EmptyState title="这个筛选下没有菜谱" detail="切换筛选查看其他候选项。" />}
      {!loading && visibleItems.length > 0 && <div className="candidate-list">
        {visibleItems.map((item) => {
          const kept = item.status !== 'skipped'
          return <button className="candidate-card" key={item.recipeId} disabled={changingId === item.recipeId} onClick={() => void toggleStatus(item)}>
            <span><b>{item.name}</b><small>{amount(item.servings)} 份 · {item.allVerified ? '营养已验证' : '营养含估算'}</small></span>
            <span className={`candidate-state ${kept ? 'kept' : 'skipped'}`}>{kept && <i aria-hidden="true" />} {kept ? '保留' : '跳过'}</span>
          </button>
        })}
      </div>}
    </div>
    <BottomNav active="采购" onChange={onTab} />
  </main>
}
