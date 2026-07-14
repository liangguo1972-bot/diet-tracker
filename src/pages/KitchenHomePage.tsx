import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { fr002Adapter } from '../data/fr002'
import { isAuthenticationRequired } from '../data/errors'
import type { KitchenHomeData, WeeklyPlanItem } from '../fr002-types'
import { amount, localDateKey, prettyDate, weekday } from '../lib/fr002'

export function KitchenHomePage({ refreshKey, notice, onInventory, onCook, onTab, onSessionExpired }: {
  refreshKey: number
  notice: string | null
  onInventory: () => void
  onCook: (item: WeeklyPlanItem) => void
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

  return (
    <main className="phone page kitchen-page">
      <div className="page-content">
        <header className="topbar"><h1>厨房</h1><span className="date-note">{prettyDate(localDateKey())}</span></header>
        {notice && <div className="success-banner" role="status">{notice}</div>}
        {loading && <LoadingState rows={6} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {data && !loading && !error && (
          <>
            <section className="section-card feature-section">
              <div className="section-heading"><span>冰箱库存</span><button className="text-button neutral" onClick={onInventory}>查看全部</button></div>
              <button className="summary-grid" onClick={onInventory} aria-label="查看冰箱库存">
                <span><b>{data.inventorySummary.activeLots}</b><small>可用批次</small></span>
                <span><b>{data.inventorySummary.expiringLots}</b><small>两天内到期</small></span>
                <span><b>{data.inventorySummary.depletedLots}</b><small>已用尽</small></span>
              </button>
            </section>

            <section>
              <div className="feature-title"><span><b>本周食谱</b><small>点菜开始做</small></span></div>
              {!data.weeklyPlan || data.weeklyPlan.items.length === 0 ? (
                <EmptyState title="本周还没有食谱" detail="先去采购区抽取并确认本周食谱。" action={<button className="primary-button compact" onClick={() => onTab('采购')}>去规划食谱</button>} />
              ) : (
                <div className="section-card compact-list">
                  {data.weeklyPlan.items.map((item) => (
                    <button className="feature-row" key={item.id} onClick={() => onCook(item)}>
                      <span><small>{weekday(item.scheduledOn)} · {prettyDate(item.scheduledOn)}</small><b>{item.recipeName}</b><small>{amount(item.plannedServings)} 份 · {item.source === 'candidate_draw' ? '候选菜池抽取' : '手动安排'}</small></span>
                      <strong>开始做</strong>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="feature-title"><span><b>已做好</b><small>可用于记餐</small></span></div>
              {data.readyCookSessions.length === 0 ? (
                <EmptyState title="还没有可吃成品" detail="完成做饭并保存后，成品会出现在这里和记餐选择器中。" />
              ) : (
                <div className="section-card compact-list">
                  {data.readyCookSessions.map((item) => (
                    <div className="feature-row static" key={item.id}>
                      <span><b>{item.name}</b><small>{prettyDate(item.cookedOn)} 做好 · 剩余 {amount(item.availableServings)} 份</small></span>
                      <span className="status-chip success">可记餐</span>
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
