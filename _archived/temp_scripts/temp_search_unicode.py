import re
import codecs

with open("user.js", "r", encoding="utf-8") as f:
    content = f.read()

# \uXXXXをデコード
content_decoded = codecs.decode(content, 'unicode_escape')

keywords = ["出身地", "生年月日", "性別", "値段", "価格", "フリー", "毛色", "ワクチン"]
found = []
for k in keywords:
    if k in content_decoded:
        found.append(k)

print("見つかったキーワード:", found)

# mtappVars の中身も探すために temp_entry_edit.html も見る
with open("temp_entry_edit.html", "r", encoding="utf-8") as f:
    html_content = f.read()

html_decoded = codecs.decode(html_content, 'unicode_escape', errors='ignore')
html_found = []
for k in keywords:
    if k in html_decoded:
        html_found.append(k)

print("HTMLで見つかったキーワード:", html_found)

# 念のため .js や .html から MTAppjQuery 的なラベル設定を抽出
matches = re.findall(r"(?:text|date|textarea|checkbox)[a-z0-9A-Z_]*", content_decoded)
if matches:
    print("JS内のフィールド名っぽいやつ:", set(matches[:20]))

