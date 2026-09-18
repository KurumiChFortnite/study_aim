import {readFile, writeFile} from 'node:fs/promises';

const sourcePath = new URL('../youtube-source.json', import.meta.url);
const outputPath = new URL('../youtube-videos.json', import.meta.url);
const source = JSON.parse(await readFile(sourcePath, 'utf8'));

if (!/^PL[\w-]+$/.test(source.playlistId || '')) {
  throw new Error('youtube-source.json の playlistId が不正です。');
}

const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(source.playlistId)}`;
const response = await fetch(feedUrl, {headers: {'user-agent': 'study-aim-youtube-catalog/1.0'}});
if (!response.ok) throw new Error(`YouTube feed request failed: HTTP ${response.status}`);
const xml = await response.text();

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function tag(block, name) {
  const escaped = name.replace(':', '\\:');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`));
  return match ? decodeXml(match[1]) : '';
}

const feedPlaylistId = tag(xml, 'yt:playlistId');
if (feedPlaylistId !== source.playlistId) {
  throw new Error(`取得したプレイリストIDが設定と一致しません: ${feedPlaylistId || '(missing)'}`);
}

const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(match => {
  const block = match[1];
  return {
    videoId: tag(block, 'yt:videoId'),
    publishedAt: tag(block, 'published'),
    title: tag(block, 'title')
  };
}).filter(video => /^[\w-]{11}$/.test(video.videoId) && !Number.isNaN(Date.parse(video.publishedAt)));

if (!videos.length) throw new Error('公開プレイリストに取得可能な動画がありません。既存JSONは更新しません。');

let existing = null;
try { existing = JSON.parse(await readFile(outputPath, 'utf8')); } catch (_) {}

if (existing && existing.playlistId === source.playlistId
    && JSON.stringify(existing.videos) === JSON.stringify(videos)) {
  console.log('YouTube catalog is already current');
  process.exit(0);
}

const catalog = {
  version: 1,
  playlistId: source.playlistId,
  updatedAt: new Date().toISOString(),
  videos
};

await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`${videos.length} videos written to youtube-videos.json`);
