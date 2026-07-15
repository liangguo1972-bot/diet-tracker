import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { InventoryLot } from '../fr002-types'
import { amount, prettyDate } from '../lib/fr002'

export function InventoryPage({ refreshKey, notice, onReceiptImport, onBack, onTab, onSessionExpired }: {
  refreshKey: number
  notice: string | null
  onReceiptImport: () => void
  onBack: () => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [items, setItems] = useState<InventoryLot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setItems(await fr002Adapter.listInventory('', 'active')) }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '库存加载失败。')
    }
    finally { setLoading(false) }
  }, [onSessionExpired])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 180)
    return () => window.clearTimeout(timer)
  }, [load, refreshKey])

  return (
    <main className="phone page kitchen-page">
      <div className="page-content">
        <header className="topbar centered"><button className="back-button" onClick={onBack}>返回</button><h1>冰箱库存</h1><span /></header>
        {notice && <div className="success-banner" role="status">{notice}</div>}
        {loading && <LoadingState rows={7} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && items.length === 0 && <EmptyState title="冰箱还是空的" detail="采购完成后，真实库存批次会显示在这里。" action={<button className="primary-button compact" onClick={() => onTab('采购')}>去采购</button>} />}
        {!loading && !error && items.length > 0 && (
          <section className="section-card compact-list">
            <div className="section-heading"><span>库存列表</span><small>按状态分组 · {items.length} 批</small></div>
            {items.map((item) => (
              <div className="feature-row static inventory-row" key={item.id}>
                <span><b>{item.name}</b><small>{amount(item.quantity)}{item.unit}{item.storage ? ` · ${item.storage}` : ''}{item.expiresOn ? ` · ${prettyDate(item.expiresOn)} 到期` : ''}</small></span>
                <span className="inventory-detail-label">{item.status === 'active' ? '详情' : '已用尽'}</span>
              </div>
            ))}
          </section>
        )}
        <button className="primary-button inventory-receipt-button" onClick={onReceiptImport}>从小票添加库存</button>
      </div>
      <BottomNav active="厨房" onChange={onTab} />
    </main>
  )
}
