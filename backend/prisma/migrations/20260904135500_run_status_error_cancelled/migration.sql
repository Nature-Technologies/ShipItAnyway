-- prisma-no-transaction
-- Add ERROR and CANCELLED terminal states to RunStatus.
-- The no-transaction sentinel above causes Prisma to run each statement outside a transaction,
-- which is required because ALTER TYPE ... ADD VALUE cannot run inside a transaction.
ALTER TYPE "RunStatus" ADD VALUE 'ERROR';
ALTER TYPE "RunStatus" ADD VALUE 'CANCELLED';
