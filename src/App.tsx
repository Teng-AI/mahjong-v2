import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'

function App() {
  const joins = useQuery(api.rooms.latestJoins)
  const joinRoom = useMutation(api.rooms.joinRoom)
  const turns = useQuery(api.timers.recentTurns)
  const startTurn = useMutation(api.timers.startTurn)

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-green-800 p-8 text-white">
      <h1 className="text-2xl font-bold">M0 gate 1: hello room</h1>
      <button
        className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-green-800 active:scale-95"
        onClick={() => joinRoom({ name: navigator.platform || 'unknown' })}
      >
        Join
      </button>
      <ul className="w-full max-w-sm space-y-2">
        {joins === undefined && <li className="opacity-60">loading…</li>}
        {joins?.map((j) => (
          <li key={j.id} className="rounded bg-green-900 px-3 py-2 text-sm">
            {j.name} at {new Date(j.joinedAt).toLocaleTimeString()}
          </li>
        ))}
      </ul>
      <h2 className="text-xl font-bold">Gates 2-3: server timer</h2>
      <button
        className="rounded-lg bg-amber-300 px-6 py-3 text-lg font-semibold text-green-900 active:scale-95"
        onClick={() => startTurn({ delayMs: 30_000 })}
      >
        Start 30s timer
      </button>
      <ul className="w-full max-w-sm space-y-2">
        {turns?.map((t) => (
          <li key={t.id} className="rounded bg-green-900 px-3 py-2 text-sm">
            {t.status === 'pending'
              ? `pending, fires ${new Date(t.deadlineAt).toLocaleTimeString()}`
              : `fired, skew ${t.skewMs}ms`}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default App
