import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/ui'

export function LoginPage() {
  const nav = useNavigate()
  return (
    <div className="min-h-screen grid place-items-center bg-surface">
      <div className="w-[380px] bg-white rounded-2xl border border-outline-variant shadow-sm p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-lg bg-primary text-white grid place-items-center font-display font-bold text-lg">U</div>
          <div>
            <div className="font-display font-bold text-primary leading-tight">Ulink ClaimFlow</div>
            <div className="text-xs text-text-main">AI claims workspace</div>
          </div>
        </div>
        <h1 className="font-display text-xl font-bold text-on-surface mb-1">Sign in</h1>
        <p className="text-sm text-text-main mb-5">Welcome back. Please enter your details.</p>
        <label className="block text-sm font-medium text-on-surface mb-1">Email</label>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2 mb-3">
          <Icon name="mail" className="text-[20px] text-outline" />
          <input defaultValue="admin@ulink.com" className="bg-transparent outline-none text-sm w-full" />
        </div>
        <label className="block text-sm font-medium text-on-surface mb-1">Password</label>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2 mb-4">
          <Icon name="lock" className="text-[20px] text-outline" />
          <input type="password" defaultValue="password" className="bg-transparent outline-none text-sm w-full" />
        </div>
        <label className="flex items-center gap-2 text-sm text-text-main mb-5">
          <input type="checkbox" defaultChecked /> Remember me
        </label>
        <button onClick={() => nav('/inbox')}
          className="w-full bg-primary text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-primary-dark">
          Sign in
        </button>
        <p className="text-xs text-outline text-center mt-4">Forgot password?</p>
      </div>
    </div>
  )
}
