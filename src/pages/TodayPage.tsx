import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired } from '../data/errors'
import { todayDataAdapter } from '../data/today'
import type { TodayData, TodayMeal } from '../types'

const dateKey = () => new Date().toLocaleDateString('en-CA')
const prettyDate = (date: string) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`))
const percent = (value: number, target: number | null) => target ? `${Math.min(100, (value / target) * 100)}%` : '0%'
const amount = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)
const mealSummary = (meal: TodayMeal) => {
  const firstItems = meal.items.slice(0, 2).map((item) => `${item.name}${item.estimated ? ' 估' : ''}`)
  return `${firstItems.join(' · ')}${meal.items.length > 2 ? ` · +${meal.items.length - 2}` : ''}`
}

export function TodayPage({ refreshKey, notice, authError, onNewMeal, onEditMeal, onTab, onSignOut, onSessionExpired }: {
  refreshKey: number
  notice: string | null
  authError: string | null
  onNewMeal: () => void
  onEditMeal: (meal: TodayMeal) => void
  onTab: (tab: MainTab) => void
  onSignOut: () => Promise<void>
  onSessionExpired: () => void
}) {
  const [data, setData] = useState<TodayData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setData(await todayDataAdapter.getToday(dateKey())) }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '未知错误')
    }
    finally { setLoading(false) }
  }, [onSessionExpired])

  useEffect(() => { void load() }, [load, refreshKey])

  async function signOut() {
    setSigningOut(true)
    try { await onSignOut() }
    finally { setSigningOut(false) }
  }

  return (
    <main className="phone page today-page">
      <div className="page-content">
        <header className="topbar"><h1>记录</h1><button className="logout-button" onClick={signOut} disabled={signingOut}>{signingOut ? '退出中…' : '退出'}</button></header>
        <div className="filter-row"><div className="today-label">今日</div><div className="date-pill">{prettyDate(dateKey())}</div></div>
        {notice && <div className="success-banner" role="status">{notice}</div>}
        {authError && <div className="inline-error" role="alert">{authError}</div>}
        {loading && <LoadingState rows={5} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {data && !loading && !error && (
          <>
            <p className="goal-line">目标：蛋白 {data.target.protein === null ? '待设置' : `${amount(data.target.protein)}g`} · 热量 {data.target.kcal === null ? '待设置' : `${amount(data.target.kcal)} kcal`}</p>
            <section className="metric-grid">
              <article className="metric-card dark"><small>蛋白</small><strong>{amount(data.total.protein)} / {data.target.protein === null ? '—' : amount(data.target.protein)}g</strong><i><span style={{ width: percent(data.total.protein, data.target.protein) }} /></i><small>{data.target.protein ? `还差 ${amount(Math.max(0, data.target.protein - data.total.protein))}g` : '目标待设置'}</small></article>
              <article className="metric-card"><small>热量</small><strong>{amount(data.total.kcal)} / {data.target.kcal === null ? '—' : amount(data.target.kcal)}</strong><i><span style={{ width: percent(data.total.kcal, data.target.kcal) }} /></i><small>已记 · {data.meals.length} 餐</small></article>
            </section>
            <p className="nutrient-line">碳水 {amount(data.total.carb)}g　脂肪 {amount(data.total.fat)}g</p>
            {data.meals.length === 0 ? (
              <EmptyState title="今天还没有记录" detail="从第一餐开始，营养汇总会自动出现在这里。" action={<button className="primary-button compact" onClick={onNewMeal}>记一餐</button>} />
            ) : (
              <section className="section-card meal-list">
                <div className="section-heading"><span>各餐</span><small>点击餐卡编辑</small></div>
                {data.meals.map((meal) => <button className="meal-row" key={meal.id} onClick={() => onEditMeal(meal)}><span className="meal-dot" /><span className="meal-copy"><b>{meal.mealType}</b><small>{mealSummary(meal) || meal.note || '已记录'}</small></span><b>约 {amount(meal.nutrition.kcal)} kcal</b></button>)}
                <button className="add-row" onClick={onNewMeal}>＋ 继续记一餐</button>
              </section>
            )}
          </>
        )}
      </div>
      <BottomNav active="记录" onChange={onTab} />
    </main>
  )
}
