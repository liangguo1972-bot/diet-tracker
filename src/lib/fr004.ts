import type { AdHocCookDraft, AdHocCookItemDraft, CookInventoryOption, SaveCookWithoutRecipeInput } from '../fr002-types'

export function createAdHocCookDraft(cookedOn: string): AdHocCookDraft {
  return { name: '', cookedOn, totalServings: 1, note: '', items: [] }
}

export function mergeAdHocInventory(draft: AdHocCookDraft, selected: CookInventoryOption[]): AdHocCookDraft {
  const existing = new Map(draft.items.map((item) => [item.inventoryId, item]))
  return {
    ...draft,
    items: selected.map((item): AdHocCookItemDraft => existing.get(item.inventoryId) ?? {
      ...item,
      quantityUsed: null,
      grams: null,
      note: '',
    }),
  }
}

export function isAdHocCookDraftComplete(draft: AdHocCookDraft): boolean {
  const matched = draft.items.filter((item) => item.ingredientId !== null)
  return Boolean(draft.name.trim()) && draft.name.trim().length <= 120 && draft.totalServings > 0 && matched.length > 0 && draft.items.every((item) => (
    item.quantityUsed !== null && item.quantityUsed > 0 && item.quantityUsed <= item.quantity
    && (item.ingredientId === null || (item.grams !== null && item.grams > 0))
  ))
}

export function toSaveCookWithoutRecipeInput(draft: AdHocCookDraft): SaveCookWithoutRecipeInput {
  return {
    name: draft.name.trim(), cookedOn: draft.cookedOn, totalServings: draft.totalServings, note: draft.note.trim(),
    items: draft.items.filter((item) => item.ingredientId !== null).map((item) => ({
      inventoryId: item.inventoryId, ingredientId: item.ingredientId!, quantityUsed: item.quantityUsed!, unit: item.unit, grams: item.grams!, note: item.note.trim(),
    })),
    unmatchedItems: draft.items.filter((item) => item.ingredientId === null).map((item) => ({
      inventoryId: item.inventoryId, quantityUsed: item.quantityUsed!, unit: item.unit, note: item.note.trim(),
    })),
  }
}
