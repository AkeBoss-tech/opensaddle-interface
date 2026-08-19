import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const avatar = readFileSync(new URL('../src/ui/AgentAvatar.tsx', import.meta.url), 'utf8')
const avatarCss = readFileSync(new URL('../src/ui/agent-avatar.css', import.meta.url), 'utf8')
const agentsPage = readFileSync(new URL('../src/pages/AgentsPage.tsx', import.meta.url), 'utf8')
const chatPage = readFileSync(new URL('../src/pages/ChatPage.tsx', import.meta.url), 'utf8')

test('agent avatars expose a coherent five-character family with non-color role marks', () => {
  for (const variant of ['builder', 'scout', 'coordinator', 'reviewer', 'guardian']) {
    assert.match(avatar, new RegExp(variant))
  }
  assert.match(avatar, /os-agent-avatar__eyes/)
  assert.match(avatar, /RoleMark/)
  assert.match(avatar, /aria-label=\{`\$\{name\}, \$\{state/)
})

test('agent execution states communicate motion and intervention without replacing labels', () => {
  for (const state of ['running', 'waiting', 'needs-approval', 'failed', 'paused', 'ready']) {
    assert.match(avatarCss, new RegExp(`os-agent-avatar--${state}`))
  }
  assert.match(avatarCss, /prefers-reduced-motion/)
  assert.match(avatar, /os-agent-avatar__badge--approval/)
  assert.match(avatar, /os-agent-avatar__badge--failed/)
})

test('the character system is used in the agent library and shared conversation', () => {
  assert.match(agentsPage, /<AgentAvatar/)
  assert.match(chatPage, /className="slack-message-avatar"/)
  assert.match(chatPage, /className="team-channel-agent-avatar"/)
})
