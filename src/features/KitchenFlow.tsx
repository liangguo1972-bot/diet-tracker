import { useState } from 'react'
import type { MainTab } from '../components/BottomNav'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { CookDraft, CookInventoryOption, SavedCookSession, WeeklyPlanItem } from '../fr002-types'
import { amount, createCookDraft, localDateKey, setCookInventory } from '../lib/fr002'
import { CookInventoryPickerPage } from '../pages/CookInventoryPickerPage'
import { CookPage } from '../pages/CookPage'
import { InventoryPage } from '../pages/InventoryPage'
import { KitchenHomePage } from '../pages/KitchenHomePage'
import { SaveCookPage } from '../pages/SaveCookPage'
import { ReceiptImportPage } from '../pages/ReceiptImportPage'
import { ReceiptReviewPage } from '../pages/ReceiptReviewPage'

type KitchenScreen = 'home' | 'inventory' | 'cook' | 'picker' | 'save' | 'receipt-import' | 'receipt-review'
type PickerTarget = { ingredientId: string; ingredientName: string; usageIndex?: number }

export function KitchenFlow({ onTab, onSessionExpired }: {
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const [screen, setScreen] = useState<KitchenScreen>('home')
  const [cookTarget, setCookTarget] = useState<WeeklyPlanItem | null>(null)
  const [cookDraft, setCookDraft] = useState<CookDraft | null>(null)
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)
  const [cookLoading, setCookLoading] = useState(false)
  const [cookError, setCookError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [receiptImportId, setReceiptImportId] = useState<string | null>(null)

  async function loadCook(target: WeeklyPlanItem) {
    setCookTarget(target)
    setCookDraft(null)
    setCookError(null)
    setCookLoading(true)
    setScreen('cook')
    try {
      const preparation = await fr002Adapter.getCookPreparation(target.recipeId, target.id)
      setCookDraft(createCookDraft(preparation, localDateKey()))
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setCookError(reason instanceof Error ? reason.message : '做饭准备数据加载失败。')
    } finally { setCookLoading(false) }
  }

  function pickInventory(ingredientId: string, ingredientName: string, usageIndex?: number) {
    setPickerTarget({ ingredientId, ingredientName, usageIndex })
    setScreen('picker')
  }

  function selectInventory(option: CookInventoryOption) {
    if (!cookDraft || !pickerTarget) return
    setCookDraft(setCookInventory(cookDraft, pickerTarget.ingredientId, option, pickerTarget.usageIndex))
    setPickerTarget(null)
    setScreen('cook')
  }

  function saved(result: SavedCookSession) {
    setCookDraft(null)
    setCookTarget(null)
    setPickerTarget(null)
    setNotice(`${result.name} 已保存，共 ${amount(result.totalServings)} 份。记餐选择器将从远端重新读取。`)
    setRefreshKey((value) => value + 1)
    setScreen('home')
  }

  function changeTab(tab: MainTab) {
    if (tab === '厨房') {
      setScreen('home')
      return
    }
    if (cookDraft && (screen === 'cook' || screen === 'picker' || screen === 'save') && !window.confirm('当前做饭草稿尚未保存，确认离开吗？')) return
    if (screen === 'receipt-review' && !window.confirm('当前小票确认内容尚未入库，确认离开吗？')) return
    onTab(tab)
  }

  if (screen === 'inventory') return <InventoryPage refreshKey={refreshKey} notice={notice} onReceiptImport={() => { setNotice(null); setScreen('receipt-import') }} onBack={() => setScreen('home')} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'receipt-import') return <ReceiptImportPage onBack={() => setScreen('inventory')} onInventory={() => setScreen('inventory')} onReview={(id) => { setReceiptImportId(id); setScreen('receipt-review') }} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'receipt-review' && receiptImportId) return <ReceiptReviewPage receiptImportId={receiptImportId} onBack={() => setScreen('receipt-import')} onConfirmed={(count) => { setReceiptImportId(null); setNotice(`小票已确认，${count} 项库存已写入。`); setRefreshKey((value) => value + 1); setScreen('inventory') }} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'picker' && cookDraft && pickerTarget) {
    const ingredient = cookDraft.ingredients.find((item) => item.ingredientId === pickerTarget.ingredientId)
    return <CookInventoryPickerPage ingredientId={pickerTarget.ingredientId} ingredientName={pickerTarget.ingredientName} selectedIds={ingredient?.usages.map((usage) => usage.inventoryId) ?? []} onBack={() => setScreen('cook')} onSelect={selectInventory} onTab={changeTab} onSessionExpired={onSessionExpired} />
  }
  if (screen === 'save' && cookDraft) return <SaveCookPage draft={cookDraft} onDraft={setCookDraft} onBack={() => setScreen('cook')} onSaved={saved} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'cook') return <CookPage draft={cookDraft} loading={cookLoading} error={cookError} onRetry={() => { if (cookTarget) void loadCook(cookTarget) }} onDraft={setCookDraft} onPick={pickInventory} onBack={() => setScreen('home')} onContinue={() => setScreen('save')} onTab={changeTab} />
  return <KitchenHomePage refreshKey={refreshKey} notice={notice} onInventory={() => setScreen('inventory')} onReceiptImport={() => { setNotice(null); setScreen('receipt-import') }} onCook={(item) => { setNotice(null); void loadCook(item) }} onTab={changeTab} onSessionExpired={onSessionExpired} />
}
