from supabase import create_client, Client

from app.config import settings


supabase: Client | None = None


def initialize_supabase():

    global supabase

    if not settings.SUPABASE_URL:
        print("WARNING: Supabase URL is missing")
        return

    if not settings.SUPABASE_PUBLISHABLE_KEY:
        print("WARNING: Supabase publishable key is missing")
        return

    supabase = create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_PUBLISHABLE_KEY
    )

    print("Supabase client initialized")


def get_supabase():

    if supabase is None:
        raise RuntimeError("Supabase is not configured")

    return supabase