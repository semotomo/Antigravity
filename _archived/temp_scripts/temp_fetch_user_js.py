import requests

url = "https://www.pets-kennel.com/mt-static/plugins/MTAppjQuery/user-files/user.js"
res = requests.get(url)
with open("user.js", "w", encoding="utf-8") as f:
    f.write(res.text)
print("user.js saved. length:", len(res.text))
