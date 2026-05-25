import streamlit as st
import os
import requests
import pandas as pd
from dotenv import load_dotenv

load_dotenv()

st.set_page_config(page_title="CMS Pets Viewer", page_icon="🐾", layout="wide")
st.title("🐾 CMSからの生体データ取得 確認ビューア")
st.write("Supabaseへ同期された「犬の販売」「猫の販売」データを簡易表示しています。")

# 認証情報の取得（Streamlitのsecrets.toml または .env）
@st.cache_resource
def get_supabase_creds():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if url and key:
        return url, key
    try:
        url = st.secrets["supabase"]["url"]
        key = st.secrets["supabase"]["key"]
        return url, key
    except Exception:
        pass
    return None, None

url, key = get_supabase_creds()

if not url or not key:
    st.error("Supabaseの認証情報（URL, KEY）が見つかりません。`.streamlit/secrets.toml`の設定を確認してください。")
    st.stop()

@st.cache_data(ttl=10) # 10秒キャッシュ
def fetch_pets_data():
    endpoint = f"{url.rstrip('/')}/rest/v1/cms_pets?select=*&order=created_at.desc"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    res = requests.get(endpoint, headers=headers)
    res.raise_for_status()
    return res.json()

try:
    data = fetch_pets_data()
    if data:
        df = pd.DataFrame(data)
        
        # 見やすいように列の並びや名前を調整（存在するものだけ）
        display_cols = [
            'management_no', 'publish_status', 'species', 'breed', 
            'price_tax_included', 'gender', 'birth_date', 'birth_place', 
            'coat_color', 'vaccines', 'cms_updated_at'
        ]
        existing_cols = [c for c in display_cols if c in df.columns]
        
        # 表示用にDataFrameを整形
        df_display = df[existing_cols].copy()
        
        st.success(f"Supabaseから {len(df_display)} 件の生体データを取得しました！")
        
        # Streamlitでおしゃれにテーブル表示
        st.dataframe(
            df_display,
            use_container_width=True,
            column_config={
                "management_no": "管理番号",
                "publish_status": "公開状態",
                "species": "種類",
                "breed": "品種/毛種",
                "price_tax_included": st.column_config.NumberColumn(
                    "価格(税込)", format="¥%d"
                ),
                "gender": "性別",
                "birth_date": "生年月日",
                "birth_place": "出身地",
                "coat_color": "毛色",
                "vaccines": "ワクチン",
                "cms_updated_at": "CMS更新日時"
            },
            hide_index=True
        )
        
    else:
        st.warning("現在テーブルにデータが存在しません。「sync_cms_pets.py」を実行してデータを取得してください。")
        
except Exception as e:
    st.error(f"APIエラーが発生しました: {e}")

if st.button("🔄 データを再読み込み", use_container_width=True):
    st.cache_data.clear()
    st.rerun()
