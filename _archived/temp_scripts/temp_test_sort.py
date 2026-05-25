import os
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
USERNAME = os.getenv("CMS_USERNAME")
PASSWORD = os.getenv("CMS_PASSWORD")
LOGIN_URL = "https://www.pets-kennel.com/cgi-bin/tl_cms/tl.cgi"

def main():
    session = requests.Session()
    session.auth = (USERNAME, PASSWORD)
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    # login
    res = session.get(f"{LOGIN_URL}?__mode=dashboard", headers=headers)
    soup = BeautifulSoup(res.text, 'html.parser')
    form = soup.find('form')
    if form:
        payload = {}
        for input_tag in form.find_all('input'):
            name = input_tag.get('name')
            if name:
                if name == 'username': payload[name] = USERNAME
                elif t := input_tag.get('type'):
                    if t.lower() == 'password': payload[name] = PASSWORD
                    else: payload[name] = input_tag.get('value', '')
        session.post(LOGIN_URL, data=payload, headers=headers)

    # Test sorting parameters
    req_data = {
        '__mode': 'filtered_list',
        'datasource': 'entry',
        'blog_id': '73',
        'limit': '5',
        'sort_by': 'authored_on', # test authored_on, created_on, id
        'sort_order': 'descend',
        'sort_direction': 'descend'
    }
    
    list_res = session.get(f"{LOGIN_URL}?__mode=list&_type=entry&blog_id=73", headers=headers)
    lsoup = BeautifulSoup(list_res.text, 'html.parser')
    t = lsoup.find('input', {'name': 'magic_token'})
    if t: req_data['magic_token'] = t.get('value', '')
        
    res_list = session.post(LOGIN_URL, data=req_data, headers=headers)
    data = res_list.json()
    if 'result' in data and 'objects' in data['result']:
        for obj in data['result']['objects']:
            print(str(obj)[:100]) # Print beginning of row to see ID or Date
            
if __name__ == "__main__":
    main()
