-- Migration 0005: allow the append-only 'reopened' decision (phase 8 matrix:
-- reopen action records a new decision row; decisions are never edited).
ALTER TABLE risk_decisions DROP CONSTRAINT risk_decisions_decision_check;
ALTER TABLE risk_decisions ADD CONSTRAINT risk_decisions_decision_check
  CHECK (decision IN ('accepted_risk','needs_negotiation','escalated','not_a_risk','reopened'));
