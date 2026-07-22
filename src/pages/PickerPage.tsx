import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { searchMealComponents } from '../data/components'
import { isAuthenticationRequired } from '../data/errors'
import type { DraftItem, SelectableItem } from '../types'

export function PickerPage({ kind, selectedItems, onBack, onAdd, onKindChange, onTab, onSessionExpired }: {
  kind: 'cook_session' | 'ingredient'
  selectedItems: DraftItem[]
  onBack: () => void
  onAdd: (item: SelectableItem) => void
  onKindChange: (kind: 'cook_session' | 'ingredient') => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [items, setItems] = useState<SelectableItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const title = kind === 'cook_session' ? '添加成品' : '添加单品'

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setItems(await searchMealComponents(kind, query)) }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '未知错误')
    }
    finally { setLoading(false) }
  }, [kind, onSessionExpired, query])

  useEffect(() => { void load() }, [load])

  const meta = (item: SelectableItem) => {
    const parts = [item.subtitle]
    if (item.availableServings !== null) parts.push(`可用 ${item.availableServings} 份`)
    if (item.servingGrams !== null) parts.push(`每份 ${item.servingGrams}g`)
    if (item.lastUsedOn) parts.push(`最近使用 ${item.lastUsedOn}`)
    if (item.estimated) parts.push('估')
    return parts.join(' · ')
  }

  return (
    <main className="phone page picker-page">
      <div className="page-content">
        <header className="topbar centered"><button className="back-button" onClick={onBack}>返回</button><h1>{title}</h1><span /></header>
        <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名称或关键词" autoFocus />
        <div className="picker-tabs"><button className={kind === 'cook_session' ? 'active' : ''} onClick={() => onKindChange('cook_session')}>成品</button><button className={kind === 'ingredient' ? 'active' : ''} onClick={() => onKindChange('ingredient')}>单品</button></div>
        {loading && <LoadingState rows={6} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && items.length === 0 && <EmptyState title={query ? '没有匹配项' : `还没有可选${kind === 'cook_session' ? '成品' : '单品'}`} detail={query ? '换个关键词再试试。' : kind === 'ingredient' ? '只有设置了标准份量的食材会显示。' : '做好且仍有剩余份数的成品会显示在这里。'} />}
        {!loading && !error && items.length > 0 && <section className="picker-section"><div className="section-heading"><span>{kind === 'cook_session' ? '可用成品' : '可添加单品'}</span><small>{items.length} 项</small></div><div className="picker-list">{items.map((item) => {
          const selected = selectedItems.find((draftItem) => draftItem.sourceType === item.sourceType && draftItem.sourceId === item.sourceId)
          return <button className="picker-row" key={item.sourceId} onClick={() => onAdd(item)}>{selected && <span className="meal-dot" />}<span className="picker-copy"><b>{item.name}</b><small>{meta(item)}</small></span><strong className={selected ? 'selected-count' : ''}>{selected ? `已加 ${selected.servings}` : '＋'}</strong></button>
        })}</div></section>}
      </div>
      <BottomNav active="记录" onChange={onTab} />
    </main>
  )
}
