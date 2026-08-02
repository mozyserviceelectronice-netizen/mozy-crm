BEGIN;

CREATE TABLE IF NOT EXISTS crm.whatsapp_chat_state (
  remote_jid TEXT PRIMARY KEY,
  phone TEXT,
  client_id INTEGER
    REFERENCES crm.clienti(id)
    ON DELETE SET NULL,
  name TEXT,
  unread_count INTEGER,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  archive_known BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_state_client
  ON crm.whatsapp_chat_state(client_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_state_phone
  ON crm.whatsapp_chat_state(phone);

CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_state_archived
  ON crm.whatsapp_chat_state(archived, archive_known);

CREATE TABLE IF NOT EXISTS crm.whatsapp_labels (
  label_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color INTEGER,
  predefined_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS crm.whatsapp_chat_labels (
  remote_jid TEXT NOT NULL
    REFERENCES crm.whatsapp_chat_state(remote_jid)
    ON DELETE CASCADE,
  label_id TEXT NOT NULL
    REFERENCES crm.whatsapp_labels(label_id)
    ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (remote_jid, label_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_labels_label
  ON crm.whatsapp_chat_labels(label_id, remote_jid);

CREATE TABLE IF NOT EXISTS crm.whatsapp_sync_meta (
  id SMALLINT PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT whatsapp_sync_meta_singleton
    CHECK (id = 1)
);

INSERT INTO crm.whatsapp_sync_meta (
  id,
  revision,
  updated_at
)
VALUES (
  1,
  0,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id)
DO NOTHING;

COMMIT;
