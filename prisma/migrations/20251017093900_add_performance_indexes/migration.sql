-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_orderType_idx" ON "Order"("orderType");

-- CreateIndex
CREATE INDEX "Order_timestamp_idx" ON "Order"("timestamp");

-- CreateIndex
CREATE INDEX "Order_customerName_idx" ON "Order"("customerName");

-- CreateIndex
CREATE INDEX "Order_seller_idx" ON "Order"("seller");

-- CreateIndex
CREATE INDEX "Order_saleDate_idx" ON "Order"("saleDate");

-- CreateIndex
CREATE INDEX "ProductField_active_idx" ON "ProductField"("active");

-- CreateIndex
CREATE INDEX "ProductField_order_idx" ON "ProductField"("order");

-- CreateIndex
CREATE INDEX "ProductOption_setId_idx" ON "ProductOption"("setId");

-- CreateIndex
CREATE INDEX "ProductOption_active_idx" ON "ProductOption"("active");

-- CreateIndex
CREATE INDEX "ProductOptionSet_active_idx" ON "ProductOptionSet"("active");

-- CreateIndex
CREATE INDEX "Seller_active_idx" ON "Seller"("active");

-- CreateIndex
CREATE INDEX "ShippingMethod_active_idx" ON "ShippingMethod"("active");

-- CreateIndex
CREATE INDEX "User_active_idx" ON "User"("active");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");
