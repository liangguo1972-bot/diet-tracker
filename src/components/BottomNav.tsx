export type MainTab = '记录' | '厨房' | '采购'

export function BottomNav({ active, onChange }: { active: MainTab; onChange: (tab: MainTab) => void }) {
  const tabs: MainTab[] = ['记录', '厨房', '采购']
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {tabs.map((tab) => (
        <button key={tab} className={active === tab ? 'nav-item active' : 'nav-item'} onClick={() => onChange(tab)}>
          {active === tab && <span className="nav-dot" />}
          {tab}
        </button>
      ))}
    </nav>
  )
}
