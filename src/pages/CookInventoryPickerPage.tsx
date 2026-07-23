import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { CookInventoryOption } from '../fr002-types'
import { amount, prettyDate } from '../lib/fr002'

export function CookInventoryPickerPage({ ingredientId, ingredientName, selectedIds, onBack, onSelect, onTab, onSessionExpired }: {
  ingredientId: string
  ingredientName: string
  selectedIds: string[]
  onBack: () => void
  onSelect: (option: CookInventoryOption) => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<CookInventoryOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fr002Adapter.searchCookInventory(query)
      setItems(result.filter((item) => item.ingredientId === ingredientId || item.ingredientId === null))
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '库存选择器加载失败。')
    } finally { setLoading(false) }
  }, [ingredientId, onSessionExpired, query])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 180)
    return () => window.clearTimeout(timer)
  }, [load])

  return (
    <main className="phone page cook-page cook-picker-page cook-recipe-picker-page">
      <div className="page-content">
        <header className="topbar centered"><button className="back-button" onClick={onBack}>返回</button><h1>选择食材</h1><span /></header>
        <p className="selection-context">正在为“{ingredientName}”选择同一种食材的库存批次。</p>
        <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${ingredientName}库存`} autoFocus />
        {loading && <LoadingState rows={6} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && items.length === 0 && <EmptyState title={query ? '没有匹配库存' : `没有可用${ingredientName}`} detail={query ? '换个关键词再试试。' : '先完成采购，或返回调整本周食谱。'} />}
        {!loading && !error && items.length > 0 && (
          <section className="picker-section">
            <div className="section-heading"><span>库存可选</span><small>{items.length} 批</small></div>
            <div className="picker-list">
              {items.map((item) => {
                const selected = selectedIds.includes(item.inventoryId)
                return <button className={`picker-row cook-picker-row ${selected ? 'selected-row' : ''}`} key={item.inventoryId} disabled={selected} onClick={() => onSelect(item)}><span className="picker-copy"><b>{item.name}</b><small>{amount(item.quantity)} {item.unit}{item.storage ? ` · ${item.storage}` : ''}{item.expiresOn ? ` · ${prettyDate(item.expiresOn)} 到期` : ''}</small><small>{item.ingredientId === null ? '库存占位，可扣减但不计入营养' : item.hasTrustedGrams ? '有可信营养克重' : '只按相同量词扣减'}</small></span><strong>{selected ? '已选择' : '选择'}</strong></button>
              })}
            </div>
          </section>
        )}
      </div>
      <BottomNav active="厨房" onChange={onTab} />
    </main>
  )
}
