import { useCallback, useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { InventoryLot } from '../fr002-types'
import { amount, purchaseAgeLabel } from '../lib/fr002'

const storageOrder = ['冷藏', '常温', '冷冻'] as const

export function purchaseAgeDays(date: string | null, today = new Date()): number | null {
  if (!date) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const purchaseDay = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const localToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(0, Math.round((localToday - purchaseDay) / 86_400_000))
}

function sortInventoryGroup(storage: string, items: InventoryLot[]): InventoryLot[] {
  if (storage === '冷冻') return items
  return [...items].sort((first, second) => {
    const firstAge = purchaseAgeDays(first.purchaseDate)
    const secondAge = purchaseAgeDays(second.purchaseDate)
    if (firstAge === null) return secondAge === null ? 0 : 1
    if (secondAge === null) return -1
    return secondAge - firstAge
  })
}

function purchaseAgeClass(item: InventoryLot): string | undefined {
  const days = purchaseAgeDays(item.purchaseDate)
  return item.storage !== '冷冻' && days !== null && days >= 5 ? 'aged' : undefined
}

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
  const [showDepleted, setShowDepleted] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setItems(await fr002Adapter.listInventory('')) }
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

  const activeItems = items.filter((item) => item.status === 'active')
  const depletedItems = items.filter((item) => item.status === 'depleted')
  const groups: Array<{ storage: string; items: InventoryLot[] }> = storageOrder.map((storage) => ({ storage, items: sortInventoryGroup(storage, activeItems.filter((item) => item.storage === storage)) }))
  const otherItems = activeItems.filter((item) => !storageOrder.includes(item.storage as typeof storageOrder[number]))
  if (otherItems.length > 0) groups.push({ storage: '未分类', items: sortInventoryGroup('未分类', otherItems) })

  return (
    <main className="phone page kitchen-page">
      <div className="page-content inventory-page-content">
        <header className="topbar inventory-header"><button className="back-button" onClick={onBack} aria-label="返回">←</button><h1>冰箱库存</h1></header>
        {notice && <div className="success-banner" role="status">{notice}</div>}
        {loading && <LoadingState rows={7} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && <section className="inventory-anchor"><span>批 · 常温冷藏放满 5 天已标记</span><div><b>{activeItems.length}</b><small>批库存</small></div><button onClick={onReceiptImport}>从小票添加库存</button></section>}
        {!loading && !error && activeItems.length === 0 && <EmptyState title="冰箱还是空的" detail="请从厨房上传购物小票并确认商品，库存会显示在这里。采购清单只用于参考，不会直接写入库存。" action={<button className="primary-button compact" onClick={onReceiptImport}>从小票添加库存</button>} />}
        {!loading && !error && activeItems.length > 0 && <>
          {groups.filter((group) => group.items.length > 0).map((group) => <section className="inventory-storage-group" key={group.storage}>
            <div className="section-heading"><span>{group.storage}</span><small>{group.items.length} 批</small></div>
            <div className="inventory-lot-list">{group.items.map((item) => <div className="inventory-lot" key={item.id}>
              <span><b>{item.name}</b><small className={purchaseAgeClass(item)}>{purchaseAgeLabel(item.purchaseDate)}</small></span>
              <strong><b>{amount(item.quantity)}</b><small>{item.unit}</small></strong>
            </div>)}</div>
          </section>)}
        </>}
        {!loading && !error && depletedItems.length > 0 && <section className="inventory-depleted">
          <button aria-expanded={showDepleted} onClick={() => setShowDepleted((current) => !current)}>已用尽 {depletedItems.length} 批 <span>{showDepleted ? '⌃' : '⌄'}</span></button>
          {showDepleted && <div className="inventory-lot-list">{depletedItems.map((item) => <div className="inventory-lot depleted" key={item.id}><span><b>{item.name}</b><small className={purchaseAgeClass(item)}>{purchaseAgeLabel(item.purchaseDate)}</small></span><strong><b>{amount(item.quantity)}</b><small>{item.unit}</small></strong></div>)}</div>}
        </section>}
      </div>
      <BottomNav active="厨房" onChange={onTab} />
    </main>
  )
}
