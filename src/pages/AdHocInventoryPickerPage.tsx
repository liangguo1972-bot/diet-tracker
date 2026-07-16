import { useCallback, useEffect, useMemo, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { CookInventoryOption } from '../fr002-types'
import { amount, prettyDate } from '../lib/fr002'

export function AdHocInventoryPickerPage({ initial, onBack, onDone, onTab, onSessionExpired }: {
  initial: CookInventoryOption[]
  onBack: () => void
  onDone: (items: CookInventoryOption[]) => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<CookInventoryOption[]>([])
  const [selected, setSelected] = useState(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const selectedIds = useMemo(() => new Set(selected.map((item) => item.inventoryId)), [selected])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setItems(await fr002Adapter.searchCookInventory(query)) }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '库存选择器加载失败。')
    } finally { setLoading(false) }
  }, [onSessionExpired, query])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer) }, [load])
  const toggle = (item: CookInventoryOption) => setSelected((current) => selectedIds.has(item.inventoryId) ? current.filter((entry) => entry.inventoryId !== item.inventoryId) : [...current, item])

  return <main className="phone page cook-page adhoc-page">
    <div className="page-content with-action">
      <header className="topbar centered"><button className="back-button" onClick={onBack}>返回</button><h1>从库存选食材</h1><span /></header>
      <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索冰箱里的食材" />
      {selected.length > 0 && <div className="adhoc-selected" role="status"><b>已选 {selected.length} 项</b><span>{selected.map((item) => item.name).join('、')}</span></div>}
      {loading && <LoadingState rows={6} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && items.length === 0 && <EmptyState title={query ? '没有匹配库存' : '冰箱里还没有可用库存'} detail={query ? '换个关键词再试试。' : '先从采购或小票添加库存。'} />}
      {!loading && !error && items.length > 0 && <section className="section-card compact-list">
        <div className="section-heading"><span>冰箱库存</span><small>可多选</small></div>
        {items.map((item) => <button className={`feature-row ${selectedIds.has(item.inventoryId) ? 'selected-row' : ''}`} key={item.inventoryId} onClick={() => toggle(item)}>
          <span><b>{item.name}</b><small>可用 {amount(item.quantity)} {item.unit}{item.storage ? ` · ${item.storage}` : ''}{item.expiresOn ? ` · ${prettyDate(item.expiresOn)} 到期` : ''}</small><small>{item.ingredientId ? '已匹配食材' : '库存占位，不计入营养和菜谱'}</small></span><strong>{selectedIds.has(item.inventoryId) ? '已选' : '选择'}</strong>
        </button>)}
      </section>}
    </div>
    <div className="sticky-actions"><button className="primary-button" disabled={selected.length === 0} onClick={() => onDone(selected)}>添加后回到做饭页</button></div>
    <BottomNav active="厨房" onChange={onTab} />
  </main>
}
