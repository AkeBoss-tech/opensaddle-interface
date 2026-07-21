const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 11m-6.5 0a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0M16 16l4 4',
  message: 'M5 5.5h14v10H9l-4 3v-13Z',
  folder: 'M3.5 7h6l1.8 2H20.5v9.5h-17V7Z',
  chevron: 'm9 6 6 6-6 6',
  clock: 'M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0M12 7.5v5l3 2',
  cloud: 'M7.2 18h9.5a4 4 0 0 0 .5-8 5.8 5.8 0 0 0-11.1 1.6A3.3 3.3 0 0 0 7.2 18Z',
  activity: 'M3 12h4l2-6 4 12 2-6h6',
  plugin: 'M8 3v4M16 3v4M6 7h12v4a6 6 0 0 1-6 6v4M9 21h6',
  chart: 'M5 19V9M12 19V5M19 19v-7',
  settings: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9',
  code: 'm8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  review: 'M5 4h10v4h4v12H5V4ZM15 4v4h4M8 12h8M8 16h5',
  bug: 'M8 9h8v7a4 4 0 0 1-8 0V9ZM9 5l2 2M15 5l-2 2M5 12h3M16 12h3',
  spark: 'm12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3Z',
  paperclip: 'm9 12 5.8-5.8a3 3 0 1 1 4.2 4.2l-8.2 8.2a5 5 0 0 1-7.1-7.1L12 3.2',
  tools: 'm14 6 4-3 3 3-3 4-4-4ZM13 7 4 16v4h4l9-9',
  arrow: 'M12 19V5M6 11l6-6 6 6',
  panel: 'M3.5 4.5h17v15h-17zM15 5v14',
  shield: 'M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Zm-3.5 9 2.2 2.2 4.8-5',
  db: 'M12 6c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3ZM4 9v6c0 1.7 3.6 3 8 3s8-1.3 8-3V9',
  api: 'M8 7h8M8 17h8',
  file: 'M6 3h8l4 4v14H6V3Zm8 0v5h5M9 13h6M9 17h4',
  vm: 'M3 4h18v13H3zM8 21h8M12 17v4',
  key: 'M8.5 12m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M13 12h8M18 12v3',
  bell: 'M6 17h12l-1.4-2V10a4.6 4.6 0 0 0-9.2 0v5L6 17ZM10 20h4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  x: 'm6 6 12 12M18 6 6 18',
  check: 'm6 12 4 4 8-9',
  lock: 'M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3',
  users: 'M9 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M3.5 19c.5-3.6 2.4-5 5.5-5s5 1.4 5.5 5',
  branch: 'M6 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 7m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  play: 'M7 5v14l12-7z',
  pause: 'M8 5v14M16 5v14',
  terminal: 'M3 4h18v16H3zM7 9l3 3-3 3M13 15h4',
  globe: 'M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0M3.5 12h17',
  undo: 'M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3',
  refresh: 'M4 12a8 8 0 0 1 13.6-5.6L20 8M20 4v4h-4',
  command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6',
  git: 'm20.4 11-7.4-7.4-2 2',
  sun: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M4 12H2M22 12h-2',
  trace: 'M6 6m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0M18 12m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0M6 18m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0',
  layout: 'M4 4h16v16H4zM4 10h16M10 10v10',
}

export function Icon({ name, className = 'icon' }: { name: string; className?: string }) {
  const d = PATHS[name] ?? PATHS.spark
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
