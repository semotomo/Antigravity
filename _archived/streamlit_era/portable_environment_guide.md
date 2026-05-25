# ポータブル環境セットアップガイド

> 他のPCやプロジェクトで現在の AI 開発環境を再現するための完全ガイド
>
> 最終更新: 2026-02-23

---

## 1. 前提条件

| ツール | インストール | 用途 |
|-------|------------|------|
| **Node.js** (v18+) | [nodejs.org](https://nodejs.org/) | スキルインストール・MCP実行 |
| **npm / npx** | Node.jsに同梱 | パッケージ管理 |
| **Python 3.10+** | [python.org](https://python.org/) | 音声文字起こし等のスクリプト |
| **ffmpeg** | `winget install ffmpeg` | 動画・音声処理 |
| **yt-dlp** | `pip install yt-dlp` | YouTube動画ダウンロード |
| **Git** | [git-scm.com](https://git-scm.com/) | リポジトリ管理 |

---

## 2. MCP サーバー設定

### Context7（ライブラリドキュメント自動参照）

**設定ファイル**: `~/.gemini/antigravity/mcp_config.json`

```json
{
    "mcpServers": {
        "context7": {
            "command": "npx",
            "args": ["-y", "@upstash/context7-mcp@latest"]
        }
    }
}
```

**機能**: ライブラリ/フレームワークの最新ドキュメントを自動取得。コード生成時に最新APIを参照できる。

---

## 3. スキル一括インストール

全スキルをインストールするコマンド（プロジェクトルートで実行）:

```bash
# ── 基本スキル（事前インストール済みのもの） ──
# browser-use, ui-ux-pro-max, supabase-postgres-best-practices, find-skills
# → これらは Antigravity に標準付属

# ── 動画・音声系 ──
npx skills add --yes op7418/youtube-clipper-skill@youtube-clipper
npx skills add --yes sickn33/antigravity-awesome-skills@audio-transcriber

# ── マーケティング系 ──
npx skills add --yes coreyhaines31/marketingskills@copywriting
npx skills add --yes coreyhaines31/marketingskills@marketing-psychology
npx skills add --yes coreyhaines31/marketingskills@seo-audit
npx skills add --yes coreyhaines31/marketingskills@product-marketing-context

# ── ツール作成系 ──
npx skills add --yes sickn33/antigravity-awesome-skills@viral-generator-builder

# ── claude-code-harness（37スキル一括） ──
npx skills add Chachamaru127/claude-code-harness -g -y
```

> [!IMPORTANT]
> `npx skills` コマンドは **Antigravity / Claude Code** のスキルエコシステム用コマンドです。
> プロジェクトに `.agents/skills/` ディレクトリが自動作成され、そこにスキルがインストールされます。

---

## 4. スキル一覧と概要

### 4.1 標準付属スキル（4個）

| スキル | 用途 | 発動例 |
|-------|------|-------|
| **browser-use** | ブラウザ自動操作・スクレイピング | 「BOOTHの売上を取得して」 |
| **ui-ux-pro-max** | UI/UXデザイン・9スタック対応コード生成 | 「LPを作って」 |
| **supabase-postgres-best-practices** | DB設計・SQL最適化・RLS | 「このSQLを最適化して」 |
| **find-skills** | 新スキルの検索・インストール | 「〇〇ができるスキルある？」 |

### 4.2 追加インストールスキル（7個）

| スキル | ソース | 用途 |
|-------|-------|------|
| **youtube-clipper** | `op7418/youtube-clipper-skill` | YouTube動画のクリップ切り出し・短尺動画化 |
| **audio-transcriber** | `sickn33/antigravity-awesome-skills` | 音声文字起こし → Markdown議事録生成 |
| **copywriting** | `coreyhaines31/marketingskills` | 成約率の高いコピー文の生成（PAS/AIDA等） |
| **marketing-psychology** | `coreyhaines31/marketingskills` | 行動心理学に基づいたマーケ施策提案 |
| **seo-audit** | `coreyhaines31/marketingskills` | コンテンツのSEO監査・改善提案 |
| **viral-generator-builder** | `sickn33/antigravity-awesome-skills` | バイラル診断ツール・ジェネレーター作成 |
| **product-marketing-context** | `coreyhaines31/marketingskills` | プロダクトのマーケ戦略・ペルソナ設計 |

### 4.3 claude-code-harness（37スキル一括パック）

`Chachamaru127/claude-code-harness` から一括インストール。主要なものを抜粋:

| カテゴリ | 含まれるスキル |
|---------|-------------|
| **ハーネス管理** | `harness-init`, `harness-review`, `harness-update`, `release-har` |
| **セッション管理** | `session-init`, `session-memory`, `session-state`, `session-control` |
| **開発ワークフロー** | `impl`, `crud`, `deploy`, `ci`, `verify`, `troubleshoot`, `maintenance`, `setup` |
| **計画・エージェント** | `plan-with-agent`, `plans-management`, `parallel-workflows`, `workflow-guide` |
| **コンテンツ生成** | `generate-slide`, `generate-video` |
| **メモリ管理** | `memory`, `handoff`, `sync-status` |
| **その他** | `auth`, `ui`, `notebooklm`, `agent-browser`, `vibecoder-guide` 等 |

---

## 5. 設定ファイルの移行

新プロジェクトに以下のファイルをコピーして適用:

### 必須ファイル

| ファイル | 配置先 | 説明 |
|---------|-------|------|
| `CLAUDE.md` | プロジェクトルート | AI共通ルール（言語/出力/スキルルーティング/セキュリティ等） |
| `.agents/AGENTS.md` | `.agents/` | エージェント共通ルール・スキルルーティング表 |
| `mcp_config.json` | `~/.gemini/antigravity/` | MCP設定（Context7等） |

### 推奨ファイル

| ファイル | 配置先 | 説明 |
|---------|-------|------|
| `reports/06_installed_skills.md` | `reports/` | スキル詳細リファレンス |

---

## 6. ユーザーグローバルルール

Antigravity の **User Rules** に以下を設定（全プロジェクト共通で適用される）:

```
すべて日本語で応答してください。

**重要:**
AIエージェント間でルールやコンテキストの食い違いを防ぐため、
プロジェクトのメインの指示フォーマットとして **`CLAUDE.md`** を使用します。
作業を開始する際は、必ず対象プロジェクトのルートディレクトリにある
`CLAUDE.md` を読み込み、そこに記載されている指示、設定、
MCP連携ツールのルールに完全に従ってください。
```

> [!TIP]
> この設定は Antigravity の設定画面 → User Rules から追加できます。

---

## 7. 追加の依存関係（スキルが必要とするもの）

| スキル | 必要なツール | インストール |
|-------|------------|------------|
| **youtube-clipper** | yt-dlp, ffmpeg | `pip install yt-dlp` / `winget install ffmpeg` |
| **audio-transcriber** | faster-whisper, ffmpeg | `pip install faster-whisper` |
| **browser-use** | browser-use CLI | `pip install browser-use` → `browser-use doctor` で確認 |

---

## 8. クイックセットアップ手順（新PC用チェックリスト）

```
1. [ ] Node.js, Python, Git, ffmpeg をインストール
2. [ ] Antigravity (VS Code拡張) をインストール
3. [ ] User Rules にグローバルルールを設定（セクション6参照）
4. [ ] mcp_config.json を ~/.gemini/antigravity/ に配置
5. [ ] プロジェクトルートに CLAUDE.md をコピー
6. [ ] .agents/AGENTS.md をコピー
7. [ ] スキル一括インストールコマンドを実行（セクション3参照）
8. [ ] 追加依存関係をインストール（セクション7参照）
9. [ ] browser-use doctor で動作確認
```
