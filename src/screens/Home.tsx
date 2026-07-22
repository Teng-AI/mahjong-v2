import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { getToken } from '../lib/identity';
import type { Difficulty } from '../App';

const NAME_KEY = 'mahjong-name';
const ROOM_KEY = 'mahjong-room';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export function Home({ onEnterRoom }: { onEnterRoom: (roomCode: string) => void }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? 'You');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createQuickPlay = useMutation(api.quickplay.createQuickPlay);

  const handleQuickPlay = async () => {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(NAME_KEY, name);
      const { roomCode } = await createQuickPlay({ token: getToken(), name: name.trim() || 'You', difficulty });
      localStorage.setItem(ROOM_KEY, roomCode);
      onEnterRoom(roomCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Quick Play.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-emerald-900 p-6 text-emerald-50">
      <h1 className="text-2xl font-semibold">Fuzhou Mahjong</h1>

      <div className="flex w-full max-w-xs flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            className="rounded-lg border border-emerald-600 bg-emerald-950/40 px-3 py-2 text-emerald-50 outline-none focus:border-emerald-300"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          Difficulty
          <div className="flex gap-2">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDifficulty(d)}
                className={[
                  'flex-1 rounded-lg border px-3 py-2 capitalize',
                  difficulty === d
                    ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                    : 'border-emerald-600 text-emerald-200',
                ].join(' ')}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={handleQuickPlay}
          className="rounded-full bg-amber-500 px-4 py-3 font-semibold text-emerald-950 disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Quick Play'}
        </button>

        {error && <p className="text-center text-sm text-red-300">{error}</p>}
      </div>
    </main>
  );
}
