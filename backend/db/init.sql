-- SportCourts database schema. Applied automatically by docker-compose
-- (docker-entrypoint-initdb.d), by `npm run db:local`, or manually: psql -d SportCourts -f backend/db/init.sql
-- gen_random_uuid() is built into PostgreSQL 13+.

-- Users table
CREATE TABLE IF NOT EXISTS public.users (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name varchar,
    email varchar UNIQUE,
    password varchar,
    role varchar DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

-- Venues table
CREATE TABLE IF NOT EXISTS public.venues (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name varchar NOT NULL,
    location varchar NOT NULL,
    type varchar NOT NULL CHECK (type IN ('football_field', 'tennis_court', 'basketball_court')),
    description text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

-- Available slots table
CREATE TABLE IF NOT EXISTS public.available_slots (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    is_available boolean DEFAULT true,
    PRIMARY KEY (id),
    CHECK (end_time > start_time)
);

-- Bookings table
CREATE TABLE IF NOT EXISTS public.bookings (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
    slot_id uuid NOT NULL,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    status varchar DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

-- Extra protection against double booking: one active booking per slot
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot_uniq
    ON public.bookings (slot_id) WHERE status = 'booked';

-- v2: pricing. ADD COLUMN IF NOT EXISTS keeps the script idempotent,
-- so it can be re-applied to upgrade an existing database.
ALTER TABLE public.venues
    ADD COLUMN IF NOT EXISTS price_per_hour numeric(10, 2) NOT NULL DEFAULT 0 CHECK (price_per_hour >= 0);
-- Price is fixed at booking time, so later venue price changes don't affect it
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS price numeric(10, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS bookings_user_idx ON public.bookings (user_id);
CREATE INDEX IF NOT EXISTS available_slots_venue_idx ON public.available_slots (venue_id, start_time);

-- v2: slot/booking times are timestamptz. Older databases used "timestamp without time zone"
-- holding UTC wall-clock values, which the pg driver then read back in the server's local
-- time zone (shifting every slot by the UTC offset). Convert them once, interpreting the
-- stored values as UTC.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['available_slots', 'bookings'] LOOP
        IF (SELECT data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = t AND column_name = 'start_time') = 'timestamp without time zone' THEN
            EXECUTE format(
                'ALTER TABLE public.%I
                     ALTER COLUMN start_time TYPE timestamptz USING start_time AT TIME ZONE ''UTC'',
                     ALTER COLUMN end_time TYPE timestamptz USING end_time AT TIME ZONE ''UTC''', t);
        END IF;
    END LOOP;
END $$;

-- v3: profile customization
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_color varchar(7);

-- v4: venue details
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS surface varchar(40);
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS indoor boolean NOT NULL DEFAULT false;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS capacity integer CHECK (capacity BETWEEN 1 AND 100);
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS amenities text[] NOT NULL DEFAULT '{}';

-- v5: uploaded avatars
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_image bytea;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_mime varchar(20);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;

-- v6: venue photos, ratings, favorites, reviews, notifications
CREATE TABLE IF NOT EXISTS public.venue_photos (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
    image bytea NOT NULL,
    mime varchar(20) NOT NULL,
    position integer NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS venue_photos_venue_idx ON public.venue_photos (venue_id, position);

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS rating_avg numeric(3, 2);
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.favorites (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (user_id, venue_id)
);

-- One review per played booking
CREATE TABLE IF NOT EXISTS public.reviews (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS reviews_venue_idx ON public.reviews (venue_id, created_at DESC);

-- Day-before reminder is sent once
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- Password reset: only a hash of the emailed token is stored
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reset_token_hash varchar(64);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reset_token_expires_at timestamptz;

-- Every email the notification service produced (the dev mailbox when SMTP is not configured)
CREATE TABLE IF NOT EXISTS public.emails (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    to_email varchar NOT NULL,
    subject varchar NOT NULL,
    html text NOT NULL,
    text text NOT NULL,
    type varchar(40) NOT NULL,
    status varchar(10) NOT NULL CHECK (status IN ('sent', 'stored', 'failed')),
    error text,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS emails_created_idx ON public.emails (created_at DESC);
