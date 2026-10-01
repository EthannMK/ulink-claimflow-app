import { Component, type ReactNode } from 'react'

/** If one page hits an unexpected error, show a friendly box instead of a blank screen.
 *  The sidebar, top bar and any running JD1 scan keep working. */
export class PageErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error('[page error]', error) }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })   // navigating away clears it
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="max-w-lg mx-auto mt-16 bg-white border border-outline-variant rounded-xl p-6 text-center shadow-sm">
        <div className="text-lg font-semibold text-primary">This page hit a problem</div>
        <p className="text-sm text-text-main mt-2">Your other work is safe. Try again, or open another page from the menu.</p>
        <p className="text-[11px] text-outline mt-2 break-words">{this.state.error.message}</p>
        <button onClick={() => this.setState({ error: null })} className="mt-4 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold">Try again</button>
      </div>
    )
  }
}
