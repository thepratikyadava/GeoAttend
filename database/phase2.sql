-- =====================================================
-- GEOATTEND PHASE 2 & 3/4/5 DATABASE UPDATES
-- Authentication, Institution Onboarding, Database, Roles and RLS
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------
-- 1. INSTITUTIONS
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,

    created_by UUID REFERENCES auth.users(id),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT institution_code_format
        CHECK (code ~ '^[A-Z0-9_-]{3,20}$')
);


-- -----------------------------------------------------
-- 2. USER PROFILES
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id)
        ON DELETE CASCADE,

    institution_id UUID REFERENCES public.institutions(id),

    full_name TEXT NOT NULL DEFAULT '',

    role TEXT NOT NULL DEFAULT 'student'
        CHECK (role IN ('admin', 'student')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- -----------------------------------------------------
-- 3. LOCATIONS AND GEOFENCE CONFIGURATION
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    institution_id UUID NOT NULL
        REFERENCES public.institutions(id)
        ON DELETE CASCADE,

    name TEXT NOT NULL,

    description TEXT,

    -- circle or polygon
    geofence_type TEXT NOT NULL DEFAULT 'circle'
        CHECK (geofence_type IN ('circle', 'polygon')),

    -- Circle configuration
    center_latitude DOUBLE PRECISION,
    center_longitude DOUBLE PRECISION,
    radius_meters DOUBLE PRECISION,

    -- Future manually drawn boundary
    -- Standard GeoJSON Polygon
    boundary_geojson JSONB,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_by UUID REFERENCES auth.users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_circle_coordinates CHECK (
        center_latitude IS NULL
        OR center_latitude BETWEEN -90 AND 90
    ),

    CONSTRAINT valid_circle_longitude CHECK (
        center_longitude IS NULL
        OR center_longitude BETWEEN -180 AND 180
    ),

    CONSTRAINT valid_geofence_configuration CHECK (

        (
            geofence_type = 'circle'

            AND center_latitude IS NOT NULL
            AND center_longitude IS NOT NULL
            AND radius_meters IS NOT NULL
            AND radius_meters > 0
            AND boundary_geojson IS NULL
        )

        OR

        (
            geofence_type = 'polygon'

            AND center_latitude IS NULL
            AND center_longitude IS NULL
            AND radius_meters IS NULL

            AND boundary_geojson IS NOT NULL

            AND boundary_geojson ->> 'type' = 'Polygon'
        )
    )
);


-- -----------------------------------------------------
-- 4. ATTENDANCE SESSIONS
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    location_id UUID NOT NULL
        REFERENCES public.locations(id)
        ON DELETE CASCADE,

    name TEXT NOT NULL,

    start_time TIMESTAMPTZ NOT NULL,

    end_time TIMESTAMPTZ NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_by UUID REFERENCES auth.users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_session_time
        CHECK (end_time > start_time)
);


-- -----------------------------------------------------
-- 5. ATTENDANCE RECORDS
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    session_id UUID NOT NULL
        REFERENCES public.sessions(id)
        ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,

    latitude DOUBLE PRECISION NOT NULL,

    longitude DOUBLE PRECISION NOT NULL,

    gps_accuracy_meters DOUBLE PRECISION,

    distance_meters DOUBLE PRECISION NOT NULL,

    status TEXT NOT NULL DEFAULT 'present'
        CHECK (status IN ('present', 'late')),

    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_user_session
        UNIQUE (user_id, session_id),

    CONSTRAINT valid_attendance_latitude
        CHECK (latitude BETWEEN -90 AND 90),

    CONSTRAINT valid_attendance_longitude
        CHECK (longitude BETWEEN -180 AND 180),

    CONSTRAINT valid_attendance_distance
        CHECK (distance_meters >= 0)
);


-- -----------------------------------------------------
-- 6. HELPER FUNCTIONS FOR ACCESS CONTROL
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION
public.current_user_institution_id()

RETURNS UUID

LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''

AS $$
    SELECT p.institution_id
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
    LIMIT 1;
$$;


CREATE OR REPLACE FUNCTION
public.is_institution_member(target_institution UUID)

RETURNS BOOLEAN

LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''

AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = (SELECT auth.uid())
          AND p.institution_id = target_institution
    );
$$;


CREATE OR REPLACE FUNCTION
public.is_institution_admin(target_institution UUID)

RETURNS BOOLEAN

LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''

AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = (SELECT auth.uid())
          AND p.institution_id = target_institution
          AND p.role = 'admin'
    );
$$;


CREATE OR REPLACE FUNCTION
public.session_in_current_institution(target_session UUID)

RETURNS BOOLEAN

LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''

AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.sessions AS s
        JOIN public.locations AS l
          ON l.id = s.location_id
        WHERE s.id = target_session
          AND l.institution_id =
              public.current_user_institution_id()
    );
$$;


-- -----------------------------------------------------
-- 7. AUTOMATIC PROFILE CREATION (STUDENT & ADMIN ONBOARDING)
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION
public.handle_new_user()

RETURNS TRIGGER

LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''

AS $$
DECLARE
    selected_institution UUID;
    submitted_code TEXT;
    submitted_inst_name TEXT;
    requested_role TEXT;
    assigned_role TEXT := 'student';
BEGIN

    submitted_code := UPPER(
        TRIM(
            COALESCE(
                NEW.raw_user_meta_data ->> 'institution_code',
                ''
            )
        )
    );

    submitted_inst_name := TRIM(
        COALESCE(
            NEW.raw_user_meta_data ->> 'institution_name',
            ''
        )
    );

    requested_role := LOWER(
        TRIM(
            COALESCE(
                NEW.raw_user_meta_data ->> 'role',
                'student'
            )
        )
    );

    IF requested_role = 'admin' AND submitted_code <> '' AND submitted_inst_name <> '' THEN

        INSERT INTO public.institutions (
            name,
            code,
            created_by,
            is_active
        )
        VALUES (
            submitted_inst_name,
            submitted_code,
            NEW.id,
            TRUE
        )
        RETURNING id INTO selected_institution;

        assigned_role := 'admin';

    ELSIF submitted_code <> '' THEN

        SELECT i.id
        INTO selected_institution
        FROM public.institutions AS i
        WHERE i.code = submitted_code
          AND i.is_active = TRUE;

        IF selected_institution IS NULL THEN
            RAISE EXCEPTION 'Invalid or inactive institution code';
        END IF;

        assigned_role := 'student';

    END IF;

    INSERT INTO public.profiles (
        id,
        full_name,
        institution_id,
        role
    )
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data ->> 'full_name',
            ''
        ),
        selected_institution,
        assigned_role
    );

    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS on_auth_user_created
ON auth.users;

CREATE TRIGGER on_auth_user_created

AFTER INSERT ON auth.users

FOR EACH ROW

EXECUTE FUNCTION public.handle_new_user();


-- -----------------------------------------------------
-- 8. PROTECT PRIVILEGED PROFILE FIELDS & ONBOARDING RPCS
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION
public.protect_profile_privileges()

RETURNS TRIGGER

LANGUAGE plpgsql
SET search_path = ''

AS $$
BEGIN

    IF (SELECT auth.uid()) IS NOT NULL
       AND COALESCE(current_setting('app.bypass_profile_protection', true), '') <> 'true'
    THEN

        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Users cannot change their own role';
        END IF;

        IF NEW.institution_id IS DISTINCT FROM OLD.institution_id THEN
            RAISE EXCEPTION 'Users cannot change their institution';
        END IF;

    END IF;

    NEW.updated_at := NOW();

    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS protect_profile_privileges
ON public.profiles;

CREATE TRIGGER protect_profile_privileges

BEFORE UPDATE ON public.profiles

FOR EACH ROW

EXECUTE FUNCTION public.protect_profile_privileges();


-- Allow a user without an institution to join an existing active institution as a student
CREATE OR REPLACE FUNCTION
public.join_institution_by_code(target_code TEXT)

RETURNS JSONB

LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''

AS $$
DECLARE
    caller_id UUID;
    current_inst UUID;
    matched_inst UUID;
    clean_code TEXT;
    updated_profile public.profiles;
BEGIN
    caller_id := (SELECT auth.uid());
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT p.institution_id INTO current_inst
    FROM public.profiles AS p
    WHERE p.id = caller_id;

    IF current_inst IS NOT NULL THEN
        RAISE EXCEPTION 'User is already assigned to an institution';
    END IF;

    clean_code := UPPER(TRIM(COALESCE(target_code, '')));

    SELECT i.id INTO matched_inst
    FROM public.institutions AS i
    WHERE i.code = clean_code
      AND i.is_active = TRUE;

    IF matched_inst IS NULL THEN
        RAISE EXCEPTION 'Invalid or inactive institution code';
    END IF;

    PERFORM set_config('app.bypass_profile_protection', 'true', true);

    UPDATE public.profiles
    SET institution_id = matched_inst,
        role = 'student',
        updated_at = NOW()
    WHERE id = caller_id
    RETURNING * INTO updated_profile;

    RETURN to_jsonb(updated_profile);
END;
$$;


-- Allow a user without an institution to create a new institution and become its admin
CREATE OR REPLACE FUNCTION
public.create_institution_and_assign_admin(
    inst_name TEXT,
    inst_code TEXT
)

RETURNS JSONB

LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''

AS $$
DECLARE
    caller_id UUID;
    current_inst UUID;
    new_inst public.institutions;
    clean_name TEXT;
    clean_code TEXT;
    updated_profile public.profiles;
BEGIN
    caller_id := (SELECT auth.uid());
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT p.institution_id INTO current_inst
    FROM public.profiles AS p
    WHERE p.id = caller_id;

    IF current_inst IS NOT NULL THEN
        RAISE EXCEPTION 'User is already assigned to an institution';
    END IF;

    clean_name := TRIM(COALESCE(inst_name, ''));
    clean_code := UPPER(TRIM(COALESCE(inst_code, '')));

    IF clean_name = '' THEN
        RAISE EXCEPTION 'Institution name is required';
    END IF;

    INSERT INTO public.institutions (
        name,
        code,
        created_by,
        is_active
    )
    VALUES (
        clean_name,
        clean_code,
        caller_id,
        TRUE
    )
    RETURNING * INTO new_inst;

    PERFORM set_config('app.bypass_profile_protection', 'true', true);

    UPDATE public.profiles
    SET institution_id = new_inst.id,
        role = 'admin',
        updated_at = NOW()
    WHERE id = caller_id
    RETURNING * INTO updated_profile;

    RETURN jsonb_build_object(
        'institution', to_jsonb(new_inst),
        'profile', to_jsonb(updated_profile)
    );
END;
$$;


-- -----------------------------------------------------
-- 9. ENABLE ROW LEVEL SECURITY
-- -----------------------------------------------------

ALTER TABLE public.institutions
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.locations
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sessions
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.attendance
ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------
-- 10. INSTITUTION POLICIES
-- -----------------------------------------------------

DROP POLICY IF EXISTS institution_read
ON public.institutions;

CREATE POLICY institution_read

ON public.institutions

FOR SELECT

TO authenticated

USING (
    created_by = (SELECT auth.uid())
    OR
    public.is_institution_member(id)
);


-- -----------------------------------------------------
-- 11. PROFILE POLICIES
-- -----------------------------------------------------

DROP POLICY IF EXISTS profile_read
ON public.profiles;

CREATE POLICY profile_read

ON public.profiles

FOR SELECT

TO authenticated

USING (
    id = (SELECT auth.uid())
    OR
    public.is_institution_admin(institution_id)
);


DROP POLICY IF EXISTS profile_update
ON public.profiles;

CREATE POLICY profile_update

ON public.profiles

FOR UPDATE

TO authenticated

USING (
    id = (SELECT auth.uid())
)

WITH CHECK (
    id = (SELECT auth.uid())
);


-- -----------------------------------------------------
-- 12. LOCATION POLICIES
-- -----------------------------------------------------

DROP POLICY IF EXISTS location_read
ON public.locations;

CREATE POLICY location_read

ON public.locations

FOR SELECT

TO authenticated

USING (
    public.is_institution_member(institution_id)
);


DROP POLICY IF EXISTS location_insert
ON public.locations;

CREATE POLICY location_insert

ON public.locations

FOR INSERT

TO authenticated

WITH CHECK (
    public.is_institution_admin(institution_id)
    AND created_by = (SELECT auth.uid())
);


DROP POLICY IF EXISTS location_update
ON public.locations;

CREATE POLICY location_update

ON public.locations

FOR UPDATE

TO authenticated

USING (
    public.is_institution_admin(institution_id)
)

WITH CHECK (
    public.is_institution_admin(institution_id)
);


DROP POLICY IF EXISTS location_delete
ON public.locations;

CREATE POLICY location_delete

ON public.locations

FOR DELETE

TO authenticated

USING (
    public.is_institution_admin(institution_id)
);


-- -----------------------------------------------------
-- 13. SESSION POLICIES
-- -----------------------------------------------------

DROP POLICY IF EXISTS session_read
ON public.sessions;

CREATE POLICY session_read

ON public.sessions

FOR SELECT

TO authenticated

USING (
    EXISTS (
        SELECT 1
        FROM public.locations AS l
        WHERE l.id = sessions.location_id
          AND public.is_institution_member(l.institution_id)
    )
);


DROP POLICY IF EXISTS session_insert
ON public.sessions;

CREATE POLICY session_insert

ON public.sessions

FOR INSERT

TO authenticated

WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.locations AS l
        WHERE l.id = sessions.location_id
          AND public.is_institution_admin(l.institution_id)
    )
    AND created_by = (SELECT auth.uid())
);


DROP POLICY IF EXISTS session_update
ON public.sessions;

CREATE POLICY session_update

ON public.sessions

FOR UPDATE

TO authenticated

USING (
    EXISTS (
        SELECT 1
        FROM public.locations AS l
        WHERE l.id = sessions.location_id
          AND public.is_institution_admin(l.institution_id)
    )
)

WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.locations AS l
        WHERE l.id = sessions.location_id
          AND public.is_institution_admin(l.institution_id)
    )
);


DROP POLICY IF EXISTS session_delete
ON public.sessions;

CREATE POLICY session_delete

ON public.sessions

FOR DELETE

TO authenticated

USING (
    EXISTS (
        SELECT 1
        FROM public.locations AS l
        WHERE l.id = sessions.location_id
          AND public.is_institution_admin(l.institution_id)
    )
);


-- -----------------------------------------------------
-- 14. ATTENDANCE POLICIES
-- -----------------------------------------------------

DROP POLICY IF EXISTS attendance_read
ON public.attendance;

CREATE POLICY attendance_read

ON public.attendance

FOR SELECT

TO authenticated

USING (
    user_id = (SELECT auth.uid())
    OR
    public.session_in_current_institution(session_id)
);


DROP POLICY IF EXISTS attendance_insert
ON public.attendance;

CREATE POLICY attendance_insert

ON public.attendance

FOR INSERT

TO authenticated

WITH CHECK (
    user_id = (SELECT auth.uid())
    AND
    public.session_in_current_institution(session_id)
);


-- -----------------------------------------------------
-- 15. FUNCTION PERMISSIONS
-- -----------------------------------------------------

REVOKE ALL ON FUNCTION
public.current_user_institution_id()
FROM PUBLIC;

REVOKE ALL ON FUNCTION
public.is_institution_member(UUID)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
public.is_institution_admin(UUID)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
public.session_in_current_institution(UUID)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
public.join_institution_by_code(TEXT)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
public.create_institution_and_assign_admin(TEXT, TEXT)
FROM PUBLIC;


GRANT EXECUTE ON FUNCTION
public.current_user_institution_id()
TO authenticated;

GRANT EXECUTE ON FUNCTION
public.is_institution_member(UUID)
TO authenticated;

GRANT EXECUTE ON FUNCTION
public.is_institution_admin(UUID)
TO authenticated;

GRANT EXECUTE ON FUNCTION
public.session_in_current_institution(UUID)
TO authenticated;

GRANT EXECUTE ON FUNCTION
public.join_institution_by_code(TEXT)
TO authenticated;

GRANT EXECUTE ON FUNCTION
public.create_institution_and_assign_admin(TEXT, TEXT)
TO authenticated;


-- -----------------------------------------------------
-- 16. TABLE PERMISSIONS
-- -----------------------------------------------------

REVOKE ALL ON public.institutions FROM anon, authenticated;
REVOKE ALL ON public.profiles FROM anon, authenticated;
REVOKE ALL ON public.locations FROM anon, authenticated;
REVOKE ALL ON public.sessions FROM anon, authenticated;
REVOKE ALL ON public.attendance FROM anon, authenticated;


GRANT SELECT ON public.institutions TO authenticated;

GRANT SELECT, UPDATE (full_name)
ON public.profiles TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.locations TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.sessions TO authenticated;

GRANT SELECT, INSERT
ON public.attendance TO authenticated;


-- -----------------------------------------------------
-- 17. INDEXES
-- -----------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_profiles_institution
ON public.profiles(institution_id);

CREATE INDEX IF NOT EXISTS idx_profiles_role
ON public.profiles(role);

CREATE INDEX IF NOT EXISTS idx_locations_institution
ON public.locations(institution_id);

CREATE INDEX IF NOT EXISTS idx_sessions_location
ON public.sessions(location_id);

CREATE INDEX IF NOT EXISTS idx_attendance_user
ON public.attendance(user_id);

CREATE INDEX IF NOT EXISTS idx_attendance_session
ON public.attendance(session_id);

CREATE INDEX IF NOT EXISTS idx_attendance_verified_at
ON public.attendance(verified_at DESC);


-- -----------------------------------------------------
-- COMPLETE
-- -----------------------------------------------------

SELECT 'GeoAttend Phase 2 schema installed' AS result;
