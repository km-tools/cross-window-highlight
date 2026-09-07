# プライバシーポリシー / Privacy Policy

**Cross-Window Highlight（クロスウィンドウ・ハイライト）**
最終更新 / Last updated: 2026-09-07

---

## 日本語

### 収集するデータ

**ありません。** この拡張機能は、個人情報・閲覧履歴・選択した文字列・閲覧中の URL を含め、いかなるデータも収集・保存・送信しません。アクセス解析やエラー報告の仕組みも入っていません。

### 選択した文字列の扱い

選択した文字列は、**お使いの端末内で開いているタブ／ウィンドウの間だけ**で受け渡され、一致する箇所をハイライトするためにのみ使われます。端末の外には一切送られません。

- 現在の選択内容は、ブラウザを閉じると消える一時領域（`chrome.storage.session`）に保持します。再読み込みしたタブにハイライトを復元するためです
- ON / OFF の設定だけを端末内（`chrome.storage.local`）に保存します

### 権限（permission）が必要な理由

| 権限 | 理由 |
|---|---|
| すべてのサイトのデータの読み取りと変更（`<all_urls>`） | 利用者が開いている任意のページ間でハイライトを同期するため。ページの内容を読み取るのは、選択文字列と一致する箇所を探して目印を付けるときだけです |
| `tabs` | 開いているタブの一覧を取得し、各タブにハイライトの指示を送るため |
| `scripting` | 拡張のインストール前から開いていたタブなど、まだ本体スクリプトが入っていないタブに後から入れるため |
| `storage` | ON / OFF の設定と、現在の選択内容を端末内に保持するため |

### ネットワーク通信

無料版は**ネットワーク通信を一切行いません**。

Pro 版（準備中）では、ライセンスキーの検証のためだけに、入力されたキー文字列を販売プラットフォームの検証 API に送信します。送るのはキー文字列のみで、選択した文字列や閲覧 URL は含みません。詳細は Pro 版の提供開始時にこのページへ追記します。

### 第三者への提供

ありません。

### 変更について

このポリシーを変更する場合は、このページを更新し、拡張機能のバージョンを上げて通知します。

### お問い合わせ

GitHub リポジトリの Issues からご連絡ください。

---

## English

### Data we collect

**None.** This extension does not collect, store, or transmit any data, including personal information, browsing history, selected text, or the URLs you visit. It contains no analytics and no crash reporting.

### How selected text is handled

Selected text is passed **only between the tabs and windows open on your own device**, and only to highlight matching text. It never leaves your device.

- The current selection is kept in a temporary area that is cleared when the browser closes (`chrome.storage.session`), so highlights can be restored on a reloaded tab
- Only the ON / OFF setting is saved on your device (`chrome.storage.local`)

### Why each permission is needed

| Permission | Reason |
|---|---|
| Read and change all your data on all websites (`<all_urls>`) | To sync highlights across any pages you have open. Page content is read only to find and mark text matching your selection |
| `tabs` | To list open tabs and send each one the highlight instruction |
| `scripting` | To inject the highlighter into tabs that were already open before the extension was installed |
| `storage` | To keep the ON / OFF setting and the current selection on your device |

### Network access

The free version **makes no network requests at all**.

The Pro version (coming soon) will contact the license vendor's verification API for one purpose only: validating the license key you enter. Only the key string is sent. Selected text and URLs are never included. This page will be updated when Pro becomes available.

### Sharing with third parties

None.

### Changes to this policy

If this policy changes, this page will be updated and the extension version will be bumped.

### Contact

Please use the Issues page of the GitHub repository.
