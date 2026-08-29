import { Icon } from './ui'

// Real brand marks for messaging channels (Material Symbols has no brand logos).
const BRAND: Record<string, JSX.Element> = {
  facebook: <path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.93-1.95 1.88v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z" />,
  telegram: <path fill="#29A9EB" d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />,
  viber: <path fill="#7360F2" d="M12 1.5c-2.6 0-6.4.2-8.3 2C2.2 4.9 1.6 7 1.5 9.6c0 2.6-.1 7.5 4.6 8.9v2.3c0 .8.6 1 1 .5l1.8-2.2c3.3.2 7.8-.3 9.2-4.4.6-1.8.6-3.8.3-5.8C17.9 3.1 14.9 1.6 12 1.5zm4.4 11.7c-.2.5-.9.9-1.4.9-.4 0-.5-.1-.9-.3-1.5-.6-2.9-1.5-4-2.8-.6-.8-1.1-1.6-1.4-2.5-.2-.5.1-.9.4-1.1.2-.1.4-.2.6-.1.2 0 .3.5.4.6.1.3.3.7.4.9.1.2 0 .4-.1.6l-.2.2c-.1.1-.2.2-.1.4.3.6.8 1.1 1.4 1.5.2.1.4.1.5-.1l.3-.3c.2-.2.3-.2.5-.1l1 .6c.2.1.3.2.3.4z" />,
}

export function ChannelGlyph({ glyph, className = '' }: { glyph: string; className?: string }) {
  if (BRAND[glyph]) return <svg viewBox="0 0 24 24" className={className} width="1em" height="1em">{BRAND[glyph]}</svg>
  return <Icon name={glyph} className={className} />
}
