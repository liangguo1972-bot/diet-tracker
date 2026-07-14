// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Fr002Error } from '../data/errors'
import { fr002Adapter } from '../data/fr002'
import type { CookDraft, SavedCookSession } from '../fr002-types'
import { SaveCookPage } from './SaveCookPage'

vi.mock('../data/fr002', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/fr002')>()
  return {
    ...original,
    fr002Adapter: {
      ...original.fr002Adapter,
      saveCookSession: vi.fn(),
      getOperationResult: vi.fn(),
    },
  }
})

const draft: CookDraft = {
  recipeId: 'recipe-1', recipeName: '测试食谱', recipeServings: 2, planItemId: 'plan-item-1',
  cookedOn: '2026-07-13', name: '测试成品', totalServings: 2, note: '草稿备注',
  ingredients: [{
    ingredientId: 'ingredient-1', name: '牛肉', referenceGrams: 200, availableGrams: 500, availabilityStatus: 'ready',
    usages: [{ inventoryId: 'lot-1', ingredientId: 'ingredient-1', name: '牛肉', quantity: 500, unit: 'g', unitKind: 'weight', gramsPerUnit: 1, storage: '冷冻', expiresOn: null, hasTrustedGrams: true, quantityUsed: 200, note: '' }],
  }],
}

const saved: SavedCookSession = {
  cookSessionId: 'cook-1', name: '测试成品', cookedOn: '2026-07-13', totalServings: 2,
  nutrition: { kcal: 500, protein: 40, carb: 20, fat: 15, estimated: false },
}

const renderPage = () => {
  const props: React.ComponentProps<typeof SaveCookPage> = {
    draft,
    onDraft: vi.fn(),
    onBack: vi.fn(),
    onSaved: vi.fn(),
    onTab: vi.fn(),
    onSessionExpired: vi.fn(),
  }
  render(<SaveCookPage {...props} />)
  return props
}

describe('SaveCookPage idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '11111111-1111-4111-8111-111111111111') })
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('keeps the draft and checks the original operation key after a network-unknown result', async () => {
    vi.mocked(fr002Adapter.saveCookSession).mockRejectedValueOnce(new Fr002Error('NETWORK_UNKNOWN'))
    vi.mocked(fr002Adapter.getOperationResult).mockResolvedValueOnce({ status: 'succeeded', response: saved })
    const props = renderPage()

    fireEvent.click(screen.getByRole('button', { name: '保存为成品' }))
    expect(await screen.findByText(/服务端结果暂时未知/)).toBeTruthy()
    expect(screen.getByDisplayValue('草稿备注')).toBeTruthy()
    expect(fr002Adapter.saveCookSession).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '确认服务端结果' }))
    await act(async () => undefined)
    expect(fr002Adapter.getOperationResult).toHaveBeenCalledWith('save_cook_session', '11111111-1111-4111-8111-111111111111', expect.any(Function))
    expect(props.onSaved).toHaveBeenCalledWith(saved)
  })

  it('allows only one in-flight save request', async () => {
    let resolveSave: ((value: SavedCookSession) => void) | undefined
    vi.mocked(fr002Adapter.saveCookSession).mockImplementation(() => new Promise((resolve) => { resolveSave = resolve }))
    const props = renderPage()
    const button = screen.getByRole('button', { name: '保存为成品' })

    fireEvent.click(button)
    fireEvent.click(button)
    expect(fr002Adapter.saveCookSession).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: '正在保存…' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => resolveSave?.(saved))
    expect(props.onSaved).toHaveBeenCalledWith(saved)
  })
})
