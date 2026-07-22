// M2-minimal Quick Play client. design-server-loop.md §8: Home (name +
// difficulty + Quick Play) and Game (view-driven, intents only — nothing
// authoritative runs here).

import { useState } from 'react';
import { Home } from './screens/Home';
import { Game } from './screens/Game';

export type Difficulty = 'easy' | 'medium' | 'hard';

const ROOM_KEY = 'mahjong-room';

export default function App() {
  const [roomCode, setRoomCode] = useState<string | null>(() => localStorage.getItem(ROOM_KEY));

  const enterRoom = (code: string) => {
    localStorage.setItem(ROOM_KEY, code);
    setRoomCode(code);
  };

  const leaveRoom = () => {
    localStorage.removeItem(ROOM_KEY);
    setRoomCode(null);
  };

  if (roomCode) {
    return <Game key={roomCode} roomCode={roomCode} onLeave={leaveRoom} />;
  }
  return <Home onEnterRoom={enterRoom} />;
}
