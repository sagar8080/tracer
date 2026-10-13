-- Onboarding owns explicit account-to-planning-profile associations.
-- Existing memberships and people stay independent until an administrator links them.
CREATE TABLE member_people (
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    person_id uuid NOT NULL,
    PRIMARY KEY (org_id, user_id),
    UNIQUE (org_id, person_id),
    FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (org_id, person_id) REFERENCES people(org_id, id)
);
CREATE INDEX invitations_pending_email_idx ON invitations(email, expires_at)
    WHERE accepted_by IS NULL AND revoked_at IS NULL;
