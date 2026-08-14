import { StitchScreen } from './StitchScreen'
import { ScreenSwitcher } from './ScreenSwitcher'
export function Screen({ name }: { name: string }) {
  return (<><ScreenSwitcher /><StitchScreen name={name} /></>)
}
