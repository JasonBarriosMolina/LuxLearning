/** Compute whether the lesson progress gate has been passed.
 *
 *  Rules:
 *  - If lesson is null/undefined → gate passes (nothing to gate)
 *  - videoRequired = lesson has a youtubeId AND the video hasn't errored
 *  - textRequired  = videoRequired AND lesson has content (both tabs must be visited)
 *  - text-only lessons (no youtubeId) are always open — text is always visible
 */
export function computeGate(
  lesson: { youtubeId?: string | null; content?: string | null } | null | undefined,
  videoVisited: boolean,
  textVisited: boolean,
  videoError: boolean,
): boolean {
  if (!lesson) return true;
  const videoRequired = !!lesson.youtubeId && !videoError;
  const textRequired = videoRequired && !!lesson.content;
  return (!videoRequired || videoVisited) && (!textRequired || textVisited);
}
