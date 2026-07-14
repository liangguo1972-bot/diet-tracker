import { useCallback, useEffect, useMemo, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { RecipeCandidate, WeeklyPlan, WeeklyPlanItem } from '../fr002-types'
import { addDays, amount, prettyDate, toWeeklyPlanInputs, weekday } from '../lib/fr002'

export function EditWeeklyPlanPage({ weekStart, items, onBack, onSaved, onTab, onSessionExpired }: {
  weekStart: string
  items: WeeklyPlanItem[]
  onBack: () => void
  onSaved: (plan: WeeklyPlan) => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [draft, setDraft] = useState(items)
  const [candidates, setCandidates] = useState<RecipeCandidate[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const weekEnd = addDays(weekStart, 6)

  const loadCandidates = useCallback(async () => {
    setLoadingCandidates(true)
    setError(null)
    try { setCandidates(await fr002Adapter.listRecipeCandidates()) }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '候选菜池加载失败。')
    }
    finally { setLoadingCandidates(false) }
  }, [onSessionExpired])

  useEffect(() => { void loadCandidates() }, [loadCandidates])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const availableCandidates = useMemo(() => candidates.filter((candidate) => candidate.status !== 'skipped' && !draft.some((item) => item.recipeId === candidate.recipeId)), [candidates, draft])
  const valid = draft.length > 0 && draft.every((item) => item.scheduledOn >= weekStart && item.scheduledOn <= weekEnd && item.plannedServings > 0)

  function change(next: WeeklyPlanItem[]) {
    setDraft(next.map((item, index) => ({ ...item, position: index })))
    setDirty(true)
    setError(null)
  }

  function addCandidate(candidate: RecipeCandidate) {
    const occupied = new Set(draft.map((item) => item.scheduledOn))
    let scheduledOn = weekStart
    for (let offset = 0; offset < 7; offset += 1) {
      const candidateDate = addDays(weekStart, offset)
      if (!occupied.has(candidateDate)) { scheduledOn = candidateDate; break }
    }
    change([...draft, {
      id: `local-${candidate.recipeId}-${draft.length}`,
      recipeId: candidate.recipeId,
      recipeName: candidate.name,
      scheduledOn,
      plannedServings: candidate.servings || 1,
      position: draft.length,
      source: 'manual',
    }])
  }

  function leave(action: () => void) {
    if (dirty && !window.confirm('本周食谱的修改尚未保存，确认离开吗？')) return
    action()
  }

  async function save() {
    if (saving || !valid) return
    setSaving(true)
    setError(null)
    try {
      const result = await fr002Adapter.saveWeeklyPlan(weekStart, toWeeklyPlanInputs(draft), 'draft')
      if (!result.plan) throw new Error('周计划没有保存成功。')
      setDirty(false)
      onSaved(result.plan)
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? `${reason.message} 修改已保留。` : '保存失败，修改已保留。')
    } finally { setSaving(false) }
  }

  return (
    <main className="phone page grocery-detail-page">
      <div className="page-content with-action">
        <header className="topbar centered"><button className="back-button" onClick={() => leave(onBack)}>返回</button><h1>编辑食谱</h1><span /></header>
        <section>
          <div className="feature-title"><span><b>本周安排</b><small>一行一个操作</small></span></div>
          {draft.length === 0 ? <EmptyState title="还没有安排" detail="从候选菜池加入至少一道食谱。" /> : (
            <div className="section-card edit-plan-list">
              {draft.map((item, index) => (
                <article className="edit-plan-row" key={item.id}>
                  <div><b>{item.recipeName}</b><small>{weekday(item.scheduledOn)} · {prettyDate(item.scheduledOn)}</small></div>
                  <label>日期<input type="date" min={weekStart} max={weekEnd} value={item.scheduledOn} onChange={(event) => change(draft.map((current, currentIndex) => currentIndex === index ? { ...current, scheduledOn: event.target.value, source: 'manual' } : current))} /></label>
                  <label>份数<input type="number" min="0.01" step="0.25" value={item.plannedServings} onChange={(event) => change(draft.map((current, currentIndex) => currentIndex === index ? { ...current, plannedServings: Number(event.target.value), source: 'manual' } : current))} /></label>
                  <button className="remove-button" onClick={() => change(draft.filter((_current, currentIndex) => currentIndex !== index))}>移除</button>
                </article>
              ))}
            </div>
          )}
        </section>
        <section>
          <div className="feature-title"><span><b>候选补充</b><small>从菜池添加</small></span></div>
          {loadingCandidates && <LoadingState rows={3} />}
          {error && !dirty && <ErrorState message={error} onRetry={loadCandidates} />}
          {!loadingCandidates && availableCandidates.length === 0 ? <p className="scope-note">没有其他可加入候选。已跳过的食谱不会显示。</p> : (
            <div className="section-card compact-list">
              {availableCandidates.map((candidate) => <button className="feature-row" key={candidate.recipeId} onClick={() => addCandidate(candidate)}><span><b>{candidate.name}</b><small>{amount(candidate.servings)} 份 · {candidate.allVerified ? '营养已验证' : '营养含估算'}</small></span><strong>加入</strong></button>)}
            </div>
          )}
        </section>
        {dirty && <p className="unsaved-note" role="status">有未保存修改。离开页面前会再次确认。</p>}
        {error && dirty && <div className="save-error" role="alert"><b>保存失败</b><span>{error}</span></div>}
      </div>
      <div className="sticky-actions"><button className="primary-button" onClick={() => void save()} disabled={saving || !valid}>{saving ? '正在保存…' : '保存调整'}</button></div>
      <BottomNav active="采购" onChange={(tab) => leave(() => onTab(tab))} />
    </main>
  )
}
