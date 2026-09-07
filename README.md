# クロスウィンドウ・ハイライト（Cross-Window Highlight）

ON の間、文字を選択すると、他のタブ／ウィンドウの一致箇所を自動でハイライトする Chrome 拡張です。
請求書と伝票、原稿と校正紙のように、2画面で照合・突合をする作業のために作りました。

- 全角／半角、大文字／小文字の違いは無視して一致させます（`ＩＮＶ－0042` と `inv-0042` は同じ扱い）
- ハイフンや空白の違いも無視します。長音符「ー」は語の一部として扱います
- `input` / `textarea` の中身は枠で示します
- リッチテキストエディタ（contenteditable）の中は書き換えません。入力中は再ハイライトを保留します
- データは一切収集しません。選択文字列は端末内のタブ間でしか受け渡されません（[プライバシーポリシー](docs/privacy.md)）

## インストール

### Chrome ウェブストアから

準備中。

### 開発者向け（パッケージ化されていない拡張機能として読み込む）

1. このリポジトリを clone する
2. Chrome で `chrome://extensions` を開く
3. 右上の「デベロッパーモード」を ON にする
4. 「パッケージ化されていない拡張機能を読み込む」で `src/` フォルダを選ぶ

ソースを変更したら、`chrome://extensions` で拡張のリロードボタンを押してください。

## 使い方

1. ツールバーのアイコンをクリックし、ポップアップのスイッチを ON にする（バッジが `ON` になります）
2. どこかのページで文字を選択する（2文字以上）
3. 他のタブ／ウィンドウの一致箇所が黄色くハイライトされる
4. 選択を解除すると、少し待ってからハイライトも消える

ポップアップには「いまハイライト中」の文字列と、ショートカットの設定が表示されます。

### ショートカット

| 操作 | キー |
|---|---|
| ON / OFF | `Ctrl+Shift+H`（Mac: `Cmd+Shift+H`） |
| そのページのハイライトだけ消す | `Esc` |

ショートカットは `chrome://extensions/shortcuts` で変更できます（ポップアップにもリンクがあります）。

### 動かないページ

`chrome://` などブラウザ内部のページ、Chrome ウェブストア、拡張機能のページではハイライトしません。

## 無料版と Pro 版

| | 無料 | Pro（準備中） |
|---|---|---|
| タブ／ウィンドウ間のハイライト | ○ | ○ |
| 全角／半角・大文字／小文字の正規化 | ○ | ○ |
| ショートカットで ON / OFF | ○ | ○ |
| ハイライト色のカスタム | | ○ |
| 最小文字数の変更（1〜10） | | ○ |
| 除外ドメイン | | ○ |
| ヒット件数のバッジ表示 | | ○ |
| 複数キーワードの同時ハイライト | | ○ |
| iframe 内のハイライト | | ○ |

Pro 版はライセンスキーで解放します。ライセンスキーの検証以外にネットワーク通信は行いません。
Pro の設定は `chrome.storage.sync` に保存されるので、同じ Google アカウントの Chrome 間で同期されます。ライセンスは端末ごとです。

## ライセンス（Polar.sh）

販売と検証は [Polar.sh](https://polar.sh) を使います。席数（端末数）は Polar 側の「ライセンスキーのアクティベーション上限」で表現します。
検証は `src/license.js` の中だけで行い、プロバイダは差し替え可能な構造です（切り替え先の候補は Gumroad）。

### 使う API（customer-portal 系、認証不要）

出典: `https://polar.sh/docs/openapi.json`（version 2026-04、2026-09-07 確認）。本番 `https://api.polar.sh`、sandbox `https://sandbox-api.polar.sh`。

| 目的 | エンドポイント | リクエスト | 成功 | 失敗 |
|---|---|---|---|---|
| 端末を登録 | `POST /v1/customer-portal/license-keys/activate` | `{ key, organization_id, label, meta? }` | 200 `{ id（activation_id）, license_key: { status, expires_at, limit_activations, … } }` | 403 `NotPermitted`（上限到達、またはアクティベーション未設定のキー）／404 `ResourceNotFound` |
| 定期確認 | `POST /v1/customer-portal/license-keys/validate` | `{ key, organization_id, activation_id? }` | 200 `{ status: granted \| revoked \| disabled, expires_at, limit_activations, activation?, … }` | 404 `ResourceNotFound`（キーまたは activation_id が不明） |
| 端末を解除 | `POST /v1/customer-portal/license-keys/deactivate` | `{ key, organization_id, activation_id }` | 204 | 404 `ResourceNotFound` |

送信するのは上の項目だけです。`meta` は `{ client: "chrome-extension" }` 固定、`label` は日付と鍵ハッシュ先頭6文字です。選択文字列や URL は送りません。

### 拡張側の動き

1. ポップアップでキーを入力 → `activate`。成功したら `activation_id` を端末内（`chrome.storage.local` の `cwh_license`）に保存
2. `activate` が 403 のときは `validate` を試し、`limit_activations` が `null`（上限設定なしのキー）なら validate 結果で認証。数値なら「端末数の上限」エラー
3. 7日ごとに `validate` で再確認。サーバーに届かないときは前回結果を維持
4. 「この端末の認証を解除」で `deactivate` を呼び、端末内の情報を消す
5. `status` が `granted` 以外、または `expires_at` を過ぎたキーは無効扱い。無効になった瞬間に Pro 設定はデフォルト値へ戻る

### 設定（公開前に必要）

`src/license.js` の `CWH_LICENSE_CONFIG` に以下を入れる:

- `organizationId`: Polar の Organization ID（Settings > General）。**本番と sandbox で別**
- `purchaseUrl`: Polar のチェックアウトリンク
- `apiBase`: 本番は `https://api.polar.sh` のまま

Polar 側では、Product の Benefit に「License Keys」を追加し、Activation limit を席数に設定します。

### sandbox / モックで試す

`chrome.storage.local` の `cwh_dev` を入れると接続先を上書きできます（拡張の Service Worker のコンソールで）:

```js
chrome.storage.local.set({ cwh_dev: { apiBase: "https://sandbox-api.polar.sh", organizationId: "<sandbox の org id>" } })
```

消すときは `chrome.storage.local.remove("cwh_dev")`。
`node tools/e2e-pro.js` は Polar の仕様どおりに応答するモックサーバーを立てて、上の 1〜5 と Pro 機能 6 種、「ライセンス API 以外の通信がない」ことを確認します。

## 構成

```
src/            拡張本体（ストアに出すのはこのフォルダ）
  manifest.json
  background.js   Service Worker。タブ間の中継と状態管理
  content.js      各ページで動くハイライト本体
  settings.js     Pro 設定のデフォルト値と読み書き（3画面で共通）
  license.js      ライセンス検証（外部通信はここだけ）
  popup/          設定ポップアップ
  _locales/       日本語 / 英語
  icons/          アイコン（icon.svg が元絵）
tools/          開発用スクリプト（npm 依存はここだけ）
docs/           プライバシーポリシーなど（GitHub Pages 用）
```

## 開発

```bash
cd tools && npm install
```

| コマンド | 内容 |
|---|---|
| `node tools/build-icons.js` | `src/icons/icon.svg` から PNG を再生成 |
| `node tools/e2e.js --lang=ja` | 実機 Chrome で動作確認（日本語） |
| `node tools/e2e.js --lang=en` | 同上（英語） |
| `node tools/e2e-pro.js` | Pro 機能とライセンス（モック Polar サーバーで確認） |

e2e は puppeteer-core でインストール済みの Chrome を起動し、2タブ間のハイライト、contenteditable の保護、ポップアップの ON / OFF、多言語表示を確認します。Chrome 137 以降は `--load-extension` が使えないため、CDP 経由で読み込んでいます。

## ライセンス

未定。
