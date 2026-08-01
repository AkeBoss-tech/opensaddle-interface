import { useState } from 'react'
import '../styles/entity.css'

export interface Reaction { emoji: string; count: number; reacted?: boolean }
export function ReactionBar({ reactions, onChange }: { reactions: Reaction[]; onChange: (reactions: Reaction[]) => void }) {
  const [open, setOpen] = useState(false)
  const toggle = (emoji: string) => onChange(reactions.some((item) => item.emoji === emoji)
    ? reactions.map((item) => item.emoji === emoji ? { ...item, count: Math.max(0, item.count + (item.reacted ? -1 : 1)), reacted: !item.reacted } : item).filter((item) => item.count > 0)
    : [...reactions, { emoji, count: 1, reacted: true }])
  return <div className="os-reaction-bar">{reactions.map((reaction) => <button type="button" key={reaction.emoji} className={reaction.reacted ? 'is-reacted' : ''} onClick={() => toggle(reaction.emoji)} aria-label={`${reaction.emoji} ${reaction.count} reactions`}>{reaction.emoji} <span>{reaction.count}</span></button>)}<button type="button" className="os-reaction-add" aria-label="Add reaction" onClick={() => setOpen((value) => !value)}>☺</button>{open && <div className="os-reaction-popover" role="dialog" aria-label="Choose a reaction">{['👍', '❤️', '🎉', '👀'].map((emoji) => <button key={emoji} type="button" onClick={() => { toggle(emoji); setOpen(false) }}>{emoji}</button>)}</div>}</div>
}
