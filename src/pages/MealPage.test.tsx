// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MealComponentNotFoundError } from '../data/errors'
import { mealMutationAdapter } from '../data/meals'
import type { MealDraft } from '../types'
import { MealPage } from './MealPage'

vi.mock('../data/meals', () => ({
  mealMutationAdapter: {
    saveMeal: vi.fn(),
    updateMeal: vi.fn(),
  },
}))

const draft: MealDraft = {
  mealId: null,
  eatenOn: '2026-07-12',
  mealType: '早餐',
  note: '保留这段备注',
  items: [{
    sourceType: 'ingredient',
    sourceId: 'ingredient-1',
    name: '测试单品',
    subtitle: '单品',
    servingGrams: 50,
    availableServings: null,
    nutrition: { kcal: 60, protein: 6, carb: 5, fat: 2 },
    estimated: false,
    lastUsedOn: null,
    servings: 1,
  }],
}

const renderPage = (overrides: Partial<React.ComponentProps<typeof MealPage>> = {}) => {
  const props: React.ComponentProps<typeof MealPage> = {
    draft,
    onDraft: vi.fn(),
    onBack: vi.fn(),
    onPick: vi.fn(),
    onTab: vi.fn(),
    onSaved: vi.fn(),
    onMealMissing: vi.fn(),
    onSessionExpired: vi.fn(),
    ...overrides,
  }
  render(<MealPage {...props} />)
  return props
}

describe('MealPage save behavior', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('keeps the draft visible and does not auto retry after a network failure', async () => {
    vi.mocked(mealMutationAdapter.saveMeal).mockRejectedValueOnce(new Error('Network request failed'))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '保存这一餐' }))

    expect(await screen.findByText(/Network request failed.*草稿已保留/)).toBeTruthy()
    expect(screen.getByText('测试单品')).toBeTruthy()
    expect(screen.getByDisplayValue('保留这段备注')).toBeTruthy()
    expect(mealMutationAdapter.saveMeal).toHaveBeenCalledTimes(1)
  })

  it('allows only one in-flight save request', async () => {
    let resolveSave: ((value: { mealId: string }) => void) | undefined
    vi.mocked(mealMutationAdapter.saveMeal).mockImplementation(() => new Promise((resolve) => { resolveSave = resolve }))
    const props = renderPage()
    const button = screen.getByRole('button', { name: '保存这一餐' })

    fireEvent.click(button)
    fireEvent.click(button)

    expect(mealMutationAdapter.saveMeal).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: '正在保存…' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => resolveSave?.({ mealId: 'meal-1' }))
    expect(props.onSaved).toHaveBeenCalledWith('created')
  })

  it('asks the user to reselect an unavailable component', async () => {
    vi.mocked(mealMutationAdapter.saveMeal).mockRejectedValueOnce(new MealComponentNotFoundError())
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '保存这一餐' }))
    expect(await screen.findByText('所选成品或单品已不可用，请删除后重新选择。')).toBeTruthy()
    expect(screen.getByText('测试单品')).toBeTruthy()
  })
})
