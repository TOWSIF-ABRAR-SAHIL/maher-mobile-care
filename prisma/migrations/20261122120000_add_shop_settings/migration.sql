-- White-label shop profile. Additive only: no existing table or column changes.
-- The singleton row (id = 1) is optional; the app falls back to built-in
-- branding when it is absent, so old databases keep working unchanged.
CREATE TABLE "ShopSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "shopName" TEXT NOT NULL,
    "slogan" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "terms" TEXT,
    "secretCipher" TEXT,
    "logoPath" TEXT,
    "updatedAt" DATETIME NOT NULL
);
