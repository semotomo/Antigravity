import os
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
import urllib.parse
import re

load_dotenv()
USERNAME = os.getenv("CMS_USERNAME")
PASSWORD = os.getenv("CMS_PASSWORD")
LOGIN_URL = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi"

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
        action_url = urllib.parse.urljoin("https://www.pets-kennel.com", form.get('action') or LOGIN_URL)
        session.post(action_url, data=payload, headers=headers)

    print("Fetching list page for blog_id=73...")
    res_list = session.get(f"{LOGIN_URL}?__mode=list&_type=entry&blog_id=73", headers=headers)
    soup_list = BeautifulSoup(res_list.text, 'html.parser')

    # href に id= と blog_id= が含まれているものをすべて表示
    links = []
    for a in soup_list.find_all('a', href=True):
        href = a['href']
        if '_type=entry' in href:
            links.append(href)
            
    # setにして重複排除
    uniq_links = list(set(links))
    print("Found entry links:")
    for l in uniq_links:
        print(l)

if __name__ == "__main__":
    main()
