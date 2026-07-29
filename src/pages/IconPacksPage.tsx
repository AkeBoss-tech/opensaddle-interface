import { useState, type ComponentType } from 'react'
import {
  Bell as LucideBell,
  Bot as LucideBot,
  Folder as LucideFolder,
  GitPullRequest as LucidePullRequest,
  Globe2 as LucideGlobe,
  Home as LucideHome,
  MessageSquare as LucideMessage,
  Search as LucideSearch,
  Settings as LucideSettings,
  ShieldCheck as LucideShield,
} from 'lucide-react'
import {
  Bell as PhosphorBell,
  ChatCircle as PhosphorMessage,
  Folder as PhosphorFolder,
  Gear as PhosphorSettings,
  GitPullRequest as PhosphorPullRequest,
  Globe as PhosphorGlobe,
  House as PhosphorHome,
  MagnifyingGlass as PhosphorSearch,
  Robot as PhosphorBot,
  ShieldCheck as PhosphorShield,
} from '@phosphor-icons/react'
import {
  IconBell as TablerBell,
  IconFolder as TablerFolder,
  IconGitPullRequest as TablerPullRequest,
  IconHome as TablerHome,
  IconMessageCircle as TablerMessage,
  IconRobot as TablerBot,
  IconSearch as TablerSearch,
  IconSettings as TablerSettings,
  IconShieldCheck as TablerShield,
  IconWorld as TablerGlobe,
} from '@tabler/icons-react'
import {
  BellIcon as HeroBell,
  ChatBubbleLeftRightIcon as HeroMessage,
  CodeBracketSquareIcon as HeroPullRequest,
  Cog6ToothIcon as HeroSettings,
  CpuChipIcon as HeroBot,
  FolderIcon as HeroFolder,
  GlobeAltIcon as HeroGlobe,
  HomeIcon as HeroHome,
  MagnifyingGlassIcon as HeroSearch,
  ShieldCheckIcon as HeroShield,
} from '@heroicons/react/24/outline'
import { useStore } from '../data/store'
import { getActiveIconPack, setActiveIconPack, type IconPackId } from '../components/common/Icon'
import '../styles/icon-packs.css'

// Each package exposes slightly different optional style props; the lab keeps
// them behind one render-only boundary so the product icon API stays untouched.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PreviewIcon = ComponentType<any>
type PackId = IconPackId

const LABELS = ['Home', 'Messages', 'Projects', 'Search', 'Settings', 'Alerts', 'Agents', 'Pull requests', 'Access', 'Web']

const PACKS: Array<{
  id: PackId
  name: string
  summary: string
  tone: string
  license: string
  count: string
  icons: PreviewIcon[]
}> = [
  {
    id: 'lucide',
    name: 'Lucide',
    summary: 'Calm, geometric, and highly consistent. The closest evolution of the current OpenSaddle line style.',
    tone: 'Precise · understated',
    license: 'ISC',
    count: '1,600+',
    icons: [LucideHome, LucideMessage, LucideFolder, LucideSearch, LucideSettings, LucideBell, LucideBot, LucidePullRequest, LucideShield, LucideGlobe],
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    summary: 'Friendlier silhouettes with multiple weights and a useful duotone mode for agents and artifacts.',
    tone: 'Expressive · flexible',
    license: 'MIT',
    count: '9,000+',
    icons: [PhosphorHome, PhosphorMessage, PhosphorFolder, PhosphorSearch, PhosphorSettings, PhosphorBell, PhosphorBot, PhosphorPullRequest, PhosphorShield, PhosphorGlobe],
  },
  {
    id: 'tabler',
    name: 'Tabler',
    summary: 'Crisp technical shapes with enormous coverage for runtimes, development tools, and operational work.',
    tone: 'Technical · comprehensive',
    license: 'MIT',
    count: '6,100+',
    icons: [TablerHome, TablerMessage, TablerFolder, TablerSearch, TablerSettings, TablerBell, TablerBot, TablerPullRequest, TablerShield, TablerGlobe],
  },
  {
    id: 'heroicons',
    name: 'Heroicons',
    summary: 'Strong product UI fundamentals with excellent small-size clarity, but a materially smaller catalog.',
    tone: 'Familiar · product-led',
    license: 'MIT',
    count: '300+',
    icons: [HeroHome, HeroMessage, HeroFolder, HeroSearch, HeroSettings, HeroBell, HeroBot, HeroPullRequest, HeroShield, HeroGlobe],
  },
]

export function IconPacksPage() {
  const { toast } = useStore()
  const [selected, setSelected] = useState<PackId>(() => getActiveIconPack())
  const choose = (id: PackId) => {
    setSelected(id)
    setActiveIconPack(id)
    const pack = PACKS.find((item) => item.id === id)
    toast('Icon pack applied', `${pack?.name ?? id} is now active across OpenSaddle.`)
  }

  return (
    <div className="icon-lab">
      <header className="icon-lab-header">
        <div><span>Design system experiment</span><h1>Choose OpenSaddle’s icon language</h1><p>Compare the same product actions across four production-ready icon packs. Choosing one applies it across the product immediately.</p></div>
        <span className="icon-lab-selection">Active · {PACKS.find((pack) => pack.id === selected)?.name}</span>
      </header>

      <section className="icon-context-strip" aria-label="Icon comparison criteria">
        <div><strong>Navigation</strong><span>Readable at 15–18px</span></div>
        <div><strong>AI identity</strong><span>Agents should feel distinct</span></div>
        <div><strong>Developer depth</strong><span>Git, runtime, and trace coverage</span></div>
        <div><strong>Consistency</strong><span>One visual grammar across the app</span></div>
      </section>

      <div className="icon-pack-grid">
        {PACKS.map((pack) => {
          const ProjectIcon = pack.icons[2]!
          const AgentIcon = pack.icons[6]!
          const AccessIcon = pack.icons[8]!
          return (
          <article className={`icon-pack-card ${selected === pack.id ? 'selected' : ''}`} key={pack.id}>
            <header>
              <div><span>{pack.tone}</span><h2>{pack.name}</h2></div>
              <button onClick={() => choose(pack.id)}>{selected === pack.id ? 'Selected' : 'Choose'}</button>
            </header>
            <p>{pack.summary}</p>
            <div className="icon-pack-meta"><span>{pack.count} icons</span><span>{pack.license} license</span><span>React package</span></div>
            <div className={`icon-sample-grid ${pack.id}`}>
              {pack.icons.map((PackIcon, index) => (
                <div key={LABELS[index]}>
                  <span>
                    <PackIcon
                      size={22}
                      strokeWidth={pack.id === 'tabler' ? 1.8 : pack.id === 'lucide' ? 1.7 : undefined}
                      weight={pack.id === 'phosphor' && (index === 6 || index === 8) ? 'duotone' : 'regular'}
                    />
                  </span>
                  <small>{LABELS[index]}</small>
                </div>
              ))}
            </div>
            <div className="icon-pack-in-context">
              <strong>In the sidebar</strong>
              <button><ProjectIcon size={18} /><span>Engineering</span></button>
              <button><AgentIcon size={18} /><span>Secure Coding Agent</span></button>
              <button><AccessIcon size={18} /><span>Access</span></button>
            </div>
          </article>
        )})}
      </div>
    </div>
  )
}
