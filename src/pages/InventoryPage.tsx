import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { InventoryLot, InventoryStatus } from '../fr002-types'
import { amount, prettyDate } from '../lib/fr002'

const filters: Array<{ value: InventoryStatus | undefined; label: string }> = [
  { value: undefined, label: '全部' },
  { value: 'active', label: '可用' },
  { value: 'depleted', label: '已用尽' },
]

export function InventoryPage({ refreshKey, notice, onReceiptImport, onBack, onTab, onSessionExpired }: {
  refreshKey: number
  notice: string | null
  onReceiptImport: () => void
  onBack: () => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [items, setItems] = useState<InventoryLot[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<InventoryStatus | undefined>('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setItems(await fr002Adapter.listInventory(query, status)) }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '库存加载失败。')
    }
    finally { setLoading(false) }
  }, [onSessionExpired, query, status])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 180)
    return () => window.clearTimeout(timer)
  }, [load, refreshKey])

  return (
    <main className="phone page kitchen-page">
      <div className="page-content">
        <header className="topbar centered"><button className="back-button" onClick={onBack}>返回</button><h1>冰箱库存</h1><span /></header>
        {notice && <div className="success-banner" role="status">{notice}</div>}
        <section className="section-card receipt-entry-card">
          <div><span className="eyebrow-label">更新库存</span><h2>从小票添加库存</h2><p>拍照识别商品，确认后再写入库存。</p></div>
          <button className="primary-button" onClick={onReceiptImport}>拍照扫描小票</button>
          <button className="secondary-button wide" disabled>导入 PDF · 尚未开放</button>
        </section>
        <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索库存名称" />
        <div className="filter-chips" aria-label="库存状态筛选">
          {filters.map((filter) => <button key={filter.label} className={status === filter.value ? 'active' : ''} onClick={() => setStatus(filter.value)}>{filter.label}</button>)}
        </div>
        {loading && <LoadingState rows={7} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && items.length === 0 && <EmptyState title={query ? '没有匹配库存' : status === 'active' ? '冰箱还是空的' : '没有已用尽批次'} detail={query ? '换个关键词或筛选条件。' : status === 'active' ? '采购完成后，真实库存批次会显示在这里。' : '用完的库存批次会保留在这里供查看。'} action={status === 'active' && !query ? <button className="primary-button compact" onClick={() => onTab('采购')}>去采购</button> : undefined} />}
        {!loading && !error && items.length > 0 && (
          <section className="section-card compact-list">
            <div className="section-heading"><span>库存列表</span><small>{items.length} 批</small></div>
            {items.map((item) => (
              <div className="feature-row static inventory-row" key={item.id}>
                <span><b>{item.name}</b><small>{amount(item.quantity)} {item.unit}{item.storage ? ` · ${item.storage}` : ''}{item.expiresOn ? ` · ${prettyDate(item.expiresOn)} 到期` : ''}</small><small>{item.hasTrustedGrams ? '有可信营养克重' : '只按相同量词扣减'}</small></span>
                <span className={`status-chip ${item.status === 'active' ? 'success' : ''}`}>{item.status === 'active' ? '可用' : '已用尽'}</span>
              </div>
            ))}
          </section>
        )}
        <p className="scope-note">未匹配商品会显示为库存占位。它可以用于做饭扣减，但不会进入记餐单品选择器。</p>
      </div>
      <BottomNav active="厨房" onChange={onTab} />
    </main>
  )
}
