import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/ui'
export function LoginPage() {
  const nav = useNavigate()
  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-b from-surface to-surface-container px-4">
      <div className="w-[400px] bg-white rounded-2xl border border-outline-variant shadow-md p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <img src="/brand-logo.png" alt="Ulink" className="h-16 w-auto mb-2" />
          <div className="font-display font-bold text-primary text-lg leading-tight">Ulink ClaimFlow</div>
          <div className="text-xs text-text-main">AI claims workspace</div>
        </div>
        <h1 className="font-display text-xl font-bold text-on-surface mb-1">Sign in</h1>
        <p className="text-sm text-text-main mb-5">Welcome back. Please enter your details.</p>
        <label className="block text-sm font-medium text-on-surface mb-1">Email</label>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2.5 mb-3 focus-within:ring-2 focus-within:ring-primary/20">
          <Icon name="mail" className="text-[20px] text-outline" />
          <input defaultValue="admin@ulink.com" className="bg-transparent outline-none text-sm w-full" />
        </div>
        <label className="block text-sm font-medium text-on-surface mb-1">Password</label>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2.5 mb-4 focus-within:ring-2 focus-within:ring-primary/20">
          <Icon name="lock" className="text-[20px] text-outline" />
          <input type="password" defaultValue="password" className="bg-transparent outline-none text-sm w-full" />
        </div>
        <label className="flex items-center gap-2 text-sm text-text-main mb-5"><input type="checkbox" defaultChecked className="accent-primary" /> Remember me</label>
        <button onClick={() => nav('/inbox')} className="w-full bg-primary text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-primary-dark shadow-sm transition-colors">Sign in</button>
        <p className="text-xs text-outline text-center mt-4 cursor-pointer hover:text-primary">Forgot password?</p>
      </div>
    </div>
  )
}
