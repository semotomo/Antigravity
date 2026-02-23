# 📅 シフト作成ツール

スタッフの勤務条件・役割・休暇希望から、最適なシフトを**自動で作成**するWebアプリです。

## ✨ 機能

- **自動シフト生成**: ビームサーチアルゴリズムにより、複数の制約を考慮した最適なシフトを作成
- **役割自動割り当て**: A/B/C/ネコ の役割を自動で最適配置
- **希望休の完全反映**: スタッフの希望休は必ず反映
- **曜日別目標人数**: 曜日ごとに朝・夜の推奨人数を設定可能
- **CSV出力**: Excel対応のCSVファイルをダウンロード
- **設定保存**: スタッフ情報・休暇データをJSON形式で保存・復元

## 🚀 使い方

### オンラインで使う
> **[📅 シフト作成ツールを開く](https://your-app-url.streamlit.app)** ← デプロイ後にURLを更新

### ローカルで実行する

```bash
# リポジトリをクローン
git clone https://github.com/your-username/Antigravity.git
cd Antigravity

# 依存関係をインストール
pip install -r requirements.txt

# アプリを起動
python -m streamlit run app.py
```

## 📊 シフト表の見方

| 記号 | 意味 | 色 |
|------|------|----|
| A | 朝番メイン | 水色 |
| B | 日勤メイン | 緑 |
| C | 遅番メイン | 黄色 |
| ネコ | ネコ番 | オレンジ |
| 〇 | 通常勤務 | ラベンダー |
| ／ | 公休 | ピンク |
| × | 希望休 | グレー |
| ※ | 人員不足 | 赤 |

## 🛠 技術スタック

- **フロントエンド/バックエンド**: [Streamlit](https://streamlit.io/)
- **言語**: Python 3.10+
- **最適化**: ビームサーチアルゴリズム
- **ホスティング**: Streamlit Community Cloud

## 📁 ファイル構成

```
Antigravity/
├── app.py           # メインUI（Streamlit）
├── solver.py        # シフト生成エンジン
├── utils.py         # ユーティリティ関数
├── data_io.py       # データ入出力
├── requirements.txt # 依存関係
├── .streamlit/
│   └── config.toml  # テーマ設定
└── README.md        # このファイル
```

## 📄 ライセンス

Private - All rights reserved.
