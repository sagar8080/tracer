-- Leave owns approval state; planning owns approved capacity reductions.
ALTER TABLE absences ADD CONSTRAINT absences_org_id_unique UNIQUE(org_id,id);
CREATE TABLE leave_requests (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id),
 user_id uuid NOT NULL REFERENCES users(id), person_id uuid NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100),
 start_date date NOT NULL, end_date date NOT NULL CHECK(end_date>=start_date AND end_date-start_date<=366),
 daily_minutes integer CHECK(daily_minutes BETWEEN 15 AND 1440 AND daily_minutes%15=0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 reviewed_by uuid REFERENCES users(id), review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=500),
 absence_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,person_id) REFERENCES people(org_id,id),
 FOREIGN KEY(org_id,absence_id) REFERENCES absences(org_id,id) ON DELETE SET NULL(absence_id),
 UNIQUE(absence_id)
);
CREATE INDEX leave_requests_org_dates_idx ON leave_requests(org_id,start_date,end_date);
CREATE INDEX leave_requests_user_idx ON leave_requests(org_id,user_id,created_at);
