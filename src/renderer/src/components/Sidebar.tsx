import { Library, CalendarCheck, Sparkles, Highlighter, Trash2, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { View } from '../App'
import { ICON } from './ui'
import { XMark } from './XMark'

interface Props {
  view: View
  dueCount: number
  width: number
  aiOpen: boolean
  trashOpen: boolean
  timelineOpen: boolean
  settingsOpen: boolean
  onChangeView: (v: View) => void
  onOpenTrash: () => void
  onOpenTimeline: () => void
  onOpenSettings: () => void
  onToggleAi: () => void
}

function NavItem({
  icon: Icon,
  label,
  active,
  badge,
  onClick
}: {
  icon: LucideIcon
  label: string
  active: boolean
  badge?: number
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className={`nav-item${active ? ' active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={label /* the only label left visible when the rail is collapsed */}
    >
      <Icon size={ICON.sm} strokeWidth={ICON.stroke} className="nav-icon" />
      <span className="nav-label">{label}</span>
      {badge != null && badge > 0 && <span className="nav-badge">{badge}</span>}
    </button>
  )
}

/** Left rail: brand, view switches, AI toggle, timeline, and the recycle bin. */
export function Sidebar({
  view,
  dueCount,
  width,
  aiOpen,
  trashOpen,
  timelineOpen,
  settingsOpen,
  onChangeView,
  onOpenTrash,
  onOpenTimeline,
  onOpenSettings,
  onToggleAi
}: Props): JSX.Element {
  const overlay = trashOpen || timelineOpen || settingsOpen
  return (
    <aside className="sidebar" style={{ width }}>
      <div className="brand">
        <XMark size={20} />
        <span className="brand-word">XNote</span>
      </div>

      <nav className="nav">
        <NavItem icon={Library} label="文件库" active={view === 'all' && !overlay} onClick={() => onChangeView('all')} />
        <NavItem
          icon={CalendarCheck}
          label="今日复习"
          active={view === 'review' && !overlay}
          badge={dueCount}
          onClick={() => onChangeView('review')}
        />
      </nav>

      <nav className="nav nav-bottom">
        <NavItem icon={Sparkles} label="AI 查找" active={aiOpen} onClick={onToggleAi} />
        <NavItem icon={Highlighter} label="标注时间线" active={timelineOpen} onClick={onOpenTimeline} />
        <NavItem icon={Trash2} label="回收站" active={trashOpen} onClick={onOpenTrash} />
        <NavItem icon={Settings} label="设置" active={settingsOpen} onClick={onOpenSettings} />
      </nav>
    </aside>
  )
}
