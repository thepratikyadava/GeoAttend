from supabase import create_client, Client, ClientOptions

from app.config import settings


def create_public_client() -> Client:

    if not settings.SUPABASE_URL or not settings.SUPABASE_PUBLISHABLE_KEY:
        raise RuntimeError("Supabase URL and publishable key must be configured")

    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_PUBLISHABLE_KEY
    )


def create_user_client(access_token: str) -> Client:

    if not settings.SUPABASE_URL or not settings.SUPABASE_PUBLISHABLE_KEY:
        raise RuntimeError("Supabase URL and publishable key must be configured")

    options = ClientOptions(
        headers={
            "Authorization": f"Bearer {access_token}"
        }
    )

    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_PUBLISHABLE_KEY,
        options=options
    )
