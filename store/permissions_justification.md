# 権限の説明（Chrome ウェブストア審査用）

デベロッパーダッシュボードの「プライバシーへの取り組み」タブに入力する内容。日本語と英語の両方を用意している（英語欄にはそのまま貼れる）。

## 単一用途の説明（Single purpose）

**日本語**
利用者がページ上で選択した文字列と一致する箇所を、同じブラウザで開いている他のタブ／ウィンドウ上でハイライト表示する。2画面での照合・転記を人が確認する作業を支援することだけが目的で、ページの内容を変更・保存・送信することはない。

**English**
Highlights, in the user's other open tabs and windows, text that matches what the user has selected on one page. Its single purpose is to help a person check side-by-side data entry and reconciliation. It does not modify, store, or transmit page content.

## 各権限の理由

### `tabs`

**日本語**
開いているタブの一覧（ID、URL、タイトル）を取得し、各タブに「この文字列をハイライトして」という指示を送るために必要。URL は「拡張が動作しないページ（chrome:// など）かどうか」と「利用者が除外設定したドメインかどうか」の判定にだけ使う。タイトルは「確認できなかったタブ」の一覧をポップアップに出すためにだけ使う。URL・タイトルとも端末外には送らない。

**English**
Needed to list open tabs (id, URL, title) and send each one the instruction to highlight the selected text. URLs are used only to decide whether a tab is a page the extension cannot run on (chrome:// etc.) or a domain the user has excluded. Titles are used only to list "tabs not checked" in the popup. Neither URLs nor titles leave the device.

### `scripting`

**日本語**
拡張のインストール前から開いていたタブなど、まだ本体スクリプト（content.js）が入っていないタブに、後からスクリプトを注入するために必要。注入するのは拡張パッケージ内の content.js のみで、リモートのコードは一切読み込まない。

**English**
Needed to inject the content script into tabs that were already open before the extension was installed (or where the script is not yet present). Only the packaged content.js is injected; no remote code is ever loaded.

### `storage`

**日本語**
次の3つを保存するために必要。
- ON / OFF の状態（`storage.local`）
- 現在の選択文字列（`storage.session`。ブラウザを閉じると消える。再読み込みしたタブにハイライトを復元するため）
- Pro 版の設定（`storage.sync`。色や除外ドメインなど）とライセンスの検証結果（`storage.local`）
閲覧履歴やページ内容は保存しない。

**English**
Needed to store three things: the ON/OFF state (storage.local); the current selection (storage.session, cleared when the browser closes, used to restore highlights on reloaded tabs); and Pro settings (storage.sync: colors, excluded domains, etc.) plus the license verification result (storage.local). Browsing history and page content are never stored.

### ホスト権限 `<all_urls>`

**日本語**
利用者がどのサイトを照合に使うか（社内システム、EC の管理画面、チャット、Web メールなど）を事前に限定できないため、任意のページに本体スクリプトを入れられる必要がある。スクリプトがページで行うのは、(1) 利用者が選択した文字列を拡張内部に伝える、(2) 指示された文字列と一致するテキストに `<mark>` 要素を付ける、の2つだけ。ページの内容を読み取って端末外に送ることはない。リッチテキストエディタ（contenteditable）内は書き換えない。

**English**
The pages a user compares (internal systems, e-commerce admin panels, chat, webmail, etc.) cannot be known in advance, so the content script must be able to run on any page. On a page the script does only two things: (1) report the text the user selected to the extension itself, and (2) wrap text matching the requested string in `<mark>` elements. It never reads page content to send it off the device, and it never edits rich-text editors (contenteditable).

## リモートコード

使用しない（No）。すべてのコードは拡張パッケージに含まれ、外部からスクリプトを読み込まない。

Not used. All code ships in the package; no scripts are loaded from outside.

## データ使用の申告（Data usage disclosure）

| 項目 | 回答 |
|---|---|
| 個人を特定できる情報 | 収集しない |
| 健康情報 | 収集しない |
| 財務・支払い情報 | 収集しない |
| 認証情報 | 収集しない |
| 個人的なコミュニケーション | 収集しない |
| 位置情報 | 収集しない |
| ウェブの履歴 | 収集しない |
| ユーザーのアクティビティ | 収集しない |
| ウェブサイトのコンテンツ | 収集しない（一致箇所の表示のために端末内で読むが、保存も送信もしない） |

補足: Pro 版のライセンス確認では、利用者が入力したライセンスキー文字列のみを販売プラットフォーム Polar.sh の検証 API に送る。選択文字列・URL・ページ内容は含まない。無料版は通信を一切行わない。

Note: The Pro license check sends only the license key string the user typed to the verification API of the payment provider Polar.sh. Selected text, URLs and page content are never included. The free version makes no network requests at all.

## 認証事項

- 「限定的な使用」の要件に従う: 収集データなし、第三者への提供なし
- プライバシーポリシー URL: https://km-tools.github.io/cross-window-highlight/privacy.html
