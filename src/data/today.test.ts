import { describe, expect, it } from 'vitest'
import type { Json } from '../lib/database.types'
import { parseTodayData } from './today'

describe('parseTodayData', () => {
  it('parses empty data and nullable targets', () => {
    const result = parseTodayData({
      date: '2026-07-12',
      total: { kcal: 0, protein: 0, carb: 0, fat: 0 },
      target: { kcal: null, protein: null },
      meals: [],
    })
    expect(result.target).toEqual({ kcal: null, protein: null })
    expect(result.meals).toEqual([])
  })

  it('keeps notes, decimals, estimates and large nutrition values', () => {
    const input: Json = {
      date: '2026-07-12',
      total: { kcal: 12345.6, protein: 123.45, carb: 987.65, fat: 55.5 },
      target: { kcal: 1900, protein: 110 },
      meals: [{
        id: 'meal-1', mealType: '晚餐', note: '很长的备注',
        nutrition: { kcal: 12345.6, protein: 123.45, carb: 987.65, fat: 55.5 },
        items: [{
          id: 'item-1', sourceType: 'ingredient', sourceId: 'ingredient-1',
          name: '一个非常非常长的单品名称用于验证边界内容', servings: 0.25,
          nutrition: { kcal: 100.5, protein: 2.5, carb: 20.5, fat: 1.25 }, estimated: true,
        }],
      }],
    }
    const result = parseTodayData(input)
    expect(result.total.kcal).toBe(12345.6)
    expect(result.meals[0].note).toBe('很长的备注')
    expect(result.meals[0].items[0].servings).toBe(0.25)
    expect(result.meals[0].items[0].estimated).toBe(true)
  })

  it('rejects invalid meal types', () => {
    expect(() => parseTodayData({
      date: '2026-07-12', total: {}, target: {},
      meals: [{ id: 'x', mealType: '夜宵', nutrition: {}, items: [] }],
    })).toThrow('无效餐次')
  })
})
