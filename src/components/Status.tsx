export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div className="status-card" aria-label="正在加载">
      <div className="skeleton wide" />
      {Array.from({ length: rows }, (_, index) => <div className="skeleton" key={index} />)}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="status-card error-card" role="alert">
      <strong>没有加载成功</strong>
      <p>{message}</p>
      {onRetry && <button className="text-button" onClick={onRetry}>重试</button>}
    </div>
  )
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="status-card empty-card">
      <span className="empty-mark">○</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  )
}
