import { useCallback, useEffect, useRef, useState } from 'react'
import { BottomNav, type MainTab } from '../components/BottomNav'
import { isAuthenticationRequired } from '../data/errors'
import { fileSha256, receiptAdapter } from '../data/receipts'
import type { ReceiptImport, ReceiptImportSummary } from '../receipt-types'

const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp']
const historyStatus: Record<ReceiptImportSummary['status'], string> = { uploaded: '待识别', processing: '识别中', ready_for_review: '待确认', failed: '识别失败', confirmed: '已入库', cancelled: '已取消' }

function recognitionMessage(receipt: ReceiptImport): string {
  if (receipt.errorCode === 'OCR_NOT_CONFIGURED') return '识别服务尚未配置，照片已保留，稍后可重试。'
  if (receipt.errorCode === 'OCR_UNAVAILABLE') return '识别服务暂时不可用，照片已保留，稍后可重试。'
  if (receipt.errorCode === 'OCR_RESPONSE_INVALID') return '识别结果暂时无法读取，照片已保留，稍后可重试。'
  if (receipt.errorCode === 'RECEIPT_FILE_UNAVAILABLE') return '照片暂时无法读取，导入记录已保留。请重新选择原照片后重试。'
  return '小票识别失败，照片已保留，稍后可重试。'
}

const recognitionConnectionMessage = '暂时无法连接识别服务，照片已保留，稍后可重试。'

export function ReceiptImportPage({ onBack, onReview, onInventory, onTab, onSessionExpired }: {
  onBack: () => void
  onReview: (receiptImportId: string) => void
  onInventory: () => void
  onTab: (tab: MainTab) => void
  onSessionExpired: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const activeRef = useRef(false)
  const [file, setFile] = useState<File | null>(null)
  const [receipt, setReceipt] = useState<ReceiptImport | null>(null)
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'recognizing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<ReceiptImportSummary[]>([])
  const [recentLoading, setRecentLoading] = useState(true)
  const [recentError, setRecentError] = useState<string | null>(null)

  const busy = phase !== 'idle'

  const loadRecent = useCallback(async () => {
    setRecentLoading(true)
    setRecentError(null)
    try { setRecent(await receiptAdapter.list(5)) }
    catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setRecentError('最近导入记录加载失败。')
    } finally { setRecentLoading(false) }
  }, [onSessionExpired])

  useEffect(() => { void loadRecent() }, [loadRecent])

  function showReceiptResult(result: ReceiptImport) {
    setReceipt(result)
    if (result.status === 'ready_for_review' && result.items.length > 0) {
      onReview(result.receiptImportId)
      return
    }
    if (result.status === 'ready_for_review') {
      setError('没有识别到可确认的商品，照片已保留，稍后可重试。')
    } else if (result.status === 'failed') {
      setError(recognitionMessage(result))
    } else if (result.status === 'processing') {
      setError('小票仍在识别中，请稍后刷新最近导入。')
    } else {
      setError(recognitionConnectionMessage)
    }
  }

  async function recoverImport(receiptImportId: string, fallbackMessage = recognitionConnectionMessage) {
    try {
      const current = await receiptAdapter.get(receiptImportId)
      if (current.status === 'failed' || current.status === 'ready_for_review' || current.status === 'processing') showReceiptResult(current)
      else {
        setReceipt(current)
        setError(fallbackMessage)
      }
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else setError(fallbackMessage)
    } finally {
      await loadRecent()
    }
  }

  async function start(selected: File | null = file) {
    if (!selected || activeRef.current) return
    if (!acceptedTypes.includes(selected.type) || selected.size <= 0 || selected.size > 10 * 1024 * 1024) {
      setError('请选择 10MB 以内的 JPEG、PNG 或 WebP 照片。')
      return
    }
    activeRef.current = true
    setFile(selected)
    setError(null)
    setPhase('uploading')
    let receiptImportId: string | null = null
    let uploaded = false
    try {
      const created = await receiptAdapter.create(selected, await fileSha256(selected))
      receiptImportId = created.receiptImportId
      await loadRecent()
      if (created.status === 'ready_for_review') return await recoverImport(created.receiptImportId)
      if (created.status === 'confirmed') {
        setReceipt(await receiptAdapter.get(created.receiptImportId))
        return
      }
      await receiptAdapter.upload(created.storagePath, selected)
      uploaded = true
      await loadRecent()
      setPhase('recognizing')
      const result = await receiptAdapter.process(created.receiptImportId, selected)
      showReceiptResult(result)
      await loadRecent()
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else if (receiptImportId && uploaded) await recoverImport(receiptImportId)
      else {
        setError('照片上传失败，已保留当前选择，请稍后重试。')
        if (receiptImportId) await loadRecent()
      }
    } finally {
      activeRef.current = false
      setPhase('idle')
    }
  }

  async function retryRecognition(receiptImportId: string) {
    if (activeRef.current) return
    activeRef.current = true
    setPhase('recognizing')
    setError(null)
    try {
      const result = await receiptAdapter.process(receiptImportId)
      showReceiptResult(result)
      await loadRecent()
    } catch (reason) {
      if (isAuthenticationRequired(reason)) onSessionExpired()
      else await recoverImport(receiptImportId)
    } finally {
      activeRef.current = false
      setPhase('idle')
    }
  }

  return (
    <main className="phone page receipt-page">
      <div className="page-content">
        <header className="topbar centered"><button className="back-button" onClick={onBack} disabled={busy}>返回</button><h1>更新库存</h1><span /></header>
        <section className="receipt-intro">
          <span className="eyebrow-label">库存导入</span>
          <h2>拍一张小票</h2>
          <p>先识别商品，再由你逐项确认。确认前不会写入冰箱库存。</p>
        </section>

        <section className="section-card import-card">
          <div className="import-icon" aria-hidden="true">⌁</div>
          <div><h3>照片小票</h3><p>支持 JPEG、PNG、WebP，最大 10MB。</p></div>
          <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => {
            const selected = event.target.files?.[0] ?? null
            if (selected) void start(selected)
            event.target.value = ''
          }} />
          <button className="primary-button" disabled={busy} onClick={() => inputRef.current?.click()}>{phase === 'uploading' ? '正在上传…' : phase === 'recognizing' ? '正在识别…' : '拍照或选择照片'}</button>
        </section>

        <section className="section-card import-card disabled-card" aria-disabled="true">
          <div className="import-icon" aria-hidden="true">PDF</div>
          <div><h3>PDF 小票</h3><p>第一版暂未开放。</p></div>
          <button className="secondary-button wide" disabled>尚未开放</button>
        </section>

        {file && <section className="section-card current-upload"><div><span className="status-chip">已选择</span><h3>{file.name}</h3><p>{(file.size / 1024 / 1024).toFixed(2)} MB</p></div>{!busy && <button className="text-button neutral" onClick={() => void start()}>重试</button>}</section>}
        {error && <div className="save-error" role="alert"><b>暂时无法完成识别</b><span>{error}</span>{receipt && <small>任务编号：{receipt.receiptImportId}</small>}</div>}
        {receipt?.status === 'confirmed' && <div className="success-banner" role="status">这张小票已经完成入库。<button className="text-button neutral" onClick={onInventory}>查看库存</button></div>}
        <section>
          <div className="feature-title"><span><b>最近导入</b><small>真实上传记录</small></span></div>
          {recentLoading && <div className="section-card"><div className="skeleton wide" /></div>}
          {recentError && <div className="status-card error-card"><p>{recentError}</p><button className="text-button" onClick={loadRecent}>重试</button></div>}
          {!recentLoading && !recentError && recent.length === 0 && <div className="status-card empty-card"><b>还没有导入记录</b><p>上传第一张照片后会显示在这里。</p></div>}
          {!recentLoading && !recentError && recent.length > 0 && <div className="section-card compact-list">{recent.map((item) => <button className="feature-row" key={item.receiptImportId} disabled={busy || !['ready_for_review', 'failed', 'uploaded'].includes(item.status)} onClick={() => item.status === 'ready_for_review' ? void recoverImport(item.receiptImportId) : void retryRecognition(item.receiptImportId)}><span><b>{item.merchantName || item.fileName}</b><small>{item.errorCode === 'OCR_NOT_CONFIGURED' ? '识别服务尚未配置' : historyStatus[item.status]}</small></span><strong>{item.status === 'ready_for_review' ? '继续确认' : item.status === 'failed' || item.status === 'uploaded' ? '重试识别' : historyStatus[item.status]}</strong></button>)}</div>}
        </section>
        <p className="scope-note">识别结果只用于库存确认。未匹配商品会作为库存占位，不会进入记餐单品选择器。</p>
      </div>
      <BottomNav active="厨房" onChange={onTab} />
    </main>
  )
}
