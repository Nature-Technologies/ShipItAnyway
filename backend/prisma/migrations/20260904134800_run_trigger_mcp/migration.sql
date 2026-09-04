-- prisma-no-transaction
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction on PostgreSQL < 12; the sentinel above runs this file outside a transaction.
ALTER TYPE "RunTrigger" ADD VALUE 'MCP';
