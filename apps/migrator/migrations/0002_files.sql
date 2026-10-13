CREATE TABLE files (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id),
    created_by uuid NOT NULL REFERENCES users(id),
    filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 120),
    content_type text NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    bucket text NOT NULL,
    object_key text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (bucket, object_key),
    UNIQUE (org_id, id)
);
CREATE INDEX files_org_created_idx ON files (org_id, created_at DESC, id);
