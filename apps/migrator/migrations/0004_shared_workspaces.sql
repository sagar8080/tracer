-- Identity owns provider identities. Email is an attribute, never an identity key.
ALTER TABLE users DROP CONSTRAINT users_email_key;
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
CREATE INDEX users_email_idx ON users(lower(email));
CREATE TABLE external_identities (
 issuer text NOT NULL, subject text NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(issuer,subject)
);
-- Tenancy owns membership and expiring invitation records.
ALTER TABLE memberships ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0);
CREATE TABLE invitations (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 email text NOT NULL, role text NOT NULL CHECK(role IN ('admin','planner','member','viewer')),
 token_hash text NOT NULL UNIQUE, invited_by uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL, accepted_by uuid REFERENCES users(id), revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_org_idx ON invitations(org_id,created_at);
-- Planning owns entity versions; realtime owns the committed revision log.
ALTER TABLE organizations ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0);
ALTER TABLE organizations ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK(revision >= 0);
ALTER TABLE people ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0);
ALTER TABLE projects ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0);
CREATE TABLE workspace_events (
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 revision bigint NOT NULL, entity_id uuid NOT NULL, kind text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(org_id,revision)
);
-- Receipts and events commit atomically with the authorized mutation.
CREATE TABLE command_receipts (
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
 request jsonb NOT NULL, result jsonb NOT NULL DEFAULT 'null',
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(org_id,actor_id,request_id)
);
CREATE TABLE realtime_tickets (
 token_hash text PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL,
 valid_until timestamptz NOT NULL
);
CREATE INDEX realtime_tickets_expiry_idx ON realtime_tickets(expires_at);
