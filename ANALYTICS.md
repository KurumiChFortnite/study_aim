# Study AIMのGA4計測

## 測定IDと公開

`analytics.js`の冒頭にある次の値を、GA4の管理 → データ ストリーム → Webストリームの「測定ID」に変更してください。

```js
const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';
```

プレースホルダー・空欄・形式不正では計測を無効にし、Googleタグへのアクセスもしません。測定IDは公開情報です。`analytics.js`も`index.html`と一緒にGitHub Pagesへ公開してください。現在は測定ID未設定なので、GA4への実送信はありません。

## イベントの送信箇所

| イベント | 送信箇所 | 回数・追加情報 |
| --- | --- | --- |
| `page_view` | `analytics.js`初期化 | ページロードごとに1回。`send_page_view: false`でconfigの自動送信を止め、明示的に送信。同一windowでの再初期化は除外。 |
| `game_start` | `index.html`の`startGame()`末尾 | 正常に開始した操作ごとに1回。結果画面のリトライも計測。データ未読込・選択なし等で開始できなかった場合は送信しない。 |
| `game_complete` | `index.html`の`finishGame()`冒頭 | 問題を最後まで終えたゲームにつき1回。開始時にフラグをリセットし、重複終了を除外。ホームへ戻る途中終了は送信しない。 |
| `answer` | `index.html`の`answerTarget()`の既存ロック直後 | 判定ごとに1回。`correct`はboolean。不正解後、同じ問題へ再回答した場合も再度計測。AIMの空振りや途中の的への命中は回答と扱わない。 |
| `youtube_play` | `youtube-player.js`の`onPlayerStateChange()` | 実際のPLAYING通知ごとに1回。停止後の再生も計測。`video_id`と`video_title`を既存カタログから送信。 |
| `youtube_change_video` | `youtube-player.js`の`bindUi()`内、既存の別の動画クリック処理 | 押すごとに1回。動画終了・エラーによる自動切替は含めない。 |

`game_start`の`grade`は`g4,j1`等、`term`は`1,2`等、`subject`は教科名です。複数選択は重複を除いたカンマ区切りです。学年と学期はそれぞれ選択値を列挙します。応用選択も学年・学期の値として扱います。文字列パラメータは必要に応じて100文字に制限しています。

すべてのイベントは`window.StudyAimAnalytics.trackEvent()`を経由します。タグ読み込みを待たずにゲームを操作でき、読込前のイベントはGoogleタグ標準のdataLayerキューへ入ります。Googleタグがブロックされた場合は収集されませんがゲームは続行できます。計測ファイル自体が読み込めなくても、本体側の呼び出しは省略されます。

Analytics用のlocalStorage制限・ユーザー単位の重複除外はありません。既存のスコア・設定・動画統計のlocalStorage処理は変更していません。UI・ゲーム処理・クリックリスナー・YouTubeの状態リスナーは追加／置換せず、既存処理へ計測呼び出しを追加しています。ゲーム完走フラグは計測専用です。

## ブラウザでの確認

1. 測定IDを設定し、変更ファイルをGitHub Pagesへ公開します。
2. GA4の「レポート → リアルタイム」を開き、別タブで公開URLを開きます。測定テスト時は広告ブロッカーを無効にしてください。
3. イベント名別のイベント数で`page_view`を確認します。公開URLをF5で更新し、さらに1回増えることを確認します。他の閲覧者がいる場合は、総数にその操作も含まれます。
4. ゲームを開始し、`game_start`を確認します。不正解と正解を回答し、`answer`を確認します。最後まで進め、`game_complete`を確認します。短い問題数を選ぶと確認しやすくなります。
5. 結果画面からリトライし、`game_start`と完走後の`game_complete`がそれぞれ再度増えることを確認します。
6. YouTubeを再生し`youtube_play`、一時停止→再生でさらに1回、別の動画を2回押して`youtube_change_video`が2回増えることを確認します。
7. 細かい送信順・パラメータはGoogle Tag Assistantで公開URLに接続し、GA4の「管理 → DebugView」で確認します。テストが終わったらTag Assistant接続を解除します。
8. ブラウザ開発者ツールのNetworkで`googletagmanager.com/gtag/js`をブロックして再読み込みし、開始・回答・完走・YouTube操作ができることも確認します。ブロック解除後に再読み込みすれば通常の計測に戻ります。

総数を見るときは「ユーザー数」ではなく、イベント別の「イベント数」を使ってください。リアルタイムは確認用の直近データです。期間を指定した利用量はイベントレポートで確認できます。

`grade`、`term`、`subject`、`correct`、`video_id`、`video_title`で通常のレポートを集計したい場合は、GA4の管理 → カスタム定義で対応するイベントスコープのカスタムディメンションを登録してください。パラメータのレポート反映には通常24〜48時間かかります。DebugViewでの送信確認は登録前にもできます。

現在の本体にはブラウザ履歴の変更による画面遷移はありません。将来pushState等を追加する場合、「拡張計測機能 → ページビュー → 詳細設定」のブラウザ履歴に基づくページ変更設定を確認してください。これはconfigの`send_page_view: false`とは別の自動計測です。外部で同じGoogleタグを二重導入しないでください。

## ローカル検証

```text
node scripts/test-analytics.mjs
node scripts/test-youtube-hidden.mjs
node scripts/test-question-text-cleanup.mjs
```

Analytics検証は実際の本体の開始・判定・終了関数を抽出して実行し、描画・DOM・入力・時刻等をスタブにしています。ページ初期化の重複、リロード、無効ID、未読込／例外、リトライ、回答ロック、完走の重複を確認します。YouTube検証は既存のIFrame APIモックでPLAYINGと別の動画の回数、既存の非表示・復元挙動を確認します。問題検証はJSONと表示用変換の整合性を確認します。

実機のPC／モバイル／ゲームパッド操作やGA4サーバーの受信は、これらの自動検証の対象外です。公開後に上記のブラウザ手順で確認してください。

参考: [ページビューの測定](https://developers.google.com/analytics/devguides/collection/ga4/views?hl=ja)、[DebugView](https://support.google.com/analytics/answer/7201382?hl=ja)、[カスタムディメンション](https://support.google.com/analytics/answer/14240153?hl=ja)
