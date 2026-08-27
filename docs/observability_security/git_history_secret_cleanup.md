# Git履歴から旧パスワードを安全に除外する手順

## 現在の状態

- `_archived/streamlit_era/.streamlit/secrets.toml` は現行ブランチから削除し、既存の `.gitignore` で再登録を防ぐ。
- ただし、過去のGitコミットにはまだ内容が残っている。
- 履歴の書き換え、GitHubへの強制push、他の作業コピーの更新はまだ行わない。
- 旧パスワードはGit履歴整理とは別に、利用先で先にローテーションする。履歴から消しても漏えい済みの値は無効にならない。

## 使いやすく安全な進め方

### 1. 事前条件

1. 旧パスワードを利用先で変更する。
2. GitHub CLIを正しい`semotomo`アカウントで再認証する。
3. `git-filter-repo`を導入する。
4. 作業者へ、履歴書き換え後は既存cloneの取り直しまたは明示的な再同期が必要と伝える。

```powershell
gh auth login --hostname github.com --web --git-protocol https
gh auth status
py -m pip install --user git-filter-repo
git filter-repo --version
```

### 2. 元リポジトリを触らず専用ミラーを作る

PowerShellで、存在しない一時出力先を指定する。

```powershell
.\scripts\prepare_git_history_secret_cleanup.ps1 -OutputDirectory 'D:\temp\kennel-history-cleanup.git'
```

このスクリプトが行うのは次の処理だけである。

1. GitHubの現在状態から専用ミラーを作る。
2. 専用ミラー内だけで対象ファイルを全コミットから除外する。
3. 対象ファイルを含むコミットが0件になったことを確認する。
4. 誤送信防止のためpush先を外し、GitHubへはpushせず停止する。

### 3. 強制push前の確認

- 元リポジトリの`origin`が `https://github.com/semotomo/Antigravity.git` である。
- 専用ミラーにpush先が登録されていない。
- 対象ファイルの履歴が0件である。
- 主要ブランチとタグの本数が元リポジトリと一致する。
- 旧パスワードのローテーションが完了している。
- GitHubへ送る全ref差分と、影響を受ける利用者を確認済みである。

## 別承認が必要な操作

以下は履歴を不可逆に入れ替えるため、この手順書の準備完了だけでは実行しない。

- `git push --force --mirror origin`
- GitHub上のキャッシュ・PR参照・forkへの追加対応
- 他のcloneやVercel連携ブランチの再同期

強制pushを行う場合は、対象ミラー、送信先、ref差分、ローテーション完了をユーザーへ提示してから明示承認を得る。

## 復旧

- 強制push前: 専用ミラーを削除すればよく、元リポジトリとGitHubは無変更。
- 強制push後: 事前に保存したGitHubのref一覧とバックアップミラーから復旧する。バックアップの保存場所と保持期限を作業記録へ残す。
