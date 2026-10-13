-- Add canonical principals without replacing any historical human identity.
CREATE TABLE principals (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('human','agent')),
 user_id uuid UNIQUE REFERENCES users(id), org_id uuid REFERENCES organizations(id),
 UNIQUE(org_id,id),
 CHECK((kind='human' AND user_id IS NOT NULL AND user_id=id AND org_id IS NULL) OR (kind='agent' AND user_id IS NULL AND org_id IS NOT NULL))
);
INSERT INTO principals(id,kind,user_id) SELECT id,'human',id FROM users;
CREATE FUNCTION provision_human_principal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO principals(id,kind,user_id) VALUES(NEW.id,'human',NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER users_principal AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION provision_human_principal();
CREATE FUNCTION immutable_principal_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
   RAISE EXCEPTION 'Principal binding is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER principal_binding BEFORE UPDATE ON principals FOR EACH ROW EXECUTE FUNCTION immutable_principal_binding();

ALTER TABLE audit_events ADD COLUMN actor_principal_id uuid REFERENCES principals(id);
UPDATE audit_events SET actor_principal_id=actor_id;
ALTER TABLE audit_events ALTER COLUMN actor_principal_id SET NOT NULL;
ALTER TABLE audit_events ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE command_receipts ADD COLUMN actor_principal_id uuid REFERENCES principals(id);
UPDATE command_receipts SET actor_principal_id=actor_id;
ALTER TABLE command_receipts ALTER COLUMN actor_principal_id SET NOT NULL;
ALTER TABLE command_receipts DROP CONSTRAINT command_receipts_pkey;
ALTER TABLE command_receipts ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE command_receipts ADD PRIMARY KEY(org_id,actor_principal_id,request_id);
-- Compatibility for old human writers during an additive deployment.
CREATE FUNCTION validate_record_principal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p principals;
BEGIN
 IF NEW.actor_principal_id IS NULL THEN NEW.actor_principal_id := NEW.actor_id; END IF;
 SELECT * INTO STRICT p FROM principals WHERE id=NEW.actor_principal_id;
 IF (p.kind='human' AND NEW.actor_id IS DISTINCT FROM p.user_id)
    OR (p.kind='agent' AND (NEW.actor_id IS NOT NULL OR p.org_id<>NEW.org_id)) THEN
   RAISE EXCEPTION 'Invalid principal binding' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_principal BEFORE INSERT OR UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION validate_record_principal();
CREATE TRIGGER receipt_principal BEFORE INSERT OR UPDATE ON command_receipts FOR EACH ROW EXECUTE FUNCTION validate_record_principal();

CREATE TABLE agents (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id),
 principal_id uuid NOT NULL UNIQUE REFERENCES principals(id),
 owner_id uuid NOT NULL REFERENCES users(id), parent_id uuid,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 purpose text NOT NULL CHECK(length(trim(purpose)) BETWEEN 1 AND 500),
 scope jsonb NOT NULL CHECK(jsonb_typeof(scope)='object'),
 expires_at timestamptz NOT NULL, revoked_at timestamptz,
 credential_hash text NOT NULL UNIQUE, credential_epoch integer NOT NULL DEFAULT 1 CHECK(credential_epoch>0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,id), UNIQUE(org_id,id,principal_id),
 FOREIGN KEY(org_id,parent_id) REFERENCES agents(org_id,id),
 FOREIGN KEY(org_id,principal_id) REFERENCES principals(org_id,id), CHECK(parent_id IS NULL OR parent_id<>id)
);
CREATE TABLE agent_projects (
 org_id uuid NOT NULL, agent_id uuid NOT NULL, project_id uuid NOT NULL,
 PRIMARY KEY(org_id,agent_id,project_id),
 FOREIGN KEY(org_id,agent_id) REFERENCES agents(org_id,id),
 FOREIGN KEY(org_id,project_id) REFERENCES projects(org_id,id) ON DELETE CASCADE
);
CREATE TABLE agent_definitions (
 org_id uuid NOT NULL, agent_id uuid NOT NULL, version integer NOT NULL,
 definition jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,agent_id,version), FOREIGN KEY(org_id,agent_id) REFERENCES agents(org_id,id)
);
CREATE TABLE agent_sessions (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, agent_id uuid NOT NULL, principal_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE, credential_epoch integer NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,agent_id,principal_id) REFERENCES agents(org_id,id,principal_id)
);
CREATE INDEX agent_sessions_expiry_idx ON agent_sessions(expires_at);
CREATE INDEX agents_org_idx ON agents(org_id,id);

CREATE TABLE agent_proposals (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id),
 principal_id uuid NOT NULL REFERENCES principals(id), agent_id uuid,
 request jsonb NOT NULL, preview jsonb NOT NULL, content_hash text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','rejected','cancelled')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 reviewed_by uuid REFERENCES users(id), review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=1000),
 created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
 UNIQUE(org_id,id), FOREIGN KEY(org_id,agent_id) REFERENCES agents(org_id,id)
);
CREATE INDEX agent_proposals_org_principal_idx ON agent_proposals(org_id,principal_id,id);
CREATE FUNCTION validate_proposal_principal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p principals;
BEGIN
 SELECT * INTO STRICT p FROM principals WHERE id=NEW.principal_id;
 IF (p.kind='human' AND NEW.agent_id IS NOT NULL)
    OR (p.kind='agent' AND (p.org_id<>NEW.org_id OR NEW.agent_id IS NULL OR NOT EXISTS
      (SELECT 1 FROM agents WHERE org_id=NEW.org_id AND id=NEW.agent_id AND principal_id=NEW.principal_id))) THEN
   RAISE EXCEPTION 'Invalid proposal principal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposal_principal BEFORE INSERT OR UPDATE ON agent_proposals FOR EACH ROW EXECUTE FUNCTION validate_proposal_principal();
-- A0 proposals are inert: no trigger or job can publish them to assignments.
