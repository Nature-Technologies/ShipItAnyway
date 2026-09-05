-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN "scopes" "Scope"[] DEFAULT ARRAY[]::"Scope"[];
