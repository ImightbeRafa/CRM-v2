-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "delivery" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerName" TEXT NOT NULL,
    "username" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "business" TEXT,
    "product" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "size" TEXT,
    "color" TEXT,
    "packaging" TEXT,
    "customization" TEXT,
    "comments" TEXT,
    "total" REAL NOT NULL DEFAULT 0,
    "iva" REAL,
    "shippingCost" REAL,
    "productCost" REAL,
    "funnel" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderId_key" ON "Order"("orderId");
