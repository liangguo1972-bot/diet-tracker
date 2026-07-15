// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddRecipePage } from './AddRecipePage'

describe('AddRecipePage', () => {
  afterEach(cleanup)

  it('keeps unsupported actions visibly unavailable and allows a local draft', () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'ingredient-1') })
    render(<AddRecipePage onBack={vi.fn()} onTab={vi.fn()} />)
    expect((screen.getByRole('button', { name: /粘贴解析/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '保存菜谱' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('输入菜名'), { target: { value: '韩式辣炖牛肉' } })
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加食材' }))
    fireEvent.change(screen.getByLabelText('食材名称'), { target: { value: '牛肉' } })
    expect(screen.getByDisplayValue('韩式辣炖牛肉')).toBeTruthy()
    expect(screen.getByDisplayValue('牛肉')).toBeTruthy()
    vi.unstubAllGlobals()
  })
})
