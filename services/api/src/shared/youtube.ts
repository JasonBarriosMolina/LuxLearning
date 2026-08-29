// YouTube video ID extraction + availability verification — shared by the admin
// validate-videos endpoint, manual lesson create/edit, and the study-plan AI suggestions
// worker. Split out because all three needed the exact same two operations (Trello
// Nk0XDBvJ comment 6a926aaa: recommended/saved videos turning out unavailable, and the
// admin's own "verify videos" button reporting false negatives).

/** Extracts an 11-char YouTube video ID from either a bare ID or a full URL in any of the
 *  common formats (watch?v=, youtu.be/, embed/, shorts/). Admins are told to paste just
 *  the ID (LessonFields.tsx placeholder: "dQw4w9WgXcQ"), but pasting the full URL anyway
 *  is a completely ordinary thing to do — that used to get stored verbatim and broke the
 *  oEmbed check downstream (a full URL as the "id" produces a malformed lookup URL, which
 *  oEmbed always rejects — reporting a perfectly fine video as "unavailable"). Returns null
 *  if no valid-looking ID can be found. */
export function extractYoutubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  // Bare 11-char ID already (YouTube IDs are base64url-ish: letters, digits, - and _)
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Checks whether a YouTube video is actually available via the public oEmbed endpoint —
 *  no API key needed. Returns false on any non-200 response or network error (removed,
 *  private, age-restricted-without-embed, or a malformed/non-existent ID all resolve to a
 *  non-200 here, which is exactly what we want: "can this be shown to a student right
 *  now"). 5s timeout so one bad ID can't stall a batch of checks. */
export async function isYoutubeVideoAvailable(videoId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(5000) },
    );
    return res.ok;
  } catch {
    return false;
  }
}
