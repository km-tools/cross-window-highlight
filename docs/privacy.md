# プライバシーポリシー / Privacy Policy

**Cross-Window Highlight（クロスウィンドウ・ハイライト）**
最終更新 / Last updated: 2026-09-07

---

## 日本語

### 収集するデータ

**ありません。** この拡張機能は、個人情報・閲覧履歴・選択した文字列・閲覧中の URL を含め、いかなるデータも収集・保存・送信しません。アクセス解析やエラー報告の仕組みも入っていません。唯一の例外は Pro 版のライセンスキー検証で、内容は下の「ネットワーク通信」に書いてあります。

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
| `storage` | ON / OFF の設定と現在の選択内容を端末内に、Pro の設定を Chrome の同期領域に保持するため |

### ネットワーク通信

無料版は**ネットワーク通信を一切行いません**。

Pro 版では、ライセンスキーの検証のためだけに、販売プラットフォーム **Polar.sh**（Polar Software Inc.）の検証 API（`api.polar.sh`）へ通信します。

- 送るもの：入力されたライセンスキー、この拡張の識別子（`chrome-extension`）、登録日と鍵のハッシュから作った端末ラベル、端末登録時に発行される activation ID
- 送らないもの：選択した文字列、閲覧中の URL、ページ内容、個人情報
- タイミング：キーを入力したとき、7日ごとの再確認、「認証を解除」を押したとき
- サーバーに届かない場合は、前回の確認結果をそのまま使います

Polar 側でのデータの扱いは [Polar のプライバシーポリシー](https://polar.sh/legal/privacy) に従います。

### 第三者への提供

ありません。

### 変更について

このポリシーを変更する場合は、このページを更新し、拡張機能のバージョンを上げて通知します。

### お問い合わせ

[GitHub リポジトリの Issues](https://github.com/km-tools/cross-window-highlight/issues) からご連絡ください。

---

## English

### Data we collect

**None.** This extension does not collect, store, or transmit any data, including personal information, browsing history, selected text, or the URLs you visit. It contains no analytics and no crash reporting. The single exception is Pro license key verification, described under "Network access" below.

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
| `storage` | To keep the ON / OFF setting and current selection on your device, and Pro settings in Chrome's sync storage |

### Network access

The free version **makes no network requests at all**.

The Pro version contacts the verification API of our payment provider **Polar.sh** (Polar Software Inc., `api.polar.sh`) for one purpose only: validating your license key.

- Sent: the license key you enter, this extension's identifier (`chrome-extension`), a device label built from the date and a hash of the key, and the activation ID issued when the device is registered
- Never sent: selected text, URLs, page content, or personal information
- When: on key entry, every 7 days for re-validation, and when you press "Deactivate this device"
- If the server cannot be reached, the last verified result is used

Polar's handling of that data is governed by [Polar's privacy policy](https://polar.sh/legal/privacy).

### Sharing with third parties

None.

### Changes to this policy

If this policy changes, this page will be updated and the extension version will be bumped.

### Contact

Please use the [Issues page of the GitHub repository](https://github.com/km-tools/cross-window-highlight/issues).
