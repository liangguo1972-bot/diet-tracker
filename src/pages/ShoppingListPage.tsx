import { useCallback, useEffect, useMemo, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState, ErrorState, LoadingState } from '../components/Status'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { ShoppingListData } from '../fr002-types'
import { amount } from '../lib/fr002'

const initiallyChecked = (list: ShoppingListData | null) => new Set(
  list?.items.filter((item) => item.status === 'completed').map((item) => item.id) ?? [],
)

export function ShoppingListPage({ planId, initialList, onBack, onTab, onSessionExpired }: {
  planId: string
  initialList: ShoppingListData | null
  onBack: () => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [list, setList] = useState<ShoppingListData | null>(initialList)
  const [checkedIds, setCheckedIds] = useState(() => initiallyChecked(initialList))
  const [loading, setLoading] = useState(!initialList)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fr002Adapter.getShoppingList(planId)
      setList(result)
      setCheckedIds(initiallyChecked(result))
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '采购清单加载失败。')
    } finally { setLoading(false) }
  }, [onSessionExpired, planId])

  useEffect(() => { void load() }, [load])

  const purchasableItems = useMemo(() => list?.items.filter((item) => item.toPurchaseGrams > 0) ?? [], [list])
  const checkedCount = purchasableItems.filter((item) => checkedIds.has(item.id)).length

  function toggleItem(itemId: string) {
    setCheckedIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  async function copyList() {
    if (!list) return
    const text = purchasableItems.map((item) => `${item.name} 建议 ${amount(item.toPurchaseGrams)}g`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setError(null)
      setNotice('采购清单已复制。')
    } catch {
      setNotice(null)
      setError('浏览器没有允许复制，请手动选择清单内容。')
    }
  }

  return (
    <main className="phone page grocery-page shopping-list-page">
      <div className="page-content shopping-list-content">
        <header className="topbar centered"><button className="back-button" onClick={onBack}>返回</button><h1>采购清单</h1><button className="text-button neutral" onClick={() => void copyList()} disabled={!list || loading || purchasableItems.length === 0}>复制</button></header>
        {notice && <div className="success-banner" role="status">{notice}</div>}
        {loading && <LoadingState rows={7} />}
        {error && !list && <ErrorState message={error} onRetry={load} />}
        {!loading && !list && <EmptyState title="还没有采购清单" detail="确认本周食谱并成功生成后再查看。" />}
        {list && !loading && (
          <>
            <section className="shopping-guide" aria-label="采购清单说明">
              <div><span>本周参考</span><strong>{checkedCount} / {purchasableItems.length} 已勾选</strong></div>
              <p>按需要购买即可，不要求完全照单。实际购买后，请到厨房使用小票照片导入库存。</p>
              <button className="text-button" onClick={() => onTab('厨房')}>去厨房导入小票</button>
            </section>
            <section className="shopping-stack" aria-label="参考采购项目">
              {list.items.map((item) => {
                const covered = item.toPurchaseGrams <= 0
                const checked = covered || checkedIds.has(item.id)
                return (
                  <article className={`section-card shopping-card ${checked ? 'completed' : ''}`} key={item.id}>
                    <label className={`shopping-check-row ${covered ? 'covered' : ''}`}>
                      <input type="checkbox" checked={checked} disabled={covered} onChange={() => toggleItem(item.id)} aria-label={`${item.name}已购买`} />
                      <span className="shopping-checkmark" aria-hidden="true">{checked ? '✓' : ''}</span>
                      <span className="shopping-item-copy"><b>{item.name}</b><strong>{covered ? '库存已覆盖' : `建议 ${amount(item.toPurchaseGrams)}g`}</strong></span>
                      <span className={`status-chip ${checked ? 'success' : ''}`}>{covered ? '无需购买' : checked ? '已勾选' : '待购买'}</span>
                    </label>
                  </article>
                )
              })}
            </section>
            {purchasableItems.length === 0 && <EmptyState title="库存已经覆盖清单" detail="本周没有需要额外购买的食材。" />}
            <p className="shopping-session-note">勾选只帮助本次查看，不会写入库存或改变采购清单数据。</p>
          </>
        )}
        {error && list && <div className="save-error" role="alert"><b>暂时无法完成操作</b><span>{error}</span></div>}
      </div>
      <BottomNav active="采购" onChange={onTab} />
    </main>
  )
}
