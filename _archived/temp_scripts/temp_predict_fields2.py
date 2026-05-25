import os
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
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

    list_url = f"{LOGIN_URL}?__mode=list&_type=entry&blog_id=73"
    res_list = session.get(list_url, headers=headers)
    soup_list = BeautifulSoup(res_list.text, 'html.parser')

    entries = []
    for a in soup_list.find_all('a', href=True):
        if "__mode=view" in a['href'] and "_type=entry" in a['href'] and "id=" in a['href']:
            if a['href'] not in entries:
                entries.append(a['href'])
            if len(entries) >= 3:
                break

    for idx, edit_url in enumerate(entries):
        if not edit_url.startswith('http'):
            if edit_url.startswith('?'):
                full_edit_url = LOGIN_URL + edit_url
            else:
                full_edit_url = urllib.parse.urljoin("https://www.pets-kennel.com", edit_url)
        else:
            full_edit_url = edit_url

        res_edit = session.get(full_edit_url, headers=headers)
        soup_edit = BeautifulSoup(res_edit.text, 'html.parser')
        
        title = soup_edit.find('input', {'name': 'title'})
        title_val = title.get('value', '') if title else ''
        
        print(f"\n=== 記事 {idx + 1}: {title_val} ===")

        for tag in soup_edit.find_all(['input', 'textarea']):
            name = tag.get('name')
            if not name: continue
            
            if name.startswith('text') or name.startswith('textarea') or name.startswith('date') or 'price' in name.lower() or 'sex' in name.lower():
                if name.startswith('textarea_') or name.startswith('text_'): continue
                t = tag.name
                t_attr = tag.get('type', '')
                if t == 'input' and t_attr == 'hidden': continue
                
                val = tag.get('value', '') if t == 'input' else tag.get_text(strip=True) if t == 'textarea' else ''
                if val:
                    print(f"Field: {name:<15} | Value: {val}")

if __name__ == "__main__":
    main()
