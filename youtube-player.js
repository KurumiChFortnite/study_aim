(function () {
  'use strict';

  const config = window.STUDY_AIM_YOUTUBE_CONFIG;
  if (!config) return;

  const SETTINGS_VERSION = 1;
  const STATS_VERSION = 1;
  const DAY_MS = 86400000;
  const state = {
    catalog: [],
    current: null,
    player: null,
    playerReady: false,
    isPlaying: false,
    lastPlaybackTick: 0,
    playbackTimer: 0,
    volumeTick: 0,
    unavailable: new Set(),
    settings: loadJson(config.storage.settings, {
      version: SETTINGS_VERSION,
      size: config.defaultPlayerSize,
      minimized: false,
      position: null,
      volume: null
    }),
    stats: loadJson(config.storage.videoStats, {version: STATS_VERSION, videos: {}})
  };

  const elements = {};

  function loadJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? {...fallback, ...value} : {...fallback};
    } catch (_) {
      return {...fallback};
    }
  }

  function saveSettings() {
    try { localStorage.setItem(config.storage.settings, JSON.stringify(state.settings)); } catch (_) {}
  }

  function saveStats() {
    try { localStorage.setItem(config.storage.videoStats, JSON.stringify(state.stats)); } catch (_) {}
  }

  function normalizeStoredData() {
    state.settings.version = SETTINGS_VERSION;
    state.stats.version = STATS_VERSION;
    if (!state.stats.videos || typeof state.stats.videos !== 'object') state.stats.videos = {};
    if (!config.playerSizes[state.settings.size]) state.settings.size = config.defaultPlayerSize;
    state.settings.minimized = Boolean(state.settings.minimized);
  }

  function videoStats(video) {
    const existing = state.stats.videos[video.videoId];
    if (!existing || typeof existing !== 'object') {
      state.stats.videos[video.videoId] = {
        videoId: video.videoId,
        publishedAt: video.publishedAt,
        impressions: 0,
        watched: false,
        accumulatedPlaySeconds: 0,
        lastShownAt: null,
        lastPlayedAt: null
      };
    } else {
      existing.videoId = video.videoId;
      existing.publishedAt = video.publishedAt;
      existing.impressions = Math.max(0, Number(existing.impressions) || 0);
      existing.watched = Boolean(existing.watched);
      existing.accumulatedPlaySeconds = Math.max(0, Number(existing.accumulatedPlaySeconds) || 0);
    }
    return state.stats.videos[video.videoId];
  }

  function ageDays(video, now = Date.now()) {
    const published = Date.parse(video.publishedAt);
    return Number.isFinite(published) ? Math.max(0, Math.floor((now - published) / DAY_MS)) : 0;
  }

  function priority(video) {
    const stats = videoStats(video);
    return stats.impressions * config.impressionPriorityPoints
      + (stats.watched ? config.watchedPriorityPoints : 0)
      + ageDays(video) * config.ageDayPriorityPoints;
  }

  function chooseVideo(excludeId) {
    let candidates = state.catalog.filter(video => !state.unavailable.has(video.videoId));
    if (excludeId && candidates.length > 1) candidates = candidates.filter(video => video.videoId !== excludeId);
    if (!candidates.length) return null;
    let minimum = Infinity;
    for (const video of candidates) minimum = Math.min(minimum, priority(video));
    const tied = candidates.filter(video => priority(video) === minimum);
    return tied[Math.floor(Math.random() * tied.length)];
  }

  function chooseLatestVideo() {
    const candidates = state.catalog.filter(video => !state.unavailable.has(video.videoId));
    if (!candidates.length) return null;
    let latestTime = -Infinity;
    for (const video of candidates) latestTime = Math.max(latestTime, Date.parse(video.publishedAt) || 0);
    const latest = candidates.filter(video => (Date.parse(video.publishedAt) || 0) === latestTime);
    return latest[Math.floor(Math.random() * latest.length)];
  }

  function markShown(video) {
    const stats = videoStats(video);
    stats.impressions += 1;
    stats.lastShownAt = new Date().toISOString();
    saveStats();
  }

  function setStatus(message, isError = false) {
    elements.status.textContent = message;
    elements.status.classList.toggle('error', isError);
  }

  function updateVideoUi(video) {
    const published = Date.parse(video.publishedAt);
    const isNew = Number.isFinite(published) && Date.now() - published <= config.newVideoDays * DAY_MS;
    elements.newBadge.classList.toggle('hidden', !isNew);
    elements.openLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`;
    elements.openLink.setAttribute('aria-label', `${video.title || '現在の動画'}をYouTubeで開いて要望を書く`);
    setStatus(config.messages.ready);
  }

  function displayVideo(video) {
    if (!video) {
      state.current = null;
      setStatus(config.messages.noVideos, true);
      return;
    }
    stopPlaybackClock();
    state.current = video;
    state.isPlaying = false;
    markShown(video);
    updateVideoUi(video);
    if (state.playerReady && state.player && typeof state.player.cueVideoById === 'function') {
      state.player.cueVideoById({videoId: video.videoId});
    }
  }

  function showTemporary(element, message) {
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(element._hideTimer);
    element._hideTimer = setTimeout(() => element.classList.remove('show'), config.messageDurationMs);
  }

  function hideReminder() {
    clearTimeout(elements.reminder._hideTimer);
    elements.reminder.classList.remove('show');
  }

  function onProblemCleared() {
    if (!state.isPlaying) showTemporary(elements.reminder, config.messages.reminder);
  }

  function accruePlaybackTime() {
    if (!state.isPlaying || !state.current || !state.lastPlaybackTick) return;
    const now = performance.now();
    const seconds = Math.max(0, Math.min(2, (now - state.lastPlaybackTick) / 1000));
    state.lastPlaybackTick = now;
    const stats = videoStats(state.current);
    stats.accumulatedPlaySeconds += seconds;
    stats.lastPlayedAt = new Date().toISOString();
    if (!stats.watched && stats.accumulatedPlaySeconds >= config.watchThresholdSeconds) {
      stats.watched = true;
      saveStats();
    }
  }

  function startPlaybackClock() {
    stopPlaybackClock();
    state.isPlaying = true;
    state.lastPlaybackTick = performance.now();
    hideReminder();
    state.playbackTimer = window.setInterval(() => {
      accruePlaybackTime();
      state.volumeTick += 1;
      if (state.volumeTick % 5 === 0) persistVolume();
      if (state.current) {
        const stats = videoStats(state.current);
        if (Math.floor(stats.accumulatedPlaySeconds) % 5 === 0) saveStats();
      }
    }, 1000);
  }

  function stopPlaybackClock() {
    accruePlaybackTime();
    state.isPlaying = false;
    state.lastPlaybackTick = 0;
    if (state.playbackTimer) clearInterval(state.playbackTimer);
    state.playbackTimer = 0;
    saveStats();
  }

  function persistVolume() {
    if (!state.playerReady || !state.player || typeof state.player.getVolume !== 'function') return;
    try {
      const volume = state.player.getVolume();
      if (Number.isFinite(volume) && volume !== state.settings.volume) {
        state.settings.volume = volume;
        saveSettings();
      }
    } catch (_) {}
  }

  function onPlayerStateChange(event) {
    const playerState = window.YT && window.YT.PlayerState;
    if (!playerState) return;
    if (event.data === playerState.PLAYING) {
      startPlaybackClock();
      return;
    }
    stopPlaybackClock();
    if (event.data === playerState.ENDED) {
      const previousId = state.current && state.current.videoId;
      showTemporary(elements.event, config.messages.ended);
      displayVideo(chooseVideo(previousId));
    }
  }

  function onPlayerError() {
    const failedId = state.current && state.current.videoId;
    if (failedId) state.unavailable.add(failedId);
    stopPlaybackClock();
    const replacement = chooseVideo(failedId);
    if (replacement) displayVideo(replacement);
    else setStatus(config.messages.loadError, true);
  }

  function createPlayer() {
    if (!state.current || !window.YT || !window.YT.Player) return;
    state.player = new window.YT.Player('youtubePlayer', {
      videoId: state.current.videoId,
      width: '100%',
      height: '100%',
      playerVars: {autoplay: 0, playsinline: 1, rel: 0},
      events: {
        onReady(event) {
          state.playerReady = true;
          if (Number.isFinite(state.settings.volume)) event.target.setVolume(state.settings.volume);
          setStatus(config.messages.ready);
        },
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      }
    });
  }

  function loadIframeApi() {
    if (window.YT && window.YT.Player) {
      createPlayer();
      return;
    }
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof previousCallback === 'function') previousCallback();
      createPlayer();
    };
    if (!document.querySelector(`script[src="${config.iframeApiUrl}"]`)) {
      const script = document.createElement('script');
      script.src = config.iframeApiUrl;
      script.async = true;
      script.onerror = () => setStatus(config.messages.loadError, true);
      document.head.appendChild(script);
    }
    window.setTimeout(() => {
      if (!state.playerReady) setStatus(config.messages.loadError, true);
    }, 12000);
  }

  function applySize(size, minimized = size === 'minimized') {
    if (size !== 'minimized' && config.playerSizes[size]) state.settings.size = size;
    state.settings.minimized = minimized;
    elements.widget.classList.toggle('minimized', minimized);
    elements.widget.style.setProperty('--yt-player-width', `${config.playerSizes[state.settings.size]}px`);
    document.querySelectorAll('[data-youtube-size]').forEach(button => {
      const active = minimized ? button.dataset.youtubeSize === 'minimized' : button.dataset.youtubeSize === state.settings.size;
      button.classList.toggle('active', active);
    });
    clampWidgetToViewport();
    saveSettings();
  }

  function rememberPosition() {
    const rect = elements.widget.getBoundingClientRect();
    state.settings.position = {left: Math.round(rect.left), top: Math.round(rect.top)};
    saveSettings();
  }

  function applySavedPosition() {
    const position = state.settings.position;
    if (position && Number.isFinite(position.left) && Number.isFinite(position.top)) {
      elements.widget.style.left = `${position.left}px`;
      elements.widget.style.top = `${position.top}px`;
      elements.widget.style.right = 'auto';
      elements.widget.style.bottom = 'auto';
    }
    requestAnimationFrame(clampWidgetToViewport);
  }

  function clampWidgetToViewport() {
    if (!state.settings.position) return;
    const rect = elements.widget.getBoundingClientRect();
    const margin = 6;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin));
    const top = Math.max(margin, Math.min(rect.top, window.innerHeight - Math.min(rect.height, window.innerHeight - margin * 2) - margin));
    elements.widget.style.left = `${left}px`;
    elements.widget.style.top = `${top}px`;
    elements.widget.style.right = 'auto';
    elements.widget.style.bottom = 'auto';
    state.settings.position = {left: Math.round(left), top: Math.round(top)};
  }

  function setupDrag() {
    let drag = null;
    elements.dragHandle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const rect = elements.widget.getBoundingClientRect();
      drag = {pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top};
      elements.dragHandle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    elements.dragHandle.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const rect = elements.widget.getBoundingClientRect();
      const margin = 6;
      const left = Math.max(margin, Math.min(event.clientX - drag.dx, window.innerWidth - rect.width - margin));
      const top = Math.max(margin, Math.min(event.clientY - drag.dy, window.innerHeight - Math.min(rect.height, window.innerHeight - margin * 2) - margin));
      elements.widget.style.left = `${left}px`;
      elements.widget.style.top = `${top}px`;
      elements.widget.style.right = 'auto';
      elements.widget.style.bottom = 'auto';
      event.preventDefault();
    });
    const finish = event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = null;
      rememberPosition();
    };
    elements.dragHandle.addEventListener('pointerup', finish);
    elements.dragHandle.addEventListener('pointercancel', finish);
  }

  function bindUi() {
    elements.next.addEventListener('click', () => {
      const previousId = state.current && state.current.videoId;
      stopPlaybackClock();
      if (state.playerReady && state.player && typeof state.player.stopVideo === 'function') state.player.stopVideo();
      displayVideo(chooseVideo(previousId));
    });
    elements.restore.addEventListener('click', () => applySize(state.settings.size, false));
    document.querySelectorAll('[data-youtube-size]').forEach(button => {
      button.addEventListener('click', () => applySize(button.dataset.youtubeSize));
    });
    window.addEventListener('resize', () => {
      clampWidgetToViewport();
      clearTimeout(window._studyAimYoutubeResizeSave);
      window._studyAimYoutubeResizeSave = setTimeout(saveSettings, 180);
    });
    window.addEventListener('beforeunload', () => {
      stopPlaybackClock();
      persistVolume();
    });
    setupDrag();
  }

  async function loadCatalog() {
    const response = await fetch(config.catalogUrl, {cache: 'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.videos)) throw new Error('invalid catalog');
    state.catalog = payload.videos.filter(video => video && /^[\w-]{11}$/.test(video.videoId) && video.publishedAt);
    if (!state.catalog.length) throw new Error('empty catalog');
    state.catalog.forEach(videoStats);
    saveStats();
  }

  async function init() {
    normalizeStoredData();
    elements.widget = document.getElementById('youtubeWidget');
    elements.dragHandle = document.getElementById('youtubeDragHandle');
    elements.restore = document.getElementById('youtubeRestoreBtn');
    elements.next = document.getElementById('youtubeNextBtn');
    elements.openLink = document.getElementById('youtubeOpenLink');
    elements.newBadge = document.getElementById('youtubeNewBadge');
    elements.status = document.getElementById('youtubeStatus');
    elements.reminder = document.getElementById('youtubeReminderToast');
    elements.event = document.getElementById('youtubeEventToast');
    if (Object.values(elements).some(element => !element)) return;
    bindUi();
    applySize(state.settings.minimized ? 'minimized' : state.settings.size, state.settings.minimized);
    applySavedPosition();
    setStatus(config.messages.loading);
    try {
      await loadCatalog();
      displayVideo(chooseLatestVideo());
      loadIframeApi();
    } catch (error) {
      console.warn('YouTube catalog load failed:', error);
      setStatus(config.messages.loadError, true);
    }
  }

  window.StudyAimYouTube = Object.freeze({onProblemCleared});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
