import { BottomNav, type MainTab } from '../components/BottomNav'

export function PlaceholderPage({ tab, onTab }: { tab: Exclude<MainTab, '记录'>; onTab: (tab: MainTab) => void }) {
  return (
    <main className="phone page placeholder-page">
      <div className="page-content"><header className="topbar"><h1>{tab}</h1><span /></header><section className="placeholder-card"><span>{tab === '厨房' ? 'KITCHEN' : 'GROCERY'}</span><h2>第一版暂未开放</h2><p>{tab === '厨房' ? '库存、做饭和成品管理将在后续版本接入。' : '食谱计划和采购清单将在后续版本接入。'}</p></section></div>
      <BottomNav active={tab} onChange={onTab} />
    </main>
  )
}
