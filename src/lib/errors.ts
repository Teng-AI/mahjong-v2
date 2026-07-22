// Human-readable messages for server-rejected intent codes
// ({ ok:false, code }, convex/intents.ts). The client never decides legality;
// this only translates the server's rejection into a toast.

const MESSAGES: Record<string, string> = {
  not_your_turn: 'Not your turn.',
  wrong_phase: "Can't do that right now.",
  tile_not_in_hand: "You don't have that tile.",
  cannot_discard_gold: "Can't discard the gold tile.",
  cannot_discard_called_type: 'Must discard the called type this turn.',
  must_draw_first: 'Draw first.',
  invalid_call: 'That call is not valid.',
  already_responded: 'You already responded.',
  invalid_chow_selection: 'Pick two tiles that form a valid run.',
  invalid_kong: 'Kong is not available.',
  not_a_winning_hand: 'Not a winning hand.',
  room_not_found: 'Room not found.',
  bad_token: 'Session expired.',
  hand_in_progress: 'Hand is still in progress.',
};

export function errorMessage(code: string): string {
  return MESSAGES[code] ?? `Error: ${code}`;
}
