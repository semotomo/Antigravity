import os
import requests
import re
import urllib.parse
import time
from datetime import datetime
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
USERNAME = os.getenv("CMS_USERNAME")
PASSWORD = os.getenv("CMS_PASSWORD")
LOGIN_URL = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi"

def load_supabase_credentials():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if url and key:
        return url, key
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    secrets_path = os.path.join(project_root, ".streamlit", "secrets.toml")
    if os.path.exists(secrets_path):
        try:
            with open(secrets_path, "r", encoding="utf-8") as f:
                content = f.read()
                m_url = re.search(r'url\s*=\s*"([^"]+)"', content)
                m_key = re.search(r'key\s*=\s*"([^"]+)"', content)
                if m_url and m_key:
                    return m_url.group(1), m_key.group(1)
        except Exception:
            pass
    return None, None

SUPABASE_URL, SUPABASE_KEY = load_supabase_credentials()

BLOG_MAPPING = {
    '73': '犬',
    '82': '猫'
}

def parse_price(html_text):
    clean_text = html_text.replace(',', '').replace(' ', '').replace('\n', '')
    match_inc = re.search(r'税込(\d+)円', clean_text)
    inc_price = int(match_inc.group(1)) if match_inc else None
    
    prices = [int(p) for p in re.findall(r'(\d+)円', clean_text)]
    exc_price = None
    if prices:
        if inc_price:
            for p in prices:
                if p < inc_price:
                    exc_price = p
                    break
        else:
            exc_price = prices[0]
            
    return exc_price, inc_price

def parse_date(date_str):
    match = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日', date_str)
    if match:
        return f"{match.group(1)}-{match.group(2).zfill(2)}-{match.group(3).zfill(2)}"
    return None

def login_cms(session):
    headers = {'User-Agent': 'Mozilla/5.0'}
    session.auth = (USERNAME, PASSWORD)
    res = session.get(f"{LOGIN_URL}?__mode=dashboard", headers=headers)
    soup = BeautifulSoup(res.text, 'html.parser')
    form = soup.find('form')
    if form and 'login' in (form.get('action') or '').lower() + res.text.lower():
        payload = {}
        for input_tag in form.find_all('input'):
            name = input_tag.get('name')
            if name:
                t = input_tag.get('type', 'text').lower()
                if t == 'text' or name == 'username': payload[name] = USERNAME
                elif t == 'password': payload[name] = PASSWORD
                else: payload[name] = input_tag.get('value', '')
        action_url = form.get('action') or LOGIN_URL
        if not action_url.startswith('http'): 
            action_url = urllib.parse.urljoin("https://www.pets-kennel.com", action_url)
        session.post(action_url, data=payload, headers=headers)
    return session

def fetch_entries_for_blog(session, blog_id, limit=5):
    headers = {'User-Agent': 'Mozilla/5.0'}
    req_data = {
        '__mode': 'filtered_list',
        'datasource': 'entry',
        'blog_id': blog_id,
        'limit': str(limit),
        'sort_by': 'modified_on',
        'sort_direction': 'descend',
        'sort_order': 'descend'
    }
    
    list_res = session.get(f"{LOGIN_URL}?__mode=list&_type=entry&blog_id={blog_id}", headers=headers)
    lsoup = BeautifulSoup(list_res.text, 'html.parser')
    token_input = lsoup.find('input', {'name': 'magic_token'})
    if token_input:
        req_data['magic_token'] = token_input.get('value', '')
        
    time.sleep(1) # サーバ負荷軽減
    res_list = session.post(LOGIN_URL, data=req_data, headers=headers)
    urls = []
    if res_list.status_code == 200:
        try:
            data = res_list.json()
            if 'result' in data and 'objects' in data['result']:
                for obj in data['result']['objects']:
                    entry_id = obj[0] # Usually the ID is the first element
                    if not str(entry_id).isdigit():
                        m = re.search(r'\b(\d{4,})\b', str(obj))
                        if m: entry_id = m.group(1)
                    
                    if str(entry_id).isdigit():
                        url = f"{LOGIN_URL}?__mode=view&_type=entry&id={entry_id}&blog_id={blog_id}"
                        urls.append(url)
        except Exception:
            pass
            
    if not urls:
        for a in lsoup.find_all('a', href=True):
            if "__mode=view" in a['href'] and "id=" in a['href']:
                if a['href'] not in urls:
                    urls.append(a['href'])
                    
    return urls[:limit]

def scrape_entry_data(session, url, species):
    headers = {'User-Agent': 'Mozilla/5.0'}
    if not url.startswith('http'):
        url = urllib.parse.urljoin("https://www.pets-kennel.com", url)

    cms_entry_id = None
    m = re.search(r'id=(\d+)', url)
    if m:
        cms_entry_id = int(m.group(1))

    # リトライ処理（接続切断対策）
    max_retries = 3
    res_edit = None
    for i in range(max_retries):
        try:
            res_edit = session.get(url, headers=headers, timeout=15)
            break
        except requests.exceptions.RequestException as e:
            if i == max_retries - 1:
                print(f"    [!] スクレイピング失敗: {e}")
                return None
            time.sleep(2)

    if not res_edit:
        return None

    soup = BeautifulSoup(res_edit.text, 'html.parser')
    
    record = {
        'species': species,
        'cms_entry_id': cms_entry_id
    }
    
    title_el = soup.find('input', {'name': 'title'})
    title = title_el.get('value', '') if title_el else ''
    
    m_no = re.search(r'\b(1\d{5})\b', title)
    if m_no:
        record['management_no'] = m_no.group(1)
    else:
        text01 = soup.find('input', {'name': 'text01'})
        val01 = text01.get('value', '') if text01 else ''
        m_no2 = re.search(r'\b(1\d{5})\b', val01)
        record['management_no'] = m_no2.group(1) if m_no2 else f"UNKNOWN-{cms_entry_id}"

    clean_title = re.sub(r'\b(1\d{5})\b', '', title).replace('お問い合わせ番号','').strip()
    
    status_el = soup.find('select', {'name': 'status'})
    if status_el:
        sel = status_el.find('option', selected=True) or status_el.find('option')
        record['publish_status'] = sel.get_text(strip=True) if sel else ''
        
    # 本当の「更新日」は右サイドバーの revision-info クラスから取得
    revision_el = soup.find(class_=re.compile(r'revision-info', re.I))
    if revision_el:
        rev_text = revision_el.get_text(strip=True)
        # 「更新日:2026-03-30 17:28:13更新履歴を表示」のような文字列から日時を抽出
        m_rev = re.search(r'(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})', rev_text)
        if m_rev:
            record['cms_updated_at'] = f"{m_rev.group(1)} {m_rev.group(2)}"

    # 公開日も念のため別フィールドとして保持したい場合はここで authored_on_date を使う
    # (テーブルに published_at カラムを後で追加するまではコメントアウト)

    cat_ids = soup.find('input', {'name': 'category_ids'})
    record['cms_category_ids'] = cat_ids.get('value', '') if cat_ids else ''

    ta03 = soup.find('textarea', {'name': 'textarea03'})
    if ta03: record['birth_date'] = parse_date(ta03.get_text(strip=True))

    ta02 = soup.find('textarea', {'name': 'textarea02'})
    if ta02: record['birth_place'] = ta02.get_text(strip=True)

    ta04 = soup.find('textarea', {'name': 'textarea04'})
    if ta04: record['coat_color'] = ta04.get_text(strip=True)

    ta05 = soup.find('textarea', {'name': 'textarea05'})
    if ta05: record['vaccines'] = ta05.get_text(strip=True)

    ta09 = soup.find('textarea', {'name': 'textarea09'})
    if ta09:
        exc_p, inc_p = parse_price(ta09.get_text(strip=True))
        record['price_tax_excluded'] = exc_p
        record['price_tax_included'] = inc_p

    gender_radios = soup.find_all('input', {'name': 'genderselect'})
    for r in gender_radios:
        if r.get('checked') is not None:
            record['gender'] = r.get('value', '')
            break

    text07 = soup.find('input', {'name': 'text07'})
    if text07 and text07.get('value', '').strip():
        record['breed'] = text07.get('value', '').strip()
    else:
        record['breed'] = clean_title

    return record

def upsert_to_supabase(record):
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False, "API key missing"
        
    endpoint = f"{SUPABASE_URL.rstrip('/')}/rest/v1/cms_pets?on_conflict=management_no"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal"
    }
    clean_record = {k: v for k, v in record.items() if v is not None}
    
    res = None
    try:
        res = requests.post(endpoint, json=clean_record, headers=headers, timeout=10)
        res.raise_for_status()
        return True, ""
    except Exception as e:
        if res is not None:
            return False, f"HTTP {res.status_code} - {res.text}"
        return False, f"接続エラー: {e}"

def main():
    print("=== CMS同期スクリプト (最新の更新5件) ===")
    if SUPABASE_URL and SUPABASE_KEY:
        client_ready = True
    else:
        client_ready = False

    session = requests.Session()
    login_cms(session)

    for blog_id, species in BLOG_MAPPING.items():
        print(f"\n[{species}] の最新記事を取得中...")
        entry_urls = fetch_entries_for_blog(session, blog_id, limit=5)
        
        for url in entry_urls:
            time.sleep(1) # サーバ負荷軽減、連続アクセスによる切断防止
            record = scrape_entry_data(session, url, species)
            if not record:
                continue
                
            p = record.get('price_tax_included')
            print(f"  -> [{record.get('management_no')}] {record.get('breed')} / {p}円")
            
            if client_ready:
                success, err = upsert_to_supabase(record)
                if success:
                    print("     [OK] Supabase Upsert")
                else:
                    print(f"     [!] エラー: {err}")

    print("\n同期完了！")

if __name__ == "__main__":
    main()
