import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { ErrorState, LoadingState } from '../components/Status'
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
type MealSlot = { mealType: TodayMeal['mealType']; meal: TodayMeal | null }
const fixedMealTypes: TodayMeal['mealType'][] = ['早午餐', '午餐', '晚餐', '加餐']
const mealSlots = (meals: TodayMeal[]) => {
  const fixedRows = fixedMealTypes.flatMap((mealType): MealSlot[] => {
    const matches = meals.filter((meal) => meal.mealType === mealType)
    return matches.length > 0 ? matches.map((meal) => ({ mealType, meal })) : [{ mealType, meal: null }]
  })
  const extraRows: MealSlot[] = meals.filter((meal) => !fixedMealTypes.includes(meal.mealType)).map((meal) => ({ mealType: meal.mealType, meal }))
  return [...extraRows, ...fixedRows]
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
        <header className="topbar today-header">
          <h1>记录</h1>
          <div className="today-header-actions">
            <div className="date-pill">{prettyDate(data?.date ?? dateKey())}</div>
            <button className="logout-button" onClick={signOut} disabled={signingOut}>{signingOut ? '退出中…' : '退出'}</button>
          </div>
        </header>
        {notice && <div className="success-banner" role="status">{notice}</div>}
        {authError && <div className="inline-error" role="alert">{authError}</div>}
        {loading && <LoadingState rows={5} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {data && !loading && !error && (
          <>
            <p className="goal-line">目标&nbsp; 蛋白 {data.target.protein === null ? '待设置' : `${amount(data.target.protein)}g（硬指标）`} &nbsp;·&nbsp; 热量 {data.target.kcal === null ? '待设置' : `${amount(data.target.kcal)} kcal（参考）`}</p>
            <article className="hero-card">
              <div className="hero-label-row">
                <span>蛋白 · 硬指标</span>
                <strong>{data.target.protein === null ? '目标待设置' : `还差 ${amount(Math.max(0, data.target.protein - data.total.protein))}g`}</strong>
              </div>
              <div className="hero-number"><b>{amount(data.total.protein)}</b><span>/ {data.target.protein === null ? '—' : amount(data.target.protein)} g</span></div>
              <div className="hero-track"><span style={{ width: percent(data.total.protein, data.target.protein) }} /></div>
              <p>{data.meals.length === 0 ? '还没有记录 · 从第一餐开始' : `已记 ${data.meals.length} 餐 · 营养汇总已更新`}</p>
            </article>
            <article className="stat-lime">
              <div className="stat-lime-main">
                <span>热量 · 参考</span>
                <div><b>{amount(data.total.kcal)}</b><small>/ {data.target.kcal === null ? '—' : amount(data.target.kcal)} kcal</small></div>
              </div>
              <div className="stat-lime-nutrients"><span>碳水 {amount(data.total.carb)}g</span><span>脂肪 {amount(data.total.fat)}g</span></div>
            </article>
            <section className="meal-section">
              <div className="section-heading"><span>各餐</span><small>点餐卡进编辑</small></div>
              <div className="meal-list">
                {mealSlots(data.meals).map(({ mealType, meal }) => meal ? (
                  <button className="meal-row" key={meal.id} onClick={() => onEditMeal(meal)}>
                    <span className="meal-dot" />
                    <span className="meal-copy"><b>{meal.mealType}</b><small>{mealSummary(meal) || meal.note || '已记录'}</small></span>
                    <span className="meal-kcal"><b>{amount(meal.nutrition.kcal)}</b><small>kcal</small></span>
                  </button>
                ) : (
                  <button className="meal-row empty" key={`empty-${mealType}`} onClick={onNewMeal}>
                    <span className="meal-dot" />
                    <span className="meal-copy"><b>{mealType}</b><small>未记录</small></span>
                    <span className="meal-add">＋</span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
      <BottomNav active="记录" onChange={onTab} />
    </main>
  )
}
