-- Speeds up the governed offline flow when an issuance resolves and consumes
-- the budget commitment attached to an existing reservation.
create index if not exists budget_commitments_reservation_status_idx
  on budget_commitments (tenant_id, reservation_id, status)
  where reservation_id is not null;
