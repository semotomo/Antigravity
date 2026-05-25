import os
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
import urllib.parse

load_dotenv()

USERNAME = os.getenv("CMS_USERNAME")
PASSWORD = os.getenv("CMS_PASSWORD")
LOGIN_URL = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi"

def fetch_entry_data(session, url, label_prefix, f):
    headers = {
        'User-Agent': 'Mozilla/5.0'
    }
    
    f.write(f"\n========== {label_prefix} ==========\n")
    res = session.get(url, headers=headers)
    soup = BeautifulSoup(res.text, 'html.parser')

    title = soup.find('input', {'name': 'title'})
    f.write(f"タイトル (title): {title.get('value', '') if title else ''}\n")
    
    status = soup.find('select', {'name': 'status'})
    if status:
        selected = status.find('option', selected=True) or status.find('option')
        f.write(f"公開ステータス (status): {selected.get_text(strip=True) if selected else ''}\n")
        
    created_on = soup.find('input', {'name': 'created_on_date'})
    f.write(f"作成日 (created_on_date): {created_on.get('value', '') if created_on else ''}\n")
    
    cat_ids = soup.find('input', {'name': 'category_ids'})
    f.write(f"カテゴリIDs (category_ids): {cat_ids.get('value', '') if cat_ids else ''}\n")

    f.write("\n[ フィールド一覧 ]\n")
    for tag in soup.find_all(['input', 'textarea', 'select']):
        name = tag.get('name')
        if not name: continue
        if name in ['magic_token', 'return_args', 'username', 'password', 'title', 'status', 'created_on_date', 'category_ids']:
            continue
            
        t = tag.name
        t_attr = tag.get('type', '')
        if t == 'input' and t_attr == 'hidden': continue
        
        val = ""
        checked = None
        
        if t == 'select':
            sel_opt = tag.find('option', selected=True)
            val = sel_opt.get_text(strip=True) if sel_opt else ""
        elif t == 'textarea':
            val = tag.get_text(strip=True)
        else:
            val = tag.get('value', '')
            
        if t_attr in ['radio', 'checkbox']:
            checked = (tag.get('checked') is not None)
            
        if t_attr in ['radio', 'checkbox']:
            if not checked: continue
        elif not val.strip():
            continue
            
        desc = f"Name: {name:<20} | Type: {t:<8} {t_attr:<8} | Value: {val}"
        if checked is not None:
            desc += f" | Checked: {checked}"
        f.write(desc + "\n")

def main():
    session = requests.Session()
    session.auth = (USERNAME, PASSWORD)
    headers = {'User-Agent': 'Mozilla/5.0'}

    res = session.get(f"{LOGIN_URL}?__mode=dashboard", headers=headers)
    soup = BeautifulSoup(res.text, 'html.parser')
    form = soup.find('form')
    if form and 'login' in (form.get('action') or '').lower() + res.text.lower():
        payload = {}
        for input_tag in form.find_all('input'):
            name = input_tag.get('name')
            t = input_tag.get('type', 'text').lower()
            if name:
                if t == 'text' or name == 'username': payload[name] = USERNAME
                elif t == 'password': payload[name] = PASSWORD
                else: payload[name] = input_tag.get('value', '')
        action_url = form.get('action') or LOGIN_URL
        if not action_url.startswith('http'): action_url = urllib.parse.urljoin("https://www.pets-kennel.com", action_url)
        session.post(action_url, data=payload, headers=headers)

    url_dog = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi?__mode=view&_type=entry&blog_id=73&id=5976"
    url_cat = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi?__mode=view&_type=entry&blog_id=82&id=5964"

    with open("temp_scrape_result.txt", "w", encoding="utf-8") as f:
        fetch_entry_data(session, url_dog, "犬の販売 (ID:5976)", f)
        fetch_entry_data(session, url_cat, "猫の販売 (ID:5964)", f)

if __name__ == "__main__":
    main()
