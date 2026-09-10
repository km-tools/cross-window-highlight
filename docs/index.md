# Cross-Window Highlight / クロスウィンドウ・ハイライト

選択した文字を、他のタブ／ウィンドウでも自動でハイライトする Chrome 拡張です。
2画面で照合・突合をする事務・経理・法務・校正の作業向け。

A Chrome extension that automatically highlights your selected text in every other tab and window.
Built for side-by-side checking and reconciliation work.

## 使い方 / How to use

1. ツールバーのアイコンをクリックし、スイッチを ON にする
2. どこかのページで文字を選択する
3. 他のタブ／ウィンドウの一致箇所が黄色く光る

1. Click the toolbar icon and turn the switch ON
2. Select text on any page
3. Matches light up in your other tabs and windows

- ON / OFF: `Ctrl+Shift+H`（Mac: `Cmd+Shift+H`）
- そのページのハイライトだけ消す / Clear highlights on the current page only: `Esc`

## 一致の見かた / Reading the colors

黄色は**完全一致**、薄い橙 + 点線は**表記違いの一致**（空白・ハイフン・全角半角・大文字小文字の違いを無視して一致）。光った＝正しい、ではありません。
Yellow means an **exact match**. Light orange with a dotted underline means the match **differs in formatting** (spaces, hyphens, full-width/half-width, letter case were ignored). A highlight is not proof of a correct transcription.

一致が 0 件のときは、「一致なし」と「確認できなかったタブがある」を分けて表示します。
When nothing matches, the popup tells you whether there was truly no match or some tabs could not be checked.

## プライバシー / Privacy

データは一切収集しません。選択した文字列は端末内のタブ間でしか受け渡されません。
We collect no data. Selected text never leaves your device.

→ [プライバシーポリシー / Privacy Policy](privacy.html)

## リンク / Links

- ソースコード / Source: [GitHub](https://github.com/km-tools/cross-window-highlight)（MIT License）
- Chrome ウェブストア / Chrome Web Store: 審査中 / under review
<!-- 公開後にこの行と差し替える: - [Chrome ウェブストア / Chrome Web Store](https://chromewebstore.google.com/detail/<拡張ID>) -->
