# everything-claude-code の導入計画

ユーザーの要望に従い、`everything-claude-code` をインストールし、`antigravity` および `codex` 向けに最適化を図ります。

## User Review Required
> [!IMPORTANT]
> ルール1に基づき、下記のコマンド等を用いて導入・変更作業を進めます。  
> 実行して問題なければ「y」とご返信ください。何か修正すべき点があればお知らせください。

## Proposed Changes
### ステップ1: リポジトリの取得とビルド
1. 作業用として `everything-claude-code` プロジェクトを、現在のディレクトリ (`C:\Users\kirik\Desktop\Antigravity`) の中にクローンして配置します。
2. 依存関係の解決のため `npm install` を実行します。

### ステップ2: Antigravity（現行プロジェクト）向けの最適化
1. リポジトリ内にある `install.ps1` を使用し、`antigravity` をターゲットとして、プロジェクトで使われている主要言語（Python・TypeScript等）用のルールやシステムプロンプトをインストールします。  
   - 実行予定コマンド例: `.\everything-claude-code\install.ps1 --target antigravity typescript python`

### ステップ3: Codex向けの最適化
1. Codexアプリ/CLI向けの設定を同期・最適化します。  
   - 実行予定コマンド: `bash everything-claude-code/scripts/sync-ecc-to-codex.sh`  
   （※Windows上でbashが利用できない場合は、設定ファイルを `.codex` ディレクトリや手動でコピーする代替手段を用います）

## Verification Plan
### Automated Tests
- 各手順のコマンドがエラー無く正常終了するかを確認します。
### Manual Verification
- コマンド類やルールが正常に配置されたか確認ディレクトリ（`~/.claude/` や `~/.codex/` など）を表示してユーザーに報告し、完了とします。
