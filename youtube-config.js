/* YouTube機能の変更可能な設定は、このファイルへ集約しています。 */
window.STUDY_AIM_YOUTUBE_CONFIG = Object.freeze({
  catalogUrl: './youtube-videos.json',
  iframeApiUrl: 'https://www.youtube.com/iframe_api',
  watchThresholdSeconds: 30,
  watchedPriorityPoints: 1000,
  impressionPriorityPoints: 5,
  ageDayPriorityPoints: 1,
  newVideoDays: 3,
  messageDurationMs: 2600,
  defaultPlayerSize: 'small',
  playerSizes: Object.freeze({small: 240, medium: 400, large: 640}),
  storage: Object.freeze({
    settings: 'studyAim.youtubePlayerSettings',
    videoStats: 'studyAim.youtubeVideoStats'
  }),
  messages: Object.freeze({
    reminder: '🙏 動画再生しながらやってください！ホントにお願いします！😂',
    ended: '🎬 動画が終わりました！次の動画もぜひ！🙏',
    loading: '動画を読み込んでいます…',
    ready: '▶ 再生はYouTubeプレイヤーから操作してください',
    loadError: '動画を読み込めませんでした（AIM練習はそのまま遊べます）',
    playBlocked: '再生を開始できませんでした。プレイヤーの再生ボタンを押してください',
    noVideos: '表示できる動画がありません（AIM練習はそのまま遊べます）'
  })
});
