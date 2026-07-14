import { useRef, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { EmptyState } from '../components/Status'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { PlanStatus, ShoppingListData, WeeklyPlan, WeeklyPlanItem } from '../fr002-types'
import { amount, prettyDate, toWeeklyPlanInputs, weekday } from '../lib/fr002'

export function WeeklyPlanPage({ weekStart, planId, status, items, onBack, onEdit, onPlanSaved, onShopping, onTab, onSessionExpired }: {
  weekStart: string
  planId: string | null
  status: PlanStatus
  items: WeeklyPlanItem[]
  onBack: () => void
  onEdit: () => void
  onPlanSaved: (plan: WeeklyPlan) => void
  onShopping: (list: ShoppingListData) => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)

  async function confirmPlan() {
    if (savingRef.current || items.length === 0) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      let currentPlanId = planId
      if (!currentPlanId || status !== 'confirmed') {
        const saved = await fr002Adapter.saveWeeklyPlan(weekStart, toWeeklyPlanInputs(items), 'confirmed')
        if (!saved.plan) throw new Error('周计划没有保存成功。')
        currentPlanId = saved.plan.id
        onPlanSaved(saved.plan)
      }
      const existing = await fr002Adapter.getShoppingList(currentPlanId)
      const list = existing ?? await fr002Adapter.generateShoppingList(currentPlanId)
      onShopping(list)
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(reason instanceof Error ? reason.message : '食谱确认或采购清单生成失败。')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <main className="phone page grocery-detail-page">
      <div className="page-content with-action">
        <header className="topbar centered"><button className="back-button" onClick={onBack} disabled={saving}>返回</button><h1>本周食谱</h1><button className="text-button neutral" onClick={onEdit} disabled={saving}>编辑</button></header>
        <div className="plan-subtitle"><span>随机结果或已保存计划</span><span>可人工调整</span></div>
        {items.length === 0 ? <EmptyState title="本周食谱为空" detail="返回候选菜池抽取食谱后再继续。" /> : (
          <section className="section-card compact-list plan-list">
            {items.map((item) => <div className="feature-row static" key={item.id}><span><small>{weekday(item.scheduledOn)} · {prettyDate(item.scheduledOn)}</small><b>{item.recipeName}</b><small>{amount(item.plannedServings)} 份 · {item.source === 'candidate_draw' ? '候选菜池抽取' : '人工调整'}</small></span><span className="status-chip">{item.source === 'candidate_draw' ? '随机' : '手动'}</span></div>)}
          </section>
        )}
        <section className="section-card rule-card"><b>生成规则</b><p>库存不驱动随机抽取。确认食谱后，采购清单才会根据食谱参考克重和真实克重库存生成。</p></section>
        {error && <div className="save-error" role="alert"><b>没有完成</b><span>{error}</span><button className="text-button" onClick={() => void confirmPlan()}>重试</button></div>}
      </div>
      <div className="sticky-actions"><button className="primary-button" onClick={() => void confirmPlan()} disabled={saving || items.length === 0}>{saving ? '正在生成采购清单…' : '确认食谱并生成采购清单'}</button></div>
      <BottomNav active="采购" onChange={onTab} />
    </main>
  )
}
