-- A1: private staged imports and a fenced, tenant-fair queue. No membership effects.
CREATE TABLE import_sources (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id),
    version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
    published_import_id uuid,
    UNIQUE (org_id, id)
);
CREATE TABLE workbook_imports (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id),
    source_id uuid NOT NULL,
    file_id uuid NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    status text NOT NULL CHECK (status IN ('queued','review','published','cancelled','failed')),
    version integer NOT NULL CHECK (version > 0),
    data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, id),
    FOREIGN KEY (org_id, source_id) REFERENCES import_sources(org_id, id),
    FOREIGN KEY (org_id, file_id) REFERENCES files(org_id, id)
);
ALTER TABLE import_sources ADD FOREIGN KEY (org_id, published_import_id) REFERENCES workbook_imports(org_id, id);
CREATE INDEX workbook_imports_org_created ON workbook_imports(org_id, created_at DESC, id);
CREATE TABLE job_lanes (
    org_id uuid PRIMARY KEY REFERENCES organizations(id),
    last_claimed_at timestamptz NOT NULL DEFAULT 'epoch'
);
CREATE TABLE durable_jobs (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES job_lanes(org_id),
    actor_id uuid NOT NULL REFERENCES users(id),
    entity_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('workbookParse','workbookExport')),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','cancelled','dead')),
    fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(entity_id,kind),
    FOREIGN KEY (org_id, entity_id) REFERENCES workbook_imports(org_id, id)
);
CREATE INDEX durable_jobs_claim ON durable_jobs(org_id, available_at, created_at) WHERE status IN ('queued','running');
