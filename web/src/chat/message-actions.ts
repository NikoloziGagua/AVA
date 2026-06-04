// Pure like/dislike toggle logic for a message's action row. Liking clears a
// prior dislike and vice-versa (mutually exclusive), tapping again clears it.

export interface MessageActionState {
  liked: boolean;
  disliked: boolean;
}

export const NO_REACTION: MessageActionState = { liked: false, disliked: false };

export function toggleLike(s: MessageActionState): MessageActionState {
  return { liked: !s.liked, disliked: false };
}

export function toggleDislike(s: MessageActionState): MessageActionState {
  return { disliked: !s.disliked, liked: false };
}
