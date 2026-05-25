import requests

def main():
    endpoints = [
        "https://www.pets-kennel.com/mt-data-api/v4/sites/73/entries?limit=5",
        "https://www.pets-kennel.com/mt-data-api/v3/sites/73/entries?limit=5",
        "https://www.pets-kennel.com/mt-data-api/v2/sites/73/entries?limit=5",
        "https://www.pets-kennel.com/mt-data-api/v1/sites/73/entries?limit=5"
    ]
    
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    for url in endpoints:
        print(f"Testing {url} ...")
        res = requests.get(url, headers=headers)
        print(f"Status: {res.status_code}")
        if res.status_code == 200:
            print("Response:", res.text[:300])
            break

if __name__ == "__main__":
    main()
