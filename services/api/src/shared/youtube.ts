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

/** Escapes text pulled from an untrusted source (a third-party API response, here) before
 *  it's interpolated into lesson HTML that the frontend renders via
 *  dangerouslySetInnerHTML. A video title is ordinary free text from Google's API, not
 *  something Lux controls or validates — without this, a title containing `<img
 *  onerror=...>` would land in every enrolled student's lesson page as stored XSS
 *  (code-review finding, 2026-09-03). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Searches YouTube for a real video matching `query` and returns its videoId + title,
 *  instead of the raw-keyword-search link the module-resources generator used to embed
 *  (Trello Nk0XDBvJ, 2026-09-02 21:43 — Mack: "no necesitamos palabras claves puestas en
 *  la búsqueda de YouTube; necesitamos... el enlace de un video en específico y no que el
 *  estudiante... vaya a buscarlo"). Requires the YouTube Data API v3 (a Google Cloud API
 *  key with "YouTube Data API v3" enabled — different from any Bedrock/AWS key already in
 *  use); returns null immediately when YOUTUBE_API_KEY isn't set, so every caller degrades
 *  gracefully to the previous keyword-search-link behavior until that key is provisioned.
 *  Availability is NOT re-checked here — callers should pass the id through
 *  isYoutubeVideoAvailable before using it, same as any other video id. */
export async function searchYoutubeVideo(
  query: string,
  apiKey: string | undefined = process.env.YOUTUBE_API_KEY,
): Promise<{ videoId: string; title: string; channelTitle: string } | null> {
  if (!apiKey || !query.trim()) return null;
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&safeSearch=strict&relevanceLanguage=es&q=${encodeURIComponent(query)}&key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const item = data?.items?.[0];
    const videoId = item?.id?.videoId;
    if (!videoId) return null;
    return { videoId, title: item?.snippet?.title ?? '', channelTitle: item?.snippet?.channelTitle ?? '' };
  } catch {
    return null;
  }
}

/** Finds YouTube video links embedded as `<a href="...">label</a>` inside lesson HTML
 *  content — specifically the "🎥 Videos Sugeridos" section `ai-wizard-worker.ts` appends
 *  to a module's last text lesson (module-level video suggestions, separate from a
 *  lesson's own `youtubeId` field). The admin's "Validar videos" button only ever checked
 *  `youtubeId` — Trello DmPpbrff, 2026-09-05 (Mack): "debería validar también los videos
 *  que se sugieren dentro de las sugerencias de cada uno de los módulos." A link without a
 *  real 11-char id (the search-results fallback used when YOUTUBE_API_KEY isn't set) is
 *  skipped — it was never meant to point at one specific video, so it isn't a "broken
 *  video" to report. */
export function extractSuggestedVideoLinks(content: string | null | undefined): { videoId: string; label: string }[] {
  if (!content) return [];
  const found: { videoId: string; label: string }[] = [];
  const anchorRe = /<a\s[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(content)) !== null) {
    const videoId = extractYoutubeId(m[1]);
    if (videoId) found.push({ videoId, label: m[2] ?? '' });
  }
  return found;
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
