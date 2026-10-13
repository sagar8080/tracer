-- Time tracking owns weekly submissions and entries; removal of membership preserves history.
CREATE TABLE timesheets (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id),
 user_id uuid NOT NULL REFERENCES users(id), person_id uuid NOT NULL,
 week date NOT NULL CHECK(extract(isodow FROM week)=1),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 reviewed_by uuid REFERENCES users(id), review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=500),
 submitted_at timestamptz, reviewed_at timestamptz,
 UNIQUE(org_id,id), UNIQUE(org_id,user_id,week), UNIQUE(org_id,person_id,week),
 FOREIGN KEY(org_id,person_id) REFERENCES people(org_id,id)
);
CREATE TABLE time_entries (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, sheet_id uuid NOT NULL, project_id uuid NOT NULL,
 entry_date date NOT NULL, minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 1440),
 billable boolean NOT NULL, note text NOT NULL DEFAULT '' CHECK(length(note)<=500),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 FOREIGN KEY(org_id,sheet_id) REFERENCES timesheets(org_id,id),
 FOREIGN KEY(org_id,project_id) REFERENCES projects(org_id,id)
);
CREATE INDEX time_entries_sheet_idx ON time_entries(org_id,sheet_id,entry_date);
CREATE INDEX timesheets_org_week_idx ON timesheets(org_id,week,status);
CREATE INDEX time_entries_project_date_idx ON time_entries(org_id,project_id,entry_date);
