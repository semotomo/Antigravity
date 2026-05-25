import os
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

USERNAME = os.getenv("CMS_USERNAME")
PASSWORD = os.getenv("CMS_PASSWORD")

if not USERNAME or not PASSWORD:
    print("Error: .env に CMS_USERNAME または CMS_PASSWORD が設定されていません。")
    exit(1)

LOGIN_URL = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi"

def test_login_and_fetch_dashboard():
    session = requests.Session()
    
    # 401エラーが出たため、まずはBasic認証を試す
    session.auth = (USERNAME, PASSWORD)
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    }
    
    print("1. ログインページ（あるいはダッシュボード）にアクセスします...")
    try:
        res = session.get(f"{LOGIN_URL}?__mode=dashboard", headers=headers)
        res.raise_for_status()
        print("Basic認証（または単純なアクセス）に成功しました。")
    except requests.exceptions.HTTPError as e:
        print(f"アクセスエラー: {e}")
        return
    
    soup = BeautifulSoup(res.text, 'html.parser')
    
    title = soup.title.string if soup.title else "タイトルなし"
    print(f"\n--- ページ解析 ---")
    print(f"ページタイトル: {title}")
    
    # フォームがあるかどうか確認
    form = soup.find('form')
    if form and 'login' in (form.get('action') or '').lower() + res.text.lower():
        print("Webページ上のログインフォームが検出されました。追加のログインが必要です。")
        
        payload = {}
        for input_tag in form.find_all('input'):
            name = input_tag.get('name')
            value = input_tag.get('value', '')
            type_attr = input_tag.get('type', 'text').lower()
            
            if name:
                if type_attr == 'text' or name == 'username':
                    payload[name] = USERNAME
                elif type_attr == 'password':
                    payload[name] = PASSWORD
                else:
                    payload[name] = value

        print("2. フォームログインを試行します...")
        action_url = form.get('action') or LOGIN_URL
        if not action_url.startswith('http'):
            action_url = "https://www.pets-kennel.com" + action_url

        login_res = session.post(action_url, data=payload, headers=headers)
        
        if "dashboard" in login_res.url.lower() or "mode=dashboard" in login_res.text.lower():
            print("フォームログイン成功（ダッシュボード画面）の可能性があります。")
        else:
            print("ダッシュボード画面ではない可能性があります。")
        
        dashboard_soup = BeautifulSoup(login_res.text, 'html.parser')
        title = dashboard_soup.title.string if dashboard_soup.title else "タイトルなし"
        print(f"ページタイトル(ログイン後): {title}")
        print("ページ内の主なテキスト:")
        print(dashboard_soup.get_text(separator=' ', strip=True)[:500] + "...")
    else:
        print("ログインフォームは見つかりませんでした。すでにダッシュボードが表示されている可能性があります。")
        print("ページ内の主なテキスト:")
        print(soup.get_text(separator=' ', strip=True)[:1000] + "...")

if __name__ == "__main__":
    test_login_and_fetch_dashboard()
