-- Add ERROR and CANCELLED terminal states to RunStatus
-- These cannot be added inside a transaction in PostgreSQL; each ALTER TYPE runs separately.
ALTER TYPE "RunStatus" ADD VALUE 'ERROR';
ALTER TYPE "RunStatus" ADD VALUE 'CANCELLED';
