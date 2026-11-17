/**
 * Synced Lyrics parser & synchronization engine
 * Parses standard .lrc format: [mm:ss.xx] Lyric text
 * Implements binary search for current lyric line with O(log N) lookup
 */

export interface LyricLine {
  time: number; // in seconds
  text: string;
}

/**
 * Parse standard LRC format string into sorted LyricLine array
 */
export function parseLRC(lrcText: string): LyricLine[] {
  if (!lrcText || typeof lrcText !== "string") return [];

  const lines = lrcText.split(/\r?\n/);
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Skip metadata tags like [ti:Title], [ar:Artist], etc.
    if (trimmed.startsWith("[ti:") || trimmed.startsWith("[ar:") || trimmed.startsWith("[al:") || trimmed.startsWith("[by:")) {
      continue;
    }

    const matches = Array.from(trimmed.matchAll(timeRegex));
    if (!matches.length) continue;

    // The text is whatever is after the last time tag
    const text = trimmed.replace(timeRegex, "").trim();
    if (!text) continue;

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const fraction = match[3] ? parseFloat("0." + match[3]) : 0;
      const totalSeconds = minutes * 60 + seconds + fraction;

      result.push({
        time: Number(totalSeconds.toFixed(2)),
        text,
      });
    }
  }

  // Sort chronologically
  return result.sort((a, b) => a.time - b.time);
}

/**
 * Binary search to find current line index for given timestamp
 */
export function findCurrentLyricIndex(lyrics: LyricLine[], currentTime: number): number {
  if (!lyrics.length) return -1;
  if (currentTime < lyrics[0].time) return 0;

  let lo = 0;
  let hi = lyrics.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lyrics[mid].time <= currentTime) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo;
}

/**
 * Catalog sample lyrics for instant offline/demo preview
 */
export const DEMO_LYRICS: Record<string, string> = {
  "night-drive": `[00:00.00] (Synth pulse intro)
[00:08.50] Neon bleeding through the rain on the dashboard
[00:15.20] Midnight shadows fading into the fast lane
[00:22.80] City lights glow like diamonds in the rearview
[00:29.40] We got nowhere to be, but we're moving so fast
[00:36.50] Keep the tempo high until the sun climbs up
[00:44.20] In the night drive, electric vibrations
[00:52.00] In the night drive, lost in translation
[01:00.40] Electric echoes running through our veins
[01:08.80] Nothing ever hurts when you leave the ground
[01:17.50] We're alive in the slipstream tonight`,

  "golden-hour": `[00:00.00] (Acoustic warmth)
[00:06.30] Sunset melting across the horizon
[00:13.10] Warm breeze catching every little thought
[00:19.80] Hold this moment before shadows fall
[00:26.50] Time slows down in the golden glow
[00:34.20] Everything shines in this sweet reverie
[00:41.50] Stay right here, don't let it drift away`,

  "velvet-rope": `[00:00.00] (Deep bass groove)
[00:07.80] Velvet rope parting in the dim light
[00:14.40] Silk perfume and a bass drop low
[00:21.30] Step closer into the nocturne
[00:28.00] Whispers telling secrets in rhythm
[00:35.50] Lost in the velvet glow tonight`,

  "sanam-teri-kasam": `[00:00.00] (Acoustic strings intro)
[00:09.50] Betahasha dil ne tujhko hi chaaha hai
[00:18.20] Har dua mein maine tujhko hi maanga hai
[00:27.40] Tera jaana jaise koi saza ho
[00:36.00] Sanam teri kasam, sanam teri kasam
[00:45.30] Dil ki dhadkan tere dam se hi chalti hai
[00:54.00] Har saans mein teri hi aahat milti hai`,

  "kya-loge-tum": `[00:00.00] (Melodic piano melody)
[00:08.00] Arrey itna bata do humko
[00:15.50] Humse chura ke aankhein
[00:22.00] Ab kis se mila rahe ho
[00:29.40] Humse wafa ke badle
[00:36.20] Kya loge tum humse bichhadne ka
[00:44.00] Arrey sach sach bata do yaara`,

  "bachpan-ka-pyaar": `[00:00.00] (Upbeat electronic rhythm)
[00:06.00] Jaane meri jaaneman, bachpan ka pyaar mera
[00:12.80] Bhool nahi jaana re
[00:18.50] Jaisa mera pyaar hai, jaan tujhe kiya hai
[00:24.00] Bachpan ka pyaar mera bhool nahi jaana re`,
};

export function generateSmartKaraokeLyrics(title: string, artist: string): string {
  return `[00:00.00] ♫ (Intro - ${title})
[00:06.00] In the neon rhythm, listening to ${title}
[00:13.50] Melody flowing with ${artist}
[00:21.00] Feel the soundwaves moving through the air
[00:28.50] Singing along in the flow state
[00:36.00] ♫ (Guitar & Beat Drop)
[00:43.50] Lost in the harmony tonight
[00:51.00] Neonify keeping the vibe alive
[00:59.00] Repeat the chorus with the rhythm
[01:07.50] ♫ (Outro melody)`;
}
