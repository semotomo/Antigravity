import os
import requests
import json
from bs4 import BeautifulSoup as bs_html
from dotenv import load_dotenv

load_dotenv()
USERNAME = os.getenv("CMS_USERNAME")
PASSWORD = os.getenv("CMS_PASSWORD")
LOGIN_URL = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi"

def main():
    session = requests.Session()
    session.auth = (USERNAME, PASSWORD)
    headers = {'User-Agent': 'Mozilla/5.0'}

    res = session.get(f"{LOGIN_URL}?__mode=dashboard", headers=headers)
    soup = bs_html(res.text, 'html.parser')
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
        session.post(LOGIN_URL, data=payload, headers=headers)

    req_data = {
        '__mode': 'filtered_list',
        'datasource': 'entry',
        'blog_id': '73',
        'limit': '10'
    }
    
    list_res = session.get(f"{LOGIN_URL}?__mode=list&_type=entry&blog_id=73", headers=headers)
    lsoup = bs_html(list_res.text, 'html.parser')
    token_input = lsoup.find('input', {'name': 'magic_token'})
    if token_input:
        req_data['magic_token'] = token_input.get('value', '')
        
    res_list = session.post(LOGIN_URL, data=req_data, headers=headers)
    
    if res_list.status_code == 200:
        try:
            data = res_list.json()
            if 'result' in data and 'objects' in data['result']:
                objects = data['result']['objects']
                print(f"Found {len(objects)} objects!")
                for obj in objects[:5]:
                    entry_html = str(obj)
                    row_soup = bs_html(entry_html, 'html.parser')
                    for a in row_soup.find_all('a', href=True):
                        if 'id=' in a['href']:
                            print(" => ", a['href'])
                            break
            else:
                print("No objects found:", list(data['result'].keys()))
        except Exception as e:
            print("Not JSON:", e)

if __name__ == "__main__":
    main()
