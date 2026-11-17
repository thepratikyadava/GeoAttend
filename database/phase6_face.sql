-- =====================================================
-- GEOATTEND FACIAL RECOGNITION MIGRATION
-- Adds facial descriptor storage & verification columns
-- =====================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS face_descriptor JSONB,
    ADD COLUMN IF NOT EXISTS face_registered_at TIMESTAMPTZ;

ALTER TABLE public.attendance
    ADD COLUMN IF NOT EXISTS face_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS face_match_distance DOUBLE PRECISION;

GRANT UPDATE (full_name, face_descriptor, face_registered_at)
ON public.profiles TO authenticated;

-- Update handle_new_user() to also persist face_descriptor if supplied during registration
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
        selected_institution,
        assigned_role,
        submitted_face,
        CASE WHEN submitted_face IS NOT NULL THEN NOW() ELSE NULL END
    );

    RETURN NEW;

END;
$$;

SELECT 'GeoAttend facial verification schema installed' AS result;
