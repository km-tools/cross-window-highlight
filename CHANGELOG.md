# 更新履歴 / Changelog

ストアの「新機能」欄にはこの内容をそのまま使う。

## 3.0.0（2026-09-10）

Chrome ウェブストア初公開のバージョンです。

### 日本語

- 設定画面（ポップアップ）を追加しました。ON / OFF のスイッチ、いまハイライト中の文字列、ショートカットの確認ができます。アイコンをクリックするとポップアップが開きます（以前のように、クリックだけで ON / OFF は切り替わりません）
- 完全一致と、表記の違い（空白・ハイフン・全角半角・大文字小文字）を無視して一致した箇所を、色で区別するようにしました。表記違いの一致は薄い橙に点線が付き、マウスを乗せると説明が出ます
- 一致が 0 件のとき、「他のタブに一致がなかった」のか「確認できなかったタブがあった」のかを分けて表示するようにしました。確認できなかったタブは、タイトルと理由をポップアップで確認できます
- 英語表示に対応しました
- Pro 版（ライセンスキーで解放）を追加しました。ハイライト色の変更、厳密比較モード、最小文字数の変更、除外ドメイン、ヒット件数のアイコン表示、複数キーワードの同時ハイライト、iframe 内のハイライトが使えます
- 休止中のタブには処理を送らないようにしました

ハイライトの仕組み（全角半角の正規化、リッチテキストエディタを書き換えない、入力中は再ハイライトを保留する）は 2.x から変えていません。

### English

- Added a settings popup with the ON / OFF switch, the text currently highlighted, and the keyboard shortcut. Clicking the toolbar icon now opens the popup instead of toggling directly
- Exact matches and matches that differ only in formatting (spaces, hyphens, full-width / half-width, letter case) are now shown in different colors. Formatting-different matches are light orange with a dotted underline and show an explanation on hover
- When nothing matches, the popup now tells you whether there was truly no match in other tabs or some tabs could not be checked, and lists those tabs with a reason
- Added English UI
- Added Pro (unlocked with a license key): custom colors, strict comparison mode, minimum length, excluded domains, match count on the icon, multiple keywords at once, and highlighting inside iframes
- Sleeping (discarded) tabs are no longer sent highlight requests

The matching behavior itself (full-width normalization, never editing rich-text editors, deferring while you type) is unchanged from 2.x.

## 2.1.1 以前

ストア未公開。社内配布のみ。
