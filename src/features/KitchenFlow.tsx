import { useState } from 'react'
import type { MainTab } from '../components/BottomNav'
import { isAuthenticationRequired } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { AdHocCookDraft, CookDraft, CookInventoryOption, SavedCookSession, SavedCookWithoutRecipe, WeeklyPlanItem } from '../fr002-types'
import { amount, createCookDraft, localDateKey, setCookInventory } from '../lib/fr002'
import { createAdHocCookDraft, mergeAdHocInventory } from '../lib/fr004'
import { AdHocCookPage } from '../pages/AdHocCookPage'
import { AdHocInventoryPickerPage } from '../pages/AdHocInventoryPickerPage'
import { AdHocSaveCookPage } from '../pages/AdHocSaveCookPage'
import { CookRecipeConfirmationPage } from '../pages/CookRecipeConfirmationPage'
import { CookInventoryPickerPage } from '../pages/CookInventoryPickerPage'
import { CookPage } from '../pages/CookPage'
import { InventoryPage } from '../pages/InventoryPage'
import { KitchenHomePage } from '../pages/KitchenHomePage'
import { SaveCookPage } from '../pages/SaveCookPage'
import { ReceiptImportPage } from '../pages/ReceiptImportPage'
import { ReceiptReviewPage } from '../pages/ReceiptReviewPage'

type KitchenScreen = 'home' | 'inventory' | 'cook' | 'picker' | 'save' | 'adhoc-picker' | 'adhoc-cook' | 'adhoc-save' | 'recipe-confirm' | 'receipt-import' | 'receipt-review'
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
  const [adHocDraft, setAdHocDraft] = useState<AdHocCookDraft | null>(null)
  const [confirmationId, setConfirmationId] = useState<string | null>(null)

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

  function startAdHocCook() {
    setNotice(null)
    setAdHocDraft(createAdHocCookDraft(localDateKey()))
    setScreen('adhoc-picker')
  }

  function savedAdHoc(result: SavedCookWithoutRecipe) {
    setConfirmationId(result.cookSessionId)
    setRefreshKey((value) => value + 1)
    setScreen('recipe-confirm')
  }

  function changeTab(tab: MainTab) {
    if (tab === '厨房') {
      setScreen('home')
      return
    }
    if (cookDraft && (screen === 'cook' || screen === 'picker' || screen === 'save') && !window.confirm('当前做饭草稿尚未保存，确认离开吗？')) return
    if (adHocDraft && (screen === 'adhoc-picker' || screen === 'adhoc-cook' || screen === 'adhoc-save') && !window.confirm('当前无菜谱做饭草稿尚未保存，确认离开吗？')) return
    if (screen === 'receipt-review' && !window.confirm('当前小票确认内容尚未入库，确认离开吗？')) return
    onTab(tab)
  }

  if (screen === 'inventory') return <InventoryPage refreshKey={refreshKey} notice={notice} onReceiptImport={() => { setNotice(null); setScreen('receipt-import') }} onBack={() => setScreen('home')} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'receipt-import') return <ReceiptImportPage onBack={() => setScreen('inventory')} onInventory={() => setScreen('inventory')} onReview={(id) => { setReceiptImportId(id); setScreen('receipt-review') }} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'receipt-review' && receiptImportId) return <ReceiptReviewPage receiptImportId={receiptImportId} onBack={() => setScreen('receipt-import')} onConfirmed={(count) => { setReceiptImportId(null); setNotice(`小票已确认，${count} 项已加入冰箱库存。你可以在这里查看并开始使用。`); setRefreshKey((value) => value + 1); setScreen('inventory') }} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'adhoc-picker' && adHocDraft) return <AdHocInventoryPickerPage initial={adHocDraft.items} onBack={() => adHocDraft.items.length ? setScreen('adhoc-cook') : setScreen('home')} onDone={(items) => { setAdHocDraft(mergeAdHocInventory(adHocDraft, items)); setScreen('adhoc-cook') }} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'adhoc-cook' && adHocDraft) return <AdHocCookPage draft={adHocDraft} onDraft={setAdHocDraft} onPick={() => setScreen('adhoc-picker')} onBack={() => setScreen('home')} onContinue={() => setScreen('adhoc-save')} onTab={changeTab} />
  if (screen === 'adhoc-save' && adHocDraft) return <AdHocSaveCookPage draft={adHocDraft} onBack={() => setScreen('adhoc-cook')} onSaved={savedAdHoc} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'recipe-confirm' && confirmationId) return <CookRecipeConfirmationPage cookSessionId={confirmationId} onBack={() => { setNotice('成品已保存。菜谱仍待确认，可从“已做好”继续。'); setAdHocDraft(null); setConfirmationId(null); setRefreshKey((value) => value + 1); setScreen('home') }} onConfirmed={(result) => { setNotice(`${result.name} 已加入候选菜池，成品可直接用于记餐。`); setAdHocDraft(null); setConfirmationId(null); setRefreshKey((value) => value + 1); setScreen('home') }} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'picker' && cookDraft && pickerTarget) {
    const ingredient = cookDraft.ingredients.find((item) => item.ingredientId === pickerTarget.ingredientId)
    return <CookInventoryPickerPage ingredientId={pickerTarget.ingredientId} ingredientName={pickerTarget.ingredientName} selectedIds={ingredient?.usages.map((usage) => usage.inventoryId) ?? []} onBack={() => setScreen('cook')} onSelect={selectInventory} onTab={changeTab} onSessionExpired={onSessionExpired} />
  }
  if (screen === 'save' && cookDraft) return <SaveCookPage draft={cookDraft} onDraft={setCookDraft} onBack={() => setScreen('cook')} onSaved={saved} onTab={changeTab} onSessionExpired={onSessionExpired} />
  if (screen === 'cook') return <CookPage draft={cookDraft} loading={cookLoading} error={cookError} onRetry={() => { if (cookTarget) void loadCook(cookTarget) }} onDraft={setCookDraft} onPick={pickInventory} onBack={() => setScreen('home')} onContinue={() => setScreen('save')} onTab={changeTab} />
  return <KitchenHomePage refreshKey={refreshKey} notice={notice} onInventory={() => setScreen('inventory')} onCook={(item) => { setNotice(null); void loadCook(item) }} onAdHocCook={startAdHocCook} onResumeConfirmation={(id) => { setNotice(null); setConfirmationId(id); setScreen('recipe-confirm') }} onTab={changeTab} onSessionExpired={onSessionExpired} />
}
