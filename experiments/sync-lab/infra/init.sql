CREATE DATABASE lab_storage;
CREATE TABLE lab_documents(id text PRIMARY KEY);
CREATE TABLE lab_rows (
  id text PRIMARY KEY, doc_id text NOT NULL, node_id text NOT NULL,
  text text NOT NULL, parent_id text, sort_order integer NOT NULL,
  favorite integer NOT NULL, completed integer NOT NULL, deleted integer NOT NULL DEFAULT 0
);
CREATE TABLE lab_conflicts (
  id text PRIMARY KEY, doc_id text NOT NULL, node_id text NOT NULL,
  field text NOT NULL, mine text NOT NULL, theirs text NOT NULL, operation_id text NOT NULL
);
CREATE TABLE lab_operations(id text PRIMARY KEY, doc_id text NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL);
ALTER TABLE lab_rows REPLICA IDENTITY FULL;
ALTER TABLE lab_conflicts REPLICA IDENTITY FULL;
CREATE PUBLICATION powersync FOR TABLE lab_rows, lab_conflicts;
