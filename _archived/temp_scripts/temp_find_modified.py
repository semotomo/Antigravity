import os
import requests
import re
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
USERNAME = os.getenv("CMS_USERNAME")
PASSWORD = os.getenv("CMS_PASSWORD")
LOGIN_URL = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi"

session = requests.Session()
session.auth = (USERNAME, PASSWORD)
headers = {'User-Agent': 'Mozilla/5.0'}

res = session.get(f"{LOGIN_URL}?__mode=dashboard", headers=headers)
soup = BeautifulSoup(res.text, 'html.parser')
form = soup.find('form')
if form:
    payload = {}
    for inp in form.find_all('input'):
        name = inp.get('name')
        if name:
            t = inp.get('type','text').lower()
            if name == 'username': payload[name] = USERNAME
            elif t == 'password': payload[name] = PASSWORD
            else: payload[name] = inp.get('value','')
    session.post(LOGIN_URL, data=payload, headers=headers)

# id=5976: 既知の記事
url = f"{LOGIN_URL}?__mode=view&_type=entry&id=5976&blog_id=73"
res2 = session.get(url, headers=headers)
soup2 = BeautifulSoup(res2.text, 'html.parser')

# 全inputでmodified系のフィールドを探す
print("=== inputタグ (modified/updated関連) ===")
for inp in soup2.find_all('input'):
    name = inp.get('name','')
    val = inp.get('value','')
    if any(k in name.lower() for k in ['modif','update','modified','created']):
        print(f"  {name} = {val}")

# textareaも同様に
print("\n=== テキスト検索: '更新' in HTML ===")
# 正規表現で更新日時っぽい文字列を探す
matches = re.findall(r'2026-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}', res2.text)
print("日時文字列:", set(matches))

# サイドバーの更新履歴部分を探す
for el in soup2.find_all(class_=re.compile(r'revision|modified|updated', re.I)):
    print("class系:", el.get('class'), el.get_text(strip=True)[:80])
