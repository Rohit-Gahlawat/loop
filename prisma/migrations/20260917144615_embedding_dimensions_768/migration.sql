-- The embedding provider changed, and its vectors are 768 wide rather than 1024.
-- Prisma cannot diff inside an Unsupported() column type, so this is written by hand.
-- No embeddings have been generated yet, so the column can be retyped in place.
ALTER TABLE "Embedding" ALTER COLUMN "vector" TYPE vector(768);
