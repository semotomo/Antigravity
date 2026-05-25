import requests
import codecs

urls = [
    "https://www.teamlab-sales.com/supportSite/cmn/js/info/cmsVerSetting/4.js",
    "https://www.teamlab-sales.com/supportSite/cmn/js/info/info.js"
]

keywords = ["出身地", "生年月日", "性別", "値段", "価格", "フリー", "毛色", "ワクチン"]

for url in urls:
    print(f"Fetching {url} ...")
    try:
        res = requests.get(url)
        content = res.text
        # デコード
        content_decoded = codecs.decode(content, 'unicode_escape', errors='ignore')
        
        found = False
        for k in keywords:
            if k in content_decoded:
                print(f" => 見つかった: {k}")
                found = True
        
        if found:
            filename = url.split('/')[-1]
            with open(filename, "w", encoding="utf-8") as f:
                f.write(content_decoded)
            print(f" => {filename} に保存しました。")
    except Exception as e:
        print("Error:", e)
