CREATE OR REPLACE FUNCTION
public.geoattend_health_check()

RETURNS text
LANGUAGE sql
IMMUTABLE

AS $$
    SELECT 'GeoAttend database is working'::text;
$$;

REVOKE ALL ON FUNCTION
public.geoattend_health_check()
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
public.geoattend_health_check()
TO anon, authenticated;
