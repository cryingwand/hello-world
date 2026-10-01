const PATHS = {
  users:
    'M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3ZM8 12a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 8 12Zm8 1.5c-2.3 0-7 1.2-7 3.5V19h14v-2c0-2.3-4.7-3.5-7-3.5ZM8 13.5c-.3 0-.7 0-1 .1C5.2 14 2 15 2 17v2h5v-2c0-1.3.6-2.3 1.5-3.1-.2-.2-.3-.4-.5-.4Z',
  folder:
    'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z',
  chat: 'M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9.5L5 20.5V17H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v9h1.5a1 1 0 0 1 1 1v1.2L9 15.4a1 1 0 0 1 .6-.2H19V6Zm3 2.5h8V10H8Zm0 3h5v1.5H8Z',
  quiz: 'M6 3h9l4 4v14H6Zm2 2v14h9V8h-3.5V5Zm1.5 6h6v1.5h-6Zm0 3h6v1.5h-6Zm0 3h4v1.5h-4Z',
  lessons:
    'M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 4v11h12V8Zm2 2h8v1.5H8Zm0 3h8v1.5H8Zm0 3h5v1.5H8Z',
  grid: 'M4 4h16v16H4Zm2 2v3.5h5V6Zm7 0v3.5h5V6ZM6 11.5V15h5v-3.5Zm7 0V15h5v-3.5ZM6 16.5V18h5v-1.5Zm7 0V18h5v-1.5Z',
  search:
    'M10.5 4a6.5 6.5 0 1 0 4 11.6l4.5 4.5 1.4-1.4-4.5-4.5A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1-4.5 4.5A4.5 4.5 0 0 1 10.5 6Z',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2h1.5A1.5 1.5 0 0 1 20 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-8A1.5 1.5 0 0 1 5.5 10Zm2 0h6V8a3 3 0 0 0-6 0Zm3 4a1.6 1.6 0 0 0-.8 3v1.5h1.6V17a1.6 1.6 0 0 0-.8-3Z',
  screen: 'M3 5h18v11H3Zm2 2v7h14V7Zm4 10h6v2H9Z',
  close:
    'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4Z',
  minimize: 'M5 17h14v2H5Z',
  maximize: 'M5 5h14v14H5Zm2 2v10h10V7Z',
  'snap-left': 'M4 5h16v14H4Zm2 2v10h5V7Z',
  'snap-right': 'M4 5h16v14H4Zm10 2v10h4V7Z'
} as const

export type IconName = keyof typeof PATHS

export default function Icon({
  name,
  size = 18
}: {
  name: IconName
  size?: number
}): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={PATHS[name]} fillRule="evenodd" />
    </svg>
  )
}
