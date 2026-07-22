import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { addDraftItem, createDraftFromMeal, createInitialDraft } from './lib/draft'
import type { MainTab } from './components/BottomNav'
import { LoginPage } from './pages/LoginPage'
import { MealPage } from './pages/MealPage'
import { PickerPage } from './pages/PickerPage'
import { TodayPage } from './pages/TodayPage'
import { CandidatePoolPage } from './pages/CandidatePoolPage'
import { KitchenFlow } from './features/KitchenFlow'
import { PurchaseFlow } from './features/PurchaseFlow'
import type { MealDraft, SelectableItem, TodayMeal } from './types'

type Route = 'today' | 'meal' | 'cook-picker' | 'ingredient-picker' | 'kitchen' | 'grocery' | 'candidate-pool'
const today = () => new Date().toLocaleDateString('en-CA')
const initialDraft = (): MealDraft => createInitialDraft(today())

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [route, setRoute] = useState<Route>('today')
  const [draft, setDraft] = useState<MealDraft>(initialDraft)
  const [refreshKey, setRefreshKey] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return }
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) setAuthError('无法确认登录状态，请重新登录。')
      setSession(data.session)
      setAuthLoading(false)
    }).catch(() => { setAuthError('无法连接登录服务，请检查网络。'); setAuthLoading(false) })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (nextSession) setAuthError(null)
      else {
        setNotice(null)
        setDraft(initialDraft())
        setRoute('today')
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  function switchTab(tab: MainTab | 'candidate-pool') {
    setRoute(tab === '记录' ? 'today' : tab === '厨房' ? 'kitchen' : tab === 'candidate-pool' ? 'candidate-pool' : 'grocery')
  }

  function addItem(item: SelectableItem) {
    setDraft(addDraftItem(draft, item))
    setRoute('meal')
  }

  function startNewMeal() {
    setNotice(null)
    setDraft(initialDraft())
    setRoute('meal')
  }

  function editMeal(meal: TodayMeal) {
    setNotice(null)
    setDraft(createDraftFromMeal(meal, today()))
    setRoute('meal')
  }

  function saved(mode: 'created' | 'updated') {
    setDraft(initialDraft())
    setNotice(mode === 'created' ? '这一餐已保存。' : '这一餐已更新。')
    setRefreshKey((key) => key + 1)
    setRoute('today')
  }

  function mealMissing() {
    setDraft(initialDraft())
    setNotice('这餐已不存在，今日记录已重新加载。')
    setRefreshKey((key) => key + 1)
    setRoute('today')
  }

  async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) setAuthError(error.message)
  }

  function sessionExpired() {
    setAuthError('登录状态已失效，请重新登录。')
    setSession(null)
    setRoute('today')
    void supabase?.auth.signOut({ scope: 'local' })
  }

  if (authLoading) return <div className="app-loading">正在打开记录…</div>
  if (!session) return <LoginPage initialError={authError} />
  if (route === 'meal') return <MealPage draft={draft} onDraft={setDraft} onBack={() => setRoute('today')} onPick={(kind) => setRoute(kind === 'cook_session' ? 'cook-picker' : 'ingredient-picker')} onTab={switchTab} onSaved={saved} onMealMissing={mealMissing} onSessionExpired={sessionExpired} />
  if (route === 'cook-picker') return <PickerPage kind="cook_session" selectedItems={draft.items} onBack={() => setRoute('meal')} onAdd={addItem} onKindChange={(kind) => setRoute(kind === 'cook_session' ? 'cook-picker' : 'ingredient-picker')} onTab={switchTab} onSessionExpired={sessionExpired} />
  if (route === 'ingredient-picker') return <PickerPage kind="ingredient" selectedItems={draft.items} onBack={() => setRoute('meal')} onAdd={addItem} onKindChange={(kind) => setRoute(kind === 'cook_session' ? 'cook-picker' : 'ingredient-picker')} onTab={switchTab} onSessionExpired={sessionExpired} />
  if (route === 'kitchen') return <KitchenFlow onTab={switchTab} onSessionExpired={sessionExpired} />
  if (route === 'candidate-pool') return <CandidatePoolPage onBack={() => setRoute('grocery')} onTab={switchTab} onSessionExpired={sessionExpired} />
  if (route === 'grocery') return <PurchaseFlow onTab={switchTab} onSessionExpired={sessionExpired} />
  return <TodayPage refreshKey={refreshKey} notice={notice} authError={authError} onNewMeal={startNewMeal} onEditMeal={editMeal} onTab={switchTab} onSignOut={signOut} onSessionExpired={sessionExpired} />
}
