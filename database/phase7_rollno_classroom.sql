-- =====================================================
-- GEOATTEND PHASE 6 + PHASE 7 COMBINED MIGRATION
-- Facial Recognition + Roll No. + Classroom Background Samples
-- Safe to run standalone even if phase6_face.sql was not run first
-- =====================================================

-- 1. Add Facial Data & Roll No. columns to profiles
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS face_descriptor JSONB,
    ADD COLUMN IF NOT EXISTS face_registered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS roll_no TEXT NOT NULL DEFAULT '';

GRANT UPDATE (full_name, roll_no, face_descriptor, face_registered_at)
ON public.profiles TO authenticated;

-- 2. Add Classroom Background Samples (min 3, max 5) to sessions
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS classroom_samples JSONB;

ALTER TABLE public.sessions
    DROP CONSTRAINT IF EXISTS valid_classroom_samples_count;

ALTER TABLE public.sessions
    ADD CONSTRAINT valid_classroom_samples_count CHECK (
        classroom_samples IS NULL
        OR (
            jsonb_typeof(classroom_samples) = 'array'
            AND jsonb_array_length(classroom_samples) BETWEEN 3 AND 5
        )
    );

-- 3. Add Face & Background Verification fields to attendance
ALTER TABLE public.attendance
    ADD COLUMN IF NOT EXISTS face_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS face_match_distance DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS background_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS background_similarity DOUBLE PRECISION;

-- 4. Update handle_new_user() to also persist face_descriptor and roll_no if supplied during registration
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
    submitted_face JSONB;
    submitted_roll_no TEXT;
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

    submitted_face := NEW.raw_user_meta_data -> 'face_descriptor';
    submitted_roll_no := TRIM(COALESCE(NEW.raw_user_meta_data ->> 'roll_no', ''));

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
        roll_no,
        institution_id,
        role,
        face_descriptor,
        face_registered_at
    )
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data ->> 'full_name',
            ''
        ),
        submitted_roll_no,
        selected_institution,
        assigned_role,
        submitted_face,
        CASE WHEN submitted_face IS NOT NULL THEN NOW() ELSE NULL END
    );

    RETURN NEW;

END;
$$;

SELECT 'GeoAttend Phase 6 & 7 (Face, Roll No & Classroom Background) installed' AS result;
