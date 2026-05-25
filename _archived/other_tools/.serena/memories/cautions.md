# 作業時の注意事項

## コード修正時の注意
- v2.0でモジュール分割済み。修正対象ファイルを間違えないこと
  - UIの修正 → `app.py`
  - ソルバーの修正 → `solver.py`
  - ユーティリティの修正 → `utils.py`
  - データIO修正 → `data_io.py`
- `solver.py` の `solve_schedule_from_ui()` は約250行の大関数。修正前に該当箇所を読むこと
- `expand_paths()` は `solve_schedule_from_ui()` の内部関数。スコープに注意
- ペナルティの重みバランスが繊細。変更時は複数パターンでテストすること
- `BEAM_WIDTH = 600` はパフォーマンスと品質のトレードオフ。変更は慎重に

## データ構造の注意
- `holidays_df` のカラムは `Day_1`, `Day_2`, ... の形式
- **JSONから読み込んだDataFrameのインデックスは文字列になる場合がある**
  - `.at[j, col]` ではなく `.iloc[j][col]` を使うこと（KeyError防止）
- `staff_df` は `reset_index(drop=True)` してから使用する（solver.py内部で実施済み）
- `fixed_shifts` は numpy配列 (num_staff × num_days)

## Streamlit固有の注意
- `st.session_state` でデータを保持。直接書き換えると再レンダリングされない
- `st.rerun()` を呼ぶとアプリ全体が再実行される
- `st.form` 内の変更は `submit` ボタン押下まで反映されない

## デプロイ関連
- GitHubリポジトリ: `semotomo/Antigravity`（main ブランチ）
- 変更をpush後、Streamlit Community Cloudで自動再デプロイされる
- `shift_settings.json` は `.gitignore` で除外されている（ユーザーデータ保護）

## 禁止事項
- `shift_settings.json` の手動削除（ユーザーデータが消失する）
- `applymap` の使用（pandas新版では `map` を使うこと）
- 実装済み機能の再実装（`key_tasks` で確認すること）
