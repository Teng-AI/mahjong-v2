// Player identity: a stable random token stored in localStorage, minted once
// per browser. The server maps roomCode+token to a seat (convex/views.ts).

const TOKEN_KEY = 'mahjong-token';

export function getToken(): string {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}
