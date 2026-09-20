-- Migration 0004: allow validation_status 'found' on extracted_fields.
-- The 0001 CHECK omitted 'found', so every successfully validated extraction
-- write was rejected and degraded to not_found. Also aligns the Drizzle type.
ALTER TABLE extracted_fields DROP CONSTRAINT extracted_fields_validation_status_check;
ALTER TABLE extracted_fields ADD CONSTRAINT extracted_fields_validation_status_check
  CHECK (validation_status IN ('unreviewed','confirmed','corrected','rejected','not_found','found','conflicting','needs_confirmation','superseded_extraction'));
