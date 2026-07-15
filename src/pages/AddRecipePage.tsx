import { useEffect, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'

type DraftIngredient = { id: string; name: string; quantity: string; unit: string }

export function AddRecipePage({ onBack, onTab }: { onBack: () => void; onTab: (tab: MainTab) => void }) {
  const [name, setName] = useState('')
  const [ingredients, setIngredients] = useState<DraftIngredient[]>([])
  const [destination, setDestination] = useState<'候选菜池' | '直接加入本周'>('候选菜池')
  const dirty = Boolean(name || ingredients.length)

  useEffect(() => {
    if (!dirty) return
    const protectDraft = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', protectDraft)
    return () => window.removeEventListener('beforeunload', protectDraft)
  }, [dirty])

  function leave() {
    if (dirty && !window.confirm('当前菜谱草稿尚未保存，确认离开吗？')) return
    onBack()
  }

  function addIngredient() {
    setIngredients((current) => [...current, { id: crypto.randomUUID(), name: '', quantity: '', unit: '' }])
  }

  function editIngredient(id: string, change: Partial<DraftIngredient>) {
    setIngredients((current) => current.map((item) => item.id === id ? { ...item, ...change } : item))
  }

  return <main className="phone page grocery-detail-page">
    <div className="page-content with-action add-recipe-content">
      <header className="topbar centered"><button className="back-button" onClick={leave}>返回</button><h1>添加菜谱</h1><span className="date-note">草稿</span></header>
      <section className="section-card recipe-form-card"><div className="section-heading"><span>添加方式</span></div><div className="recipe-mode"><button className="active">手动新建</button><button disabled>粘贴解析 · 未开放</button></div></section>
      <section className="section-card recipe-form-card"><div className="section-heading"><span>菜谱信息</span></div><label>菜名<input value={name} onChange={(event) => setName(event.target.value)} placeholder="输入菜名" /></label></section>
      <section className="section-card recipe-form-card"><div className="section-heading"><span>食材列表</span><small>用于采购和库存</small></div>{ingredients.map((item) => <div className="recipe-ingredient-row" key={item.id}><input aria-label="食材名称" value={item.name} onChange={(event) => editIngredient(item.id, { name: event.target.value })} placeholder="食材" /><input aria-label="食材数量" value={item.quantity} onChange={(event) => editIngredient(item.id, { quantity: event.target.value })} inputMode="decimal" placeholder="数量" /><input aria-label="食材量词" value={item.unit} onChange={(event) => editIngredient(item.id, { unit: event.target.value })} placeholder="量词" /><button className="remove-button" onClick={() => setIngredients((current) => current.filter((entry) => entry.id !== item.id))}>删除</button></div>)}<button className="add-inline recipe-add-button" onClick={addIngredient}>＋ 添加食材</button></section>
      <section className="section-card recipe-form-card"><div className="section-heading"><span>加入位置</span></div><div className="recipe-mode"><button className={destination === '候选菜池' ? 'active' : ''} onClick={() => setDestination('候选菜池')}>候选菜池</button><button className={destination === '直接加入本周' ? 'active' : ''} onClick={() => setDestination('直接加入本周')}>直接加入本周</button></div></section>
      <p className="scope-note">菜谱创建和加入位置的后端能力尚未支持。当前内容只保留在本页面，刷新或离开后不会保存。</p>
    </div>
    <div className="sticky-actions"><small className="save-hint">等待后端支持真实保存</small><button className="primary-button" disabled>保存菜谱</button></div>
    <BottomNav active="采购" onChange={onTab} />
  </main>
}
