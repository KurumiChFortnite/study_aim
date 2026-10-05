(function () {
  'use strict';

  // GA4管理画面の「データ ストリーム」にある測定IDへ変更してください。
  const GA_MEASUREMENT_ID = 'G-C9BPTQXZYH';

  // 同じページ内で再評価されても、タグ初期化とpage_viewを重複させない。
  // リロードや再訪問ではwindowが新しくなるため、毎回計測する。
  if (window.StudyAimAnalytics) return;
  const enabled = /^G-[A-Z0-9]+$/.test(GA_MEASUREMENT_ID)
    && GA_MEASUREMENT_ID !== 'G-XXXXXXXXXX';

  function trackEvent(name, params = {}) {
    try {
      if (enabled && typeof window.gtag === 'function') {
        window.gtag('event', name, {...params, send_to: GA_MEASUREMENT_ID});
      }
    } catch (_) {
      // Analyticsは補助機能。送信失敗をゲーム処理へ伝播させない。
    }
  }

  window.StudyAimAnalytics = Object.freeze({trackEvent});
  if (!enabled) return;

  try {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, {send_page_view: false});
    trackEvent('page_view');

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    document.head.appendChild(script);
  } catch (_) {
    // 未読込・ブロック・ネットワーク障害でも本体はそのまま動作する。
  }
})();
