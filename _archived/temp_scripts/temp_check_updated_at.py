import os, re, requests
script_dir = os.path.dirname(os.path.abspath(__file__))
secrets_path = os.path.join(script_dir, ".streamlit", "secrets.toml")
content = open(secrets_path, encoding="utf-8").read()
url = re.search(r'url\s*=\s*"([^"]+)"', content).group(1)
key = re.search(r'key\s*=\s*"([^"]+)"', content).group(1)

headers = {"apikey": key, "Authorization": f"Bearer {key}"}
# 125414の更新日を確認
res = requests.get(
    f"{url}/rest/v1/cms_pets?management_no=eq.125414&select=management_no,breed,cms_updated_at",
    headers=headers
)
print(res.json())
