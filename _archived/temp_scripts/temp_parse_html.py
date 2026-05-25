from bs4 import BeautifulSoup

with open("temp_entry_edit.html", "r", encoding="utf-8") as f:
    soup = BeautifulSoup(f.read(), "html.parser")

for tag in soup.find_all(['input', 'select', 'textarea']):
    name = tag.get('name')
    if name:
        t_attr = tag.get('type', '')
        print(f"Name: {name}, Type: {tag.name} {t_attr}")
