import os
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

class Settings:
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
    
    # For local testing, we might fallback to read from .streamlit/secrets.toml if available
    if not SUPABASE_URL or not SUPABASE_KEY:
        try:
            import toml
            secrets_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".streamlit", "secrets.toml")
            if os.path.exists(secrets_path):
                secrets = toml.load(secrets_path)
                if "supabase" in secrets:
                    if not SUPABASE_URL:
                        SUPABASE_URL = secrets["supabase"].get("url", "")
                    if not SUPABASE_KEY:
                        SUPABASE_KEY = secrets["supabase"].get("key", "")
        except ImportError:
            pass
        except Exception as e:
            print(f"Warning: Could not read secrets.toml: {e}")

settings = Settings()
