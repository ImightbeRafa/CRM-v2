-- CreateTable
CREATE TABLE "ProductField" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "optionSetId" TEXT,
    "multiSelect" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProductField_optionSetId_fkey" FOREIGN KEY ("optionSetId") REFERENCES "ProductOptionSet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductOptionSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "priceDelta" REAL NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProductOption_setId_fkey" FOREIGN KEY ("setId") REFERENCES "ProductOptionSet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShippingMethod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "carrier" TEXT,
    "basePrice" REAL NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Seller" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductField_key_key" ON "ProductField"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOptionSet_key_key" ON "ProductOptionSet"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_name_key" ON "Seller"("name");
