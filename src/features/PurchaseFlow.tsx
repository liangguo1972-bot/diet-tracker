import { useState } from 'react'
import type { MainTab } from '../components/BottomNav'
import type { DrawnRecipe, PlanStatus, ShoppingListData, WeeklyPlan, WeeklyPlanItem } from '../fr002-types'
import { createDrawnPlan, localDateKey, startOfWeek } from '../lib/fr002'
import { EditWeeklyPlanPage } from '../pages/EditWeeklyPlanPage'
import { RecipeCandidatesPage } from '../pages/RecipeCandidatesPage'
import { ShoppingListPage } from '../pages/ShoppingListPage'
import { WeeklyPlanPage } from '../pages/WeeklyPlanPage'

type PurchaseScreen = 'candidates' | 'plan' | 'edit' | 'shopping'

export function PurchaseFlow({ onTab, onSessionExpired }: {
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [screen, setScreen] = useState<PurchaseScreen>('candidates')
  const [weekStart] = useState(() => startOfWeek(localDateKey()))
  const [planId, setPlanId] = useState<string | null>(null)
  const [planStatus, setPlanStatus] = useState<PlanStatus>('draft')
  const [items, setItems] = useState<WeeklyPlanItem[]>([])
  const [shoppingList, setShoppingList] = useState<ShoppingListData | null>(null)

  function usePlan(plan: WeeklyPlan) {
    setPlanId(plan.id)
    setPlanStatus(plan.status)
    setItems(plan.items)
    setScreen('plan')
  }

  function useDraw(recipes: DrawnRecipe[]) {
    setPlanId(null)
    setPlanStatus('draft')
    setItems(createDrawnPlan(recipes, weekStart))
    setShoppingList(null)
    setScreen('plan')
  }

  function showShopping(list: ShoppingListData) {
    setShoppingList(list)
    setPlanId(list.weeklyPlanId)
    setScreen('shopping')
  }

  function changeTab(tab: MainTab) {
    if (tab === '采购') {
      setScreen('candidates')
      return
    }
    onTab(tab)
  }

  if (screen === 'edit') return <EditWeeklyPlanPage weekStart={weekStart} items={items} onBack={() => setScreen('plan')} onSaved={usePlan} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'shopping' && planId) return <ShoppingListPage planId={planId} initialList={shoppingList} onBack={() => setScreen('plan')} onDone={() => onTab('厨房')} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'plan') return <WeeklyPlanPage weekStart={weekStart} planId={planId} status={planStatus} items={items} onBack={() => setScreen('candidates')} onEdit={() => setScreen('edit')} onPlanSaved={usePlan} onShopping={showShopping} onTab={changeTab} onSessionExpired={onSessionExpired} />
  return <RecipeCandidatesPage weekStart={weekStart} onDrawn={useDraw} onPlan={usePlan} onTab={changeTab} onSessionExpired={onSessionExpired} />
}
