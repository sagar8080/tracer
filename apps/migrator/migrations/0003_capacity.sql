-- Weekly minutes are Monday through Sunday. Existing people retain their
-- Monday-Friday baseline until their first effective calendar begins.
CREATE TABLE working_calendars (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id),
    person_id uuid NOT NULL,
    effective_from date NOT NULL,
    weekly_minutes integer[] NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    FOREIGN KEY (org_id, person_id) REFERENCES people(org_id, id),
    UNIQUE (org_id, person_id, effective_from),
    CHECK (array_ndims(weekly_minutes) = 1 AND array_lower(weekly_minutes, 1) = 1
      AND cardinality(weekly_minutes) = 7 AND array_position(weekly_minutes, NULL) IS NULL
      AND 0 <= ALL(weekly_minutes) AND 1440 >= ALL(weekly_minutes)),
    CHECK (weekly_minutes[1] % 15 = 0 AND weekly_minutes[2] % 15 = 0
      AND weekly_minutes[3] % 15 = 0 AND weekly_minutes[4] % 15 = 0
      AND weekly_minutes[5] % 15 = 0 AND weekly_minutes[6] % 15 = 0
      AND weekly_minutes[7] % 15 = 0)
);
CREATE TABLE absences (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id),
    person_id uuid,
    category text NOT NULL CHECK (category IN ('timeOff','holiday')),
    title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
    start_date date NOT NULL,
    end_date date NOT NULL CHECK (end_date >= start_date AND end_date - start_date <= 366),
    daily_minutes integer CHECK (daily_minutes BETWEEN 15 AND 1440 AND daily_minutes % 15 = 0),
    version integer NOT NULL CHECK (version > 0),
    FOREIGN KEY (org_id, person_id) REFERENCES people(org_id, id),
    CHECK ((category = 'holiday' AND person_id IS NULL AND daily_minutes IS NULL)
        OR (category = 'timeOff' AND person_id IS NOT NULL))
);
CREATE INDEX absences_org_dates_idx ON absences (org_id, start_date, end_date);
CREATE INDEX absences_org_person_dates_idx ON absences (org_id, person_id, start_date, end_date);
