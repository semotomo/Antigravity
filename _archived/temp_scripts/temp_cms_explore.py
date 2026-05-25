import os
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
import re
import urllib.parse

load_dotenv()
USERNAME = os.getenv("CMS_USERNAME")
PASSWORD = os.getenv("CMS_PASSWORD")
LOGIN_URL = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi"

def main():
    session = requests.Session()
    session.auth = (USERNAME, PASSWORD)
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    }

    print("1. ダッシュボードへアクセス...")
    res = session.get(f"{LOGIN_URL}?__mode=dashboard", headers=headers)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, 'html.parser')

    form = soup.find('form')
    if form and 'login' in (form.get('action') or '').lower() + res.text.lower():
        print("2. フォームログイン実行...")
        payload = {}
        for input_tag in form.find_all('input'):
            name = input_tag.get('name')
            value = input_tag.get('value', '')
            t = input_tag.get('type', 'text').lower()
            if name:
                if t == 'text' or name == 'username': payload[name] = USERNAME
                elif t == 'password': payload[name] = PASSWORD
                else: payload[name] = value

        action_url = form.get('action') or LOGIN_URL
        if not action_url.startswith('http'): action_url = urllib.parse.urljoin("https://www.pets-kennel.com", action_url)
        res = session.post(action_url, data=payload, headers=headers)

    soup = BeautifulSoup(res.text, 'html.parser')
    
    print("3. 「犬の販売」「猫の販売」のリンク（ブログID等）を探します...")
    target_blogs = []
    for a in soup.find_all('a', href=True):
        text = a.get_text(strip=True)
        if "犬の販売" in text or "猫の販売" in text:
            # href の中から blog_id を探す
            match = re.search(r'blog_id=(\d+)', a['href'])
            if match:
                b_id = match.group(1)
                if not any(b['id'] == b_id for b in target_blogs):
                    target_blogs.append({'name': text, 'id': b_id, 'url': a['href']})
                    
    print("見つかったブログ:", target_blogs)

    if not target_blogs:
        print("犬の販売・猫の販売のリンクが見つかりませんでした。")
        return

    blog_id = target_blogs[0]['id']
    list_url = f"{LOGIN_URL}?__mode=list&_type=entry&blog_id={blog_id}"
    print(f"\n4. 記事一覧 ({list_url}) へアクセス...")
    res_list = session.get(list_url, headers=headers)
    soup_list = BeautifulSoup(res_list.text, 'html.parser')

    # 最近の記事の編集リンクを探す
    entries = []
    for a in soup_list.find_all('a', href=True):
        if "__mode=view" in a['href'] and "_type=entry" in a['href'] and "id=" in a['href']:
            entries.append(a['href'])

    if not entries:
        print("記事の編集リンクが見つかりませんでした。")
        return

    edit_url = entries[0]
    # urljoin を安全に使う
    if not edit_url.startswith('http'):
        if edit_url.startswith('?'):
            full_edit_url = LOGIN_URL + edit_url
        else:
            full_edit_url = urllib.parse.urljoin("https://www.pets-kennel.com", edit_url)
    else:
        full_edit_url = edit_url

    print(f"\n5. 編集ページ ({full_edit_url}) を取得してフィールドを解析します...")
    # sleep required?? just get it.
    res_edit = session.get(full_edit_url, headers=headers)
    
    with open("temp_entry_edit.html", "w", encoding="utf-8") as f:
        f.write(res_edit.text)
    
    soup_edit = BeautifulSoup(res_edit.text, 'html.parser')
    print("\n--- 取得対象フィールドの調査 ---")
    
    title_input = soup_edit.find('input', {'name': 'title'})
    print(f"タイトル (name='title'): {title_input.get('value') if title_input else '見つかりません'}")
    
    status_select = soup_edit.find('select', {'name': 'status'})
    if status_select:
        selected = status_select.find('option', selected=True) or status_select.find('option')
        print(f"公開ステータス (name='status'): {selected.get_text(strip=True) if selected else '未選択'}")
    
    print("\n[入力・選択フィールド一覧（カスタムフィールド等抜粋）]")
    for tag in soup_edit.find_all(['input', 'select', 'textarea']):
        name = tag.get('name')
        if not name or name in ['magic_token', 'return_args', 'username', 'password', 'status', 'title']:
            continue
            
        t = tag.name
        t_attr = tag.get('type', '')
        if t == 'input' and t_attr == 'hidden':
            continue 
            
        label = ""
        tag_id = tag.get('id')
        if tag_id:
            label_tag = soup_edit.find('label', {'for': tag_id})
            if label_tag:
                label = label_tag.get_text(strip=True)
                
        # selectの選択値
        if t == 'select':
            sel_opt = tag.find('option', selected=True)
            val = sel_opt.get_text(strip=True) if sel_opt else tag.find('option').get_text(strip=True) if tag.find('option') else ''
        else:
            val = tag.get('value', '') if t == 'input' else tag.get_text(strip=True) if t == 'textarea' else ''
            
        checked = tag.get('checked') is not None if t_attr in ['radio', 'checkbox'] else None
        
        # 不要なものを弾く
        if not name.startswith('customfield_') and not 'category' in name.lower() and not 'keyword' in name:
            continue
            
        preview = val[:30] + '...' if len(val) > 30 else val
        desc = f"Name: {name:<30} | Type: {t:<8} {t_attr:<8} | Label: {label:<15} | Value: {preview}"
        if checked is not None:
            desc += f" | Checked: {checked}"
        
        print(desc)

if __name__ == "__main__":
    main()
