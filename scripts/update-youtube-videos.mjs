import {readFile, rename, rm, writeFile} from 'node:fs/promises';

const sourcePath = new URL('../youtube-source.json', import.meta.url);
const outputPath = new URL('../youtube-videos.json', import.meta.url);
const temporaryOutputPath = new URL(`../youtube-videos.json.tmp-${process.pid}`, import.meta.url);
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [5000, 15000, 30000];
const RESPONSE_PREVIEW_LENGTH = 500;
const REQUEST_TIMEOUT_MS = 30000;

if (!/^PL[\w-]+$/.test(source.playlistId || '')) {
  throw new Error('youtube-source.json の playlistId が不正です。');
}

const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(source.playlistId)}`;

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

function parseAndValidateFeed(xml) {
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

  if (!videos.length) throw new Error('公開プレイリストに取得可能な動画がありません。');
  return videos;
}

function isValidExistingCatalog(catalog) {
  return Boolean(catalog
    && catalog.version === 1
    && catalog.playlistId === source.playlistId
    && Array.isArray(catalog.videos)
    && catalog.videos.length > 0
    && catalog.videos.every(video => video
      && /^[\w-]{11}$/.test(video.videoId)
      && !Number.isNaN(Date.parse(video.publishedAt))));
}

function shouldRetryStatus(status) {
  return status === 404 || status === 429 || status >= 500;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function responsePreview(body) {
  return body.replace(/\s+/g, ' ').trim().slice(0, RESPONSE_PREVIEW_LENGTH) || '(empty body)';
}

async function fetchAndValidateFeed() {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      console.log(`YouTube Feed取得 ${attempt}/${MAX_ATTEMPTS}: ${feedUrl}`);
      const response = await fetch(feedUrl, {
        headers: {'user-agent': 'study-aim-youtube-catalog/1.0'},
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      const contentType = response.headers.get('content-type') || '(none)';
      const body = await response.text();

      if (!response.ok) {
        console.error(`YouTube Feed HTTPエラー: status=${response.status}, content-type=${contentType}, body=${responsePreview(body)}`);
        const error = new Error(`YouTube feed request failed: HTTP ${response.status}`);
        error.retryable = shouldRetryStatus(response.status);
        throw error;
      }

      const videos = parseAndValidateFeed(body);
      console.log(`YouTube Feed検証成功: status=${response.status}, content-type=${contentType}, videos=${videos.length}`);
      return videos;
    } catch (error) {
      lastError = error;
      const retryable = error.retryable !== false;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const delay = RETRY_DELAYS_MS[attempt - 1];
      console.warn(`YouTube Feed取得失敗: ${error.message}. ${delay / 1000}秒後に再試行します。`);
      await wait(delay);
    }
  }
  throw lastError || new Error('YouTube Feed取得に失敗しました。');
}

let existing = null;
try { existing = JSON.parse(await readFile(outputPath, 'utf8')); } catch (_) {}

let videos;
try {
  videos = await fetchAndValidateFeed();
} catch (error) {
  if (isValidExistingCatalog(existing)) {
    console.warn(`::warning title=YouTube Feed取得失敗::既存のyoutube-videos.jsonを維持しました。最終エラー: ${error.message}`);
    console.warn('YouTube Feed取得失敗。既存のyoutube-videos.jsonを維持した');
    process.exit(0);
  }
  throw new Error(`YouTube Feed取得失敗、かつ維持可能な正常なyoutube-videos.jsonがありません: ${error.message}`, {cause: error});
}

if (isValidExistingCatalog(existing)
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

try {
  await writeFile(temporaryOutputPath, `${JSON.stringify(catalog, null, 2)}\n`, {encoding: 'utf8', flag: 'wx'});
  const writtenCatalog = JSON.parse(await readFile(temporaryOutputPath, 'utf8'));
  if (!isValidExistingCatalog(writtenCatalog)
      || JSON.stringify(writtenCatalog.videos) !== JSON.stringify(videos)) {
    throw new Error('一時ファイルの検証に失敗しました。');
  }
  await rename(temporaryOutputPath, outputPath);
} catch (error) {
  await rm(temporaryOutputPath, {force: true}).catch(() => {});
  throw error;
}
console.log(`${videos.length} videos written to youtube-videos.json`);
