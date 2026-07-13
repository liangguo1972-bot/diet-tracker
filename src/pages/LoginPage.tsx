import { FormEvent, useState } from 'react'
import { supabase, supabaseConfigError } from '../lib/supabase'

export function LoginPage({ initialError = null }: { initialError?: string | null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(supabaseConfigError ?? initialError)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setSubmitting(true)
    setError(null)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) setError(authError.message)
    } catch {
      setError('无法连接登录服务，请检查网络后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="phone login-page">
      <div className="login-hero">
        <span className="eyebrow">DAILY NOURISHMENT</span>
        <h1>吃好每一餐。</h1>
        <p>记录今天吃了什么，关注蛋白，也看见身体需要的节奏。</p>
      </div>
      <form className="login-card" onSubmit={submit}>
        <label>邮箱<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
        <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={submitting || !supabase}>{submitting ? '正在登录…' : '登录'}</button>
      </form>
    </main>
  )
}
