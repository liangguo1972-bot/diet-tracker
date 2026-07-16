import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { fr002Adapter } from '../data/fr002'
import { isAuthenticationRequired } from '../data/errors'
import type { KitchenHomeData, WeeklyPlanItem } from '../fr002-types'
import { addDays, amount, localDateKey, prettyDate, startOfWeek, weekday } from '../lib/fr002'

export function KitchenHomePage({ refreshKey, notice, onInventory, onCook, onAdHocCook, onResumeConfirmation, onTab, onSessionExpired }: {
  refreshKey: number
  notice: string | null
  onInventory: () => void
  onCook: (item: WeeklyPlanItem) => void
  onAdHocCook: () => void
  onResumeConfirmation: (cookSessionId: string) => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [data, setData] = useState<KitchenHomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setData(await fr002Adapter.getKitchenHome(localDateKey())) }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '厨房数据加载失败。')
    }
    finally { setLoading(false) }
  }, [onSessionExpired])

  useEffect(() => { void load() }, [load, refreshKey])
  const weekStart = startOfWeek(localDateKey())
  const monthDay = (date: string) => { const [, month, day] = date.split('-').map(Number); return `${month}月${day}日` }

  return (
    <main className="phone page kitchen-page">
      <div className="page-content">
        <header className="kitchen-home-title"><h1>厨房</h1></header>
        <div className="week-scope kitchen-week"><span>本周</span><b>{monthDay(weekStart)} - {monthDay(addDays(weekStart, 6))}</b></div>
        {notice && <div className="success-banner" role="status">{notice}</div>}
        {loading && <LoadingState rows={6} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {data && !loading && !error && (
          <>
            <section className="section-card kitchen-overview-card">
              <div className="section-heading"><span>冰箱库存</span><button className="text-button neutral" onClick={onInventory}>查看全部</button></div>
              <button className="inventory-chips" onClick={onInventory} aria-label="查看冰箱库存">
                <span className="urgent">临期 {data.inventorySummary.expiringLots}</span>
                <span>可用 {data.inventorySummary.activeLots}</span>
                <span>用尽 {data.inventorySummary.depletedLots}</span>
              </button>
              <button className="feature-row" onClick={onInventory}><span><b>查看库存列表</b><small>查看数量、存放位置和到期日</small></span><strong>详情</strong></button>
            </section>

            <section className="section-card kitchen-overview-card">
              <div className="section-heading"><span>本周食谱</span><small>点菜开始做</small></div>
              <button className="feature-row adhoc-entry" onClick={onAdHocCook}><span><b>无菜谱做饭</b><small>从冰箱选食材，随手做一锅</small></span><strong>开始</strong></button>
              {!data.weeklyPlan || data.weeklyPlan.items.length === 0 ? (
                <EmptyState title="本周还没有食谱" detail="先去采购区抽取并确认本周食谱。" action={<button className="primary-button compact" onClick={() => onTab('采购')}>去规划食谱</button>} />
              ) : (
                <div className="compact-list">
                  {data.weeklyPlan.items.map((item) => (
                    <button className="feature-row" key={item.id} onClick={() => onCook(item)}>
                      <span><b>{item.recipeName}</b><small>{weekday(item.scheduledOn)} · {item.source === 'candidate_draw' ? '本周计划' : '手动安排'} · {amount(item.plannedServings)} 份</small></span>
                      <strong>开始做</strong>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="section-card kitchen-overview-card">
              <div className="section-heading"><span>已做好</span><small>可用于记餐</small></div>
              {data.readyCookSessions.length === 0 ? (
                <EmptyState title="还没有可吃成品" detail="完成做饭并保存后，成品会出现在这里和记餐选择器中。" />
              ) : (
                <div className="compact-list">
                  {data.readyCookSessions.map((item) => (
                    <div className="feature-row static" key={item.id}>
                      <span><b>{item.name}</b><small>{prettyDate(item.cookedOn)} 做好 · 剩余 {amount(item.availableServings)} 份</small></span>
                      {item.recipeConfirmationStatus === 'pending' ? <button className="text-button" onClick={() => onResumeConfirmation(item.id)}>继续确认菜谱</button> : <span className="status-chip success">可记餐</span>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
      <BottomNav active="厨房" onChange={onTab} />
    </main>
  )
}
