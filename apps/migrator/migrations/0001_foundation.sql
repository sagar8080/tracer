CREATE TABLE organizations (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
    timezone text NOT NULL,
    currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE);
CREATE TABLE memberships (
    org_id uuid NOT NULL REFERENCES organizations(id),
    user_id uuid NOT NULL REFERENCES users(id),
    role text NOT NULL CHECK (role IN ('owner','admin','planner','member','viewer')),
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id, org_id);
CREATE TABLE people (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id),
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
    role text NOT NULL CHECK (length(trim(role)) BETWEEN 1 AND 100),
    team text NOT NULL CHECK (length(trim(team)) BETWEEN 1 AND 100),
    daily_minutes integer NOT NULL CHECK (daily_minutes BETWEEN 60 AND 1440),
    cost_rate integer NOT NULL CHECK (cost_rate BETWEEN 0 AND 10000000),
    color text NOT NULL CHECK (color IN ('sage','lilac','blue','peach','rose')),
    UNIQUE (org_id, id)
);
CREATE TABLE projects (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id),
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
    client text NOT NULL CHECK (length(trim(client)) BETWEEN 1 AND 100),
    color text NOT NULL CHECK (color IN ('sage','lilac','blue','peach','rose')),
    budget_minutes integer NOT NULL CHECK (budget_minutes BETWEEN 60 AND 100000000),
    bill_rate integer NOT NULL CHECK (bill_rate BETWEEN 0 AND 10000000),
    status text NOT NULL CHECK (status IN ('confirmed','tentative','complete')),
    UNIQUE (org_id, id)
);
CREATE TABLE assignments (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id),
    person_id uuid NOT NULL,
    project_id uuid NOT NULL,
    title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
    start_date date NOT NULL,
    end_date date NOT NULL CHECK (end_date >= start_date AND end_date - start_date <= 366),
    daily_minutes integer NOT NULL CHECK (daily_minutes BETWEEN 15 AND 1440 AND daily_minutes % 15 = 0),
    status text NOT NULL CHECK (status IN ('confirmed','tentative')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (org_id, person_id) REFERENCES people(org_id, id),
    FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id)
);
CREATE INDEX assignments_org_person_dates_idx ON assignments (org_id, person_id, start_date, end_date);
CREATE INDEX assignments_org_project_idx ON assignments (org_id, project_id);
CREATE TABLE audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id),
    actor_id uuid NOT NULL REFERENCES users(id),
    entity_id uuid NOT NULL,
    action text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
