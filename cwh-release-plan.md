# クロスウィンドウ・ハイライト 公開・Pro化 計画書

Claude Code への指示書。上から順に Phase 単位で進めること。各 Phase の完了条件を満たしてから次へ進む。

---

## 0. 前提

### 現状
- MV3 の Chrome 拡張。`manifest.json` / `background.js` / `content.js` の3ファイル構成、manifest version は 2.1.1
- 機能：ON の間、選択した文字列を他タブ／ウィンドウで自動ハイライトする
- 既に実装済みで**壊してはいけない挙動**：
  - revision（世代番号）による古い HIGHLIGHT / CLEAR の無効化
  - contenteditable 内は DOM を書き換えない（ペースト不能バグの再発防止）
  - 入力中（input / textarea / contenteditable にフォーカス中）は再ハイライトを保留し、focusout 後に適用
  - `document.hasFocus()` による非アクティブ画面の誤判定防止
  - 全角→半角・大文字→小文字の正規化、区切り文字（各種ハイフン・空白）の無視、長音符「ー」は語の一部として扱う
  - `storage.session` による選択状態の保持と、再読込タブへの復元
  - content.js はメッセージ送信失敗時のみ再注入
  - Escape でローカルのハイライト解除、ショートカット `Ctrl+Shift+H` / `Cmd+Shift+H` で ON/OFF

### ゴール
1. Chrome ウェブストアに公開できる状態にする（Phase 1〜2）
2. 無料版 / Pro 版の2階建てにし、ライセンスキーで Pro 機能を解放できるようにする（Phase 3）
3. ストア申請に必要な素材を揃える（Phase 4）

### 全体の制約
- 外部通信は「ライセンスキー検証」の1本だけ。それ以外はネットワークに一切出ない
- 選択文字列・閲覧 URL・ハイライト内容を端末外に送らない（プライバシーポリシーに明記するため、実装で保証する）
- 既存ロジック（上記「壊してはいけない挙動」）は変更しない。追加は必ず**既存の関数を呼ぶ側**で行う
- ビルドツールは導入しない。素の JS のまま、ファイル追加で対応する
- 新しい permission は追加しない（`tabs` / `scripting` / `storage` / `<all_urls>` のまま）

---

## Phase 1：ストア公開の必須要件

### 1-1. アイコン
- `icons/` を作成し、16 / 32 / 48 / 128 px の PNG を用意する
- 元絵は SVG で1枚作り、スクリプト（Node の `sharp` または `resvg`）で PNG 化する。SVG も同梱する
- デザイン方針：2つの重なったウィンドウ枠＋黄色のハイライト帯。単色寄りでシンプルに。16px で潰れない太さにする
- `manifest.json` に `icons` と `action.default_icon` を追加する

### 1-2. ポップアップ（設定画面）
- `popup/popup.html` / `popup.css` / `popup.js` を追加し、`action.default_popup` に設定する
- ※ 現状の「アイコンクリック＝トグル」は default_popup を設定すると動かなくなる。**トグルはポップアップ内のスイッチ**に移す。`chrome.action.onClicked` のリスナーは削除する
- ポップアップの内容（無料版）：
  - ON / OFF スイッチ（現状の `enabled` と同期。ショートカットとも整合させる）
  - 現在のハイライト文字列の表示（`GET_STATE` を使う）
  - ショートカットの案内と `chrome://extensions/shortcuts` へのリンク
  - 「Pro 機能」セクション（Phase 3 までは「準備中」の表示でよい）
- 見た目：明るくやさしい配色、角丸、余白多め。幅 320px 程度

### 1-3. 多言語化（日本語 / 英語）
- `_locales/ja/messages.json` と `_locales/en/messages.json` を作成する
- `manifest.json` の `name` / `description` / `commands` の description を `__MSG_xxx__` に置き換え、`default_locale` を `ja` にする
- content.js のトースト文言（「ハイライト ON」など）とポップアップの文言も `chrome.i18n.getMessage` 経由にする
- 英語名は `Cross-Window Highlight`。**着手前に Chrome ウェブストアで同名・類似名の拡張がないか確認し、被りがあれば報告して名前を相談する**

### 1-4. 細かい整理
- `background.js` / `content.js` 冒頭のコメントにあるバージョン表記（v2.1 / v2.3）を manifest と揃える。manifest を `3.0.0` に上げる
- `broadcastHighlight` / `broadcastClear` で `chrome.tabs.query({})` の結果から `tab.discarded === true` のタブを除外する（休止タブへの無駄な注入を避ける）

### Phase 1 完了条件
- `chrome://extensions` で「パッケージ化されていない拡張機能を読み込む」でエラーなく読み込める
- アイコンがツールバー・拡張一覧に表示される
- ポップアップから ON/OFF できて、ショートカットでの ON/OFF と状態が一致する
- Chrome の言語を英語にすると名前・説明・トーストが英語になる
- 既存の動作（2タブ間のハイライト、contenteditable での貼り付け、Escape 解除）が壊れていない

---

## Phase 2：プライバシーポリシーと公開用ドキュメント

### 2-1. プライバシーポリシー
- `docs/privacy.md`（日英併記）を作成する。内容：
  - 収集するデータ：なし
  - 選択文字列は端末内のタブ間でのみ受け渡し、外部に送信しない
  - `<all_urls>` が必要な理由：ユーザーが開いている任意のページ間でハイライトを同期するため
  - ライセンスキー検証時のみ、キー文字列を販売プラットフォームの検証 API に送る（Phase 3 で追記）
- GitHub Pages で公開する前提で `docs/index.md` も用意する（Phase 4 のストア申請でプライバシーポリシー URL が必要）

### 2-2. README
- `README.md`（日本語）を作成。インストール方法、使い方、ショートカット、無料 / Pro の違い、開発者向けの読み込み手順

### Phase 2 完了条件
- `docs/privacy.md` / `README.md` が存在し、実装と矛盾がない

---

## Phase 3：Pro 機能とライセンス

### 3-1. 設定の保存先
- Pro 設定は `chrome.storage.sync` に保存する（キー名は `cwh_settings`、1オブジェクトにまとめる）
- デフォルト値は `settings.js` として1箇所に定義し、background / content / popup から共通で読む

### 3-2. Pro 機能（優先順）
1. **ハイライト色のカスタム**：mark の背景色、input 枠の色を設定可能に。content.js の `injectStyle` の色を設定値で差し替える
2. **最小文字数の変更**：`MIN_LEN` を設定値に。範囲 1〜10、デフォルト 2
3. **除外ドメイン**：設定したドメインではハイライトも選択送信も行わない。`background.js` の `isBlocked` と content.js の初期化の両方で判定する
4. **ヒット件数のバッジ表示**：選択元タブのバッジに他タブ合計ヒット数を表示（`broadcastHighlight` の `hit` を使う）。ON/OFF バッジとの併用は「ON 中は件数、OFF 中は OFF」
5. **複数キーワード同時ハイライト**：選択文字列を改行・読点・カンマで分割し、複数語を別色でハイライト。`highlight()` を複数 term 対応に拡張するが、単語1つのときの挙動は現状と完全に同じにする
6. **iframe 対応**：`all_frames: true` に変更し、`ensureInjected` の `allFrames` も true にする。iframe 内での contenteditable 判定が正しく動くことを確認する

### 3-3. ライセンスキー
- ポップアップに「ライセンスキー入力」欄を追加
- 検証は background.js が行う（content.js からは行わない）。販売プラットフォームは **Gumroad または Lemon Squeezy** を想定し、`license.js` に検証処理を分離して、プラットフォームを差し替えやすくする
- 検証結果は `chrome.storage.local` に `{ valid, checkedAt, keyHash }` で保存。7日ごとに再検証、オフライン時は前回結果を採用
- Pro 機能は `valid === true` のときだけポップアップで有効化できる。無効時はグレーアウト＋購入リンク
- **販売プラットフォームの API 仕様は実装前に必ず公式ドキュメントで確認し、エンドポイントとレスポンス形式を README に記録する**（推測で書かない）

### Phase 3 完了条件
- 無効なキーでは Pro 機能がグレーアウトし、有効なキーで解放される
- Pro 機能 1〜6 それぞれについて、OFF 時の挙動が Phase 1 完了時点と同一
- ネットワークタブで確認し、ライセンス検証以外の通信が発生しない

---

## Phase 4：ストア申請の素材

- `store/` に以下を作成
  - `description_ja.md` / `description_en.md`：ストア説明文。**想定ユーザー「2画面で照合・突合作業をする事務・経理・法務・校正の人」**を冒頭に置く。機能一覧より「困りごと→解決」の順で書く
    - 「ミスをゼロに」「○%削減」などの断定を使わない。「人による確認を支援する」「選択するだけで別画面の一致箇所を確認できる」の表現で書く
    - 正規化して一致した箇所（表記違いの一致）は色が違うことを、説明文でも明記する
  - スクリーンショット用の HTML ページ（1280×800）を3枚分。実際の拡張を動かして撮る前提のダミーページ（請求書一覧と伝票の突合、など）
  - `permissions_justification.md`：審査で聞かれる各 permission の理由
- `package.sh`：ストア提出用 ZIP を生成する（`docs/` `store/` `README.md` `.git` を除外）

### Phase 4 完了条件
- `package.sh` で生成した ZIP を読み込んで、Phase 1〜3 の完了条件を再確認できる

---

## 進め方のルール
- 各 Phase 完了時に、変更ファイル一覧と「壊してはいけない挙動」の手動確認結果を報告する
- 判断に迷う点（名前の被り、ライセンス API の仕様、iframe での副作用など）は勝手に決めず、報告して止まる
- コミットは Phase 単位＋機能単位で細かく分ける
