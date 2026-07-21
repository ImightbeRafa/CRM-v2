import assert from 'node:assert/strict';

process.env.XAI_API_KEY ||= 'test-key';

const { __grokFirstOrderTestInternals: bot } = await import('../ai-agent');

const customFieldsConfig = {
  productFields: [
    { key: 'usuario', label: 'Usuario', type: 'text', required: true },
    { key: 'detalle', label: 'Detalles del personalizado', type: 'textarea', required: false },
  ],
  businessInfoFields: [
    { name: 'negocio', label: 'Negocio', type: 'text', required: true },
  ],
} as any;

const rafaOrderMessage = [
  'Ingresa este pedido',
  'Datos para guia correos',
  '',
  'Carolina Zuniga Zamora',
  'correo: karo84zz@gmail.com.',
  '84492744',
  '',
  'Provincia:San Jose,',
  'Canton:Mora Colon,',
  'Distrito:Brasil de Mora,',
  'Direccio:carretera a ciudad colon, calle cajetas, 4ta casa, mano izquierda, porton negro.',
  'Producto',
  '1 sleeping patches',
  'Pago 12,900CRC',
  'Sinpe confirmado',
].join('\n');

const anaOrderMessage = [
  'Ingresa este pedido',
  '',
  'sleeping patches x1',
  'sinpe confirmado 12.900',
  'correos de costa rica',
  '👤 Nombre completo: Ana Yancy Solis Picado',
  '📞 Teléfono: 88818786',
  '📍 Provincia / Cantón / Distrito: San José, Mercedes, Montes de Oca',
  '📧 Correo electrónico: aysolis13@gmail.com',
  '🏠 Dirección exacta:barrio Profesores calle C edificio gris con azul, rotulo de AFUP',
].join('\n');

function compactProducts(products: any[]) {
  return products.map((product) => ({
    name: product.name,
    quantity: product.quantity,
    ...(product.sku ? { sku: product.sku } : {}),
  }));
}

function testSanitizeMessyOrder() {
  const args = bot.sanitizeAIExtractedArgs({
    intent: 'new_order',
    customerName: 'Carolina Zuniga Zamora',
    email: 'karo84zz@gmail.com.    tel 84492744',
    phone: 'Ced303970214',
    province: 'San Jose',
    canton: 'Mora',
    district: 'Colon',
    address: 'Brasil de Mora, carretera a ciudad colon, calle cajetas, 4ta casa',
    products: [{ name: 'sleeping patches', quantity: 1 }],
    total: 'Pago 12,900CRC',
    orderType: 'EA',
    paymentMethod: 'SINPE',
    comments: 'Sinpe confirmado',
    customFields: [
      { key: 'usuario', value: 'Rafa' },
      { key: 'negocio', value: 'Deep Sleep' },
      { key: 'detalle', value: 'e.g., "placeholder"' },
      { key: 'unknown', value: 'drop me' },
    ],
  }, customFieldsConfig);

  assert.equal(args.customerName, 'Carolina Zuniga Zamora');
  assert.equal(args.email, 'karo84zz@gmail.com');
  assert.equal(args.phone, undefined);
  assert.equal(args.total, 12900);
  assert.deepEqual(args.products, [{ name: 'sleeping patches', quantity: 1 }]);
  assert.deepEqual(args.customFields, { usuario: 'Rafa', negocio: 'Deep Sleep' });
}

function testPhoneAndMoneyNormalization() {
  assert.equal(bot.normalizeCostaRicaPhone('+506 8449-2744'), '84492744');
  assert.equal(bot.normalizeCostaRicaPhone('303970214'), undefined);
  assert.equal(bot.normalizeCostaRicaPhone('Ced 303970214 tel 8449-2744'), '84492744');
  assert.equal(bot.parseCrcAmount('CRC 20.900'), 20900);
  assert.equal(bot.parseCrcAmount('11 500'), 11500);
}

function testOrderDetectionWithoutCreateKeyword() {
  const message = [
    'Carolina Zuniga Zamora',
    '84492744',
    'San Jose, Mora, Colon',
    'Brasil de Mora, calle cajetas',
    '1 sleeping patches',
    'Pago 12,900CRC',
    'Sinpe confirmado',
  ].join('\n');

  assert.equal(bot.looksLikeOrderPayload(message), true);
  assert.equal(bot.looksLikeFieldOnlyOrderFragment('karo84zz@gmail.com'), true);
  assert.equal(bot.looksLikeOrderPayload('crear guia para la orden 123'), false);
  assert.equal(bot.looksLikeOrderPayload(rafaOrderMessage), true);
  assert.equal(bot.looksLikeFieldOnlyOrderFragment(rafaOrderMessage), false);
}

function testRafaOrderSanitizationShape() {
  const args = bot.sanitizeAIExtractedArgs({
    intent: 'new_order',
    customerName: 'Carolina Zuniga Zamora',
    email: 'karo84zz@gmail.com.                                               84492744',
    phone: '84492744',
    province: 'San Jose',
    canton: 'Mora',
    district: 'Brasil de Mora',
    address: 'carretera a ciudad colon, calle cajetas, 4ta casa, mano izquierda, porton negro',
    products: [{ name: 'sleeping patches', quantity: 1 }],
    total: 'Pago 12,900CRC',
    orderType: 'EA',
    paymentMethod: 'SINPE',
    comments: 'Sinpe confirmado',
  }, customFieldsConfig);

  assert.equal(args.customerName, 'Carolina Zuniga Zamora');
  assert.equal(args.email, 'karo84zz@gmail.com');
  assert.equal(args.phone, '84492744');
  assert.equal(args.province, 'San Jose');
  assert.equal(args.canton, 'Mora');
  assert.equal(args.district, 'Brasil de Mora');
  assert.equal(args.total, 12900);
  assert.equal(args.orderType, 'EA');
  assert.deepEqual(args.products, [{ name: 'sleeping patches', quantity: 1 }]);
}

function testCorrectionsMergeThroughGrokSemantics() {
  const existing = {
    customerName: 'Carolina Zuniga Zamora',
    products: [{ name: 'sleeping patches', quantity: 1 }],
    quantity: 1,
    total: 12900,
  };

  const quantityUpdated = bot.mergeOrderCorrectionArgs(existing, {
    _correctionAction: 'update_quantity',
    quantity: 3,
  });
  assert.deepEqual(compactProducts(quantityUpdated.products), [{ name: 'sleeping patches', quantity: 3 }]);
  assert.equal(quantityUpdated.quantity, 3);

  const appended = bot.mergeOrderCorrectionArgs(existing, {
    _correctionAction: 'append_product',
    products: [{ name: 'dopamine patch', quantity: 2 }],
  });
  assert.deepEqual(compactProducts(appended.products), [
    { name: 'sleeping patches', quantity: 1 },
    { name: 'dopamine patch', quantity: 2 },
  ]);
  assert.equal(appended.quantity, 3);

  const replaced = bot.mergeOrderCorrectionArgs(existing, {
    _correctionAction: 'replace_product',
    products: [{ name: 'energy patch', quantity: 1 }],
  });
  assert.deepEqual(compactProducts(replaced.products), [{ name: 'energy patch', quantity: 1 }]);
  assert.equal(replaced.quantity, 1);

  const districtUpdated = bot.mergeOrderCorrectionArgs({
    ...existing,
    province: 'San Jose',
    canton: 'Mora',
    district: 'Colon',
  }, {
    _correctionAction: 'replace_location',
    district: 'Brasil de Mora',
  });
  assert.equal(districtUpdated.province, 'San Jose');
  assert.equal(districtUpdated.canton, 'Mora');
  assert.equal(districtUpdated.district, 'Brasil de Mora');
  assert.equal('_intent' in districtUpdated, false);
  assert.equal('_correctionAction' in districtUpdated, false);
}

function testFreshOrderWhilePendingDetection() {
  const message = [
    'Carolina Zuniga Zamora',
    '84492744',
    'San Jose, Mora, Colon',
    'Brasil de Mora, calle cajetas',
    '1 sleeping patches',
    'Pago 12,900CRC',
  ].join('\n');

  assert.equal(bot.shouldReplacePendingWithFreshOrder(message, {
    _intent: 'new_order',
    customerName: 'Carolina Zuniga Zamora',
    phone: '84492744',
    products: [{ name: 'sleeping patches', quantity: 1 }],
    total: 12900,
    province: 'San Jose',
    canton: 'Mora',
    district: 'Colon',
  }), true);

  assert.equal(bot.shouldReplacePendingWithFreshOrder('el distrito es Brasil de Mora', {
    _intent: 'order_correction',
    district: 'Brasil de Mora',
  }), false);
}

function testLocationCaptureNormalization() {
  const swapped: any = {
    orderType: 'EA',
    province: 'San José',
    canton: 'Mercedes',
    district: 'Montes de Oca',
  };
  bot.applyOrderCaptureLocationNormalization(swapped);
  assert.equal(swapped.province, 'San José');
  assert.equal(swapped.canton, 'Montes De Oca');
  assert.equal(swapped.district, 'Mercedes');
  assert.equal(swapped._locationCaptureAction, 'swapped');
  assert.equal(swapped._locationReviewWarning, undefined);

  const canonical: any = {
    orderType: 'EA',
    province: 'San Jose',
    canton: 'Montes de Oca',
    district: 'Mercedes',
  };
  bot.applyOrderCaptureLocationNormalization(canonical);
  assert.equal(canonical.province, 'San José');
  assert.equal(canonical.canton, 'Montes De Oca');
  assert.equal(canonical.district, 'Mercedes');
  assert.equal(canonical._locationReviewWarning, undefined);

  const rawInvalid: any = {
    orderType: 'EA',
    province: 'San José',
    canton: 'No Existe',
    district: 'Tampoco',
  };
  bot.applyOrderCaptureLocationNormalization(rawInvalid);
  assert.equal(rawInvalid.province, 'San José');
  assert.equal(rawInvalid.canton, 'No Existe');
  assert.equal(rawInvalid.district, 'Tampoco');
  assert.match(rawInvalid._locationReviewWarning, /Ubicacion guardada/);
}

function testLocalCorrectionParserHandlesLocationWithoutGrok() {
  const existing = {
    orderType: 'EA',
    customerName: 'Ana Yancy Solis Picado',
    products: [{ name: 'sleeping patches', quantity: 1 }],
    total: 12900,
    province: 'San José',
    canton: 'Mercedes',
    district: 'Montes de Oca',
  };

  const correction = bot.parseLocalOrderCorrectionArgs('San José, Mercedes, Montes de Oca', existing, customFieldsConfig);
  assert.ok(correction);
  assert.equal(correction._intent, 'order_correction');
  assert.equal(correction._correctionAction, 'replace_location');
  const merged = bot.mergeOrderCorrectionArgs(existing, correction);
  bot.applyOrderCaptureLocationNormalization(merged);
  assert.equal(merged.province, 'San José');
  assert.equal(merged.canton, 'Montes De Oca');
  assert.equal(merged.district, 'Mercedes');
}

const abigailOrderMessage = [
  'Deseo crear una nueva orden de EA',
  'Abigail Moraga Campos',
  '62048682',
  'Heredia/Barva/ San Pablo',
  'abimoca2004@gmail.com',
  '175 metros oeste de la escuela San Pablo de Barva, Calle la armonía',
  '',
  '- Producto(s):*BAR Bucal AntiRonquidos (SKU: 6942042)',
  'Cantidad  1',
  'TOTAL en colones* ₡ 12900',
  '- Tipo de orden: "EA" o "envío a domicilio"',
  '- Método de pago  SINPE CONFIRMADO',
  '- Método envío CORREOS DE CR',
  'COMENTARIO  SINPE CONFIRMADO',
].join('\n');

function testLocalFullOrderFallbackParsesAnaOrder() {
  const args = bot.parseLocalStructuredOrderArgs(anaOrderMessage, customFieldsConfig);
  assert.ok(args);
  bot.applyOrderCaptureLocationNormalization(args);

  assert.equal(args.customerName, 'Ana Yancy Solis Picado');
  assert.equal(args.phone, '88818786');
  assert.equal(args.email, 'aysolis13@gmail.com');
  assert.equal(args.total, 12900);
  assert.equal(args.paymentMethod, 'SINPE');
  assert.equal(args.courier, 'correos de costa rica');
  assert.equal(args.orderType, 'EA');
  assert.deepEqual(args.products, [{ name: 'sleeping patches', quantity: 1 }]);
  assert.equal(args.province, 'San José');
  assert.equal(args.canton, 'Montes De Oca');
  assert.equal(args.district, 'Mercedes');
  assert.match(args.address, /barrio Profesores/);
}

function testAbigailUnlabeledSlashOrderLocalFallback() {
  const args = bot.parseLocalStructuredOrderArgs(abigailOrderMessage, customFieldsConfig);
  assert.ok(args, 'Abigail order should parse via local fallback');
  bot.applyOrderCaptureLocationNormalization(args);

  assert.equal(args.customerName, 'Abigail Moraga Campos');
  assert.equal(args.phone, '62048682');
  assert.equal(args.email, 'abimoca2004@gmail.com');
  assert.equal(args.orderType, 'EA');
  assert.equal(args.paymentMethod, 'SINPE');
  assert.equal(args.total, 12900);
  assert.match(String(args.courier || ''), /correos/i);
  assert.doesNotMatch(String(args.courier || ''), /metodo/i);
  assert.match(String(args.comments || ''), /sinpe confirmado/i);
  assert.doesNotMatch(String(args.comments || ''), /metodo de pago/i);
  assert.match(String(args.address || ''), /escuela San Pablo/i);
  assert.equal(normalizeSpanish(args.province), 'heredia');
  assert.equal(normalizeSpanish(args.canton), 'barva');
  assert.equal(normalizeSpanish(args.district), 'san pablo');
  assert.ok(Array.isArray(args.products) && args.products.length > 0);
  assert.match(String(args.products[0].name), /BAR Bucal AntiRonquidos/i);
}

function normalizeSpanish(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function testGapFillEmptyFieldsDoesNotOverwriteAi() {
  const partialAi = bot.sanitizeAIExtractedArgs({
    intent: 'new_order',
    phone: '62048682',
    email: 'abimoca2004@gmail.com',
    products: [{ name: 'BAR Bucal AntiRonquidos', quantity: 1, sku: '6942042' }],
    total: 12900,
    orderType: 'EA',
    paymentMethod: 'SINPE',
    courier: 'Método envío CORREOS DE CR',
    comments: 'Método de pago SINPE CONFIRMADO',
  }, customFieldsConfig);

  assert.equal(partialAi.paymentMethod, 'SINPE');
  assert.equal(partialAi.courier, 'Correos de CR');
  assert.equal(partialAi.comments, 'SINPE CONFIRMADO');
  assert.equal(partialAi.customerName, undefined);

  const filled = bot.gapFillEmptyOrderFieldsFromMessage(partialAi, abigailOrderMessage, customFieldsConfig);
  assert.equal(filled.customerName, 'Abigail Moraga Campos');
  assert.match(String(filled.address || ''), /Calle la armonía/i);
  assert.equal(normalizeSpanish(filled.province), 'heredia');
  assert.equal(normalizeSpanish(filled.canton), 'barva');
  assert.equal(normalizeSpanish(filled.district), 'san pablo');
  // Must not overwrite AI-owned fields
  assert.equal(filled.phone, '62048682');
  assert.equal(filled.email, 'abimoca2004@gmail.com');
  assert.equal(filled.total, 12900);
  assert.equal(filled.paymentMethod, 'SINPE');
}

function testMultiMissingNameAndAddressCorrection() {
  const existing = {
    orderType: 'EA',
    phone: '62048682',
    email: 'abimoca2004@gmail.com',
    products: [{ name: 'BAR Bucal AntiRonquidos', quantity: 1 }],
    total: 12900,
    paymentMethod: 'SINPE',
  };

  const correction = bot.parseLocalOrderCorrectionArgs(
    ['Abigail Moraga Campos', '175 metros oeste de la escuela San Pablo de Barva, Calle la armonía'].join('\n'),
    existing,
    customFieldsConfig,
  );
  assert.ok(correction);
  const merged = bot.mergeOrderCorrectionArgs(existing, correction);
  assert.equal(merged.customerName, 'Abigail Moraga Campos');
  assert.match(String(merged.address || ''), /escuela San Pablo/i);
}

function testMultiMissingPartialNameOnlyCorrection() {
  const existing = {
    orderType: 'EA',
    phone: '62048682',
    products: [{ name: 'BAR Bucal AntiRonquidos', quantity: 1 }],
    total: 12900,
  };

  const correction = bot.parseLocalOrderCorrectionArgs('Abigail Moraga Campos', existing, customFieldsConfig);
  assert.ok(correction);
  const merged = bot.mergeOrderCorrectionArgs(existing, correction);
  assert.equal(merged.customerName, 'Abigail Moraga Campos');
}

function testGapFillAfterMergeDoesNotClobberPendingAddress() {
  const existing = {
    orderType: 'EA',
    customerName: 'Abigail Moraga Campos',
    phone: '62048682',
    email: 'abimoca2004@gmail.com',
    address: '175 metros oeste de la escuela San Pablo de Barva, Calle la armonía',
    province: 'Heredia',
    canton: 'Barva',
    district: 'San Josecito',
    products: [{ name: 'BAR Bucal AntiRonquidos', quantity: 1 }],
    total: 12900,
  };

  // Simulate sparse Grok correction (district only) + chatty user text with street cues.
  const sparse = bot.sanitizeAIExtractedArgs({
    intent: 'order_correction',
    correctionAction: 'replace_location',
    district: 'San Pablo',
  }, customFieldsConfig);

  const merged = bot.mergeOrderCorrectionArgs(existing, sparse);
  const afterGap = bot.gapFillEmptyOrderFieldsFromMessage(
    merged,
    'el distrito correcto es San Pablo cerca de la escuela San Pablo de Barva',
    customFieldsConfig,
  );

  assert.equal(afterGap.customerName, 'Abigail Moraga Campos');
  assert.equal(afterGap.address, existing.address);
  assert.equal(afterGap.district, 'San Pablo');
  assert.equal(afterGap.phone, '62048682');
}

function testGapFillNeverOverwritesExistingCustomerName() {
  const partialAi = {
    customerName: 'Nombre Correcto Ya Presente',
    phone: '62048682',
    orderType: 'EA',
    total: 12900,
    products: [{ name: 'BAR Bucal AntiRonquidos', quantity: 1 }],
  };
  const filled = bot.gapFillEmptyOrderFieldsFromMessage(partialAi, abigailOrderMessage, customFieldsConfig);
  assert.equal(filled.customerName, 'Nombre Correcto Ya Presente');
}

function testPlaceLikeLinesAreNotPersonNames() {
  const raw = bot.collectLocalOrderFields([
    'Brasil de Mora',
    '84492744',
    'sleeping patches x1',
    'Pago 12900',
  ].join('\n'), customFieldsConfig);
  assert.equal(raw.customerName, undefined);
  assert.equal(raw.phone, '84492744');
}

function testProductQuantityX2DoesNotDoubleInSanitize() {
  const args = bot.sanitizeAIExtractedArgs({
    intent: 'new_order',
    customerName: 'Christian Gonzalez Alvarez',
    products: [{ name: 'dopamine patch', quantity: 2 }],
    total: 20900,
    orderType: 'EA',
  }, customFieldsConfig);
  assert.deepEqual(args.products, [{ name: 'dopamine patch', quantity: 2 }]);

  const local = bot.parseLocalStructuredOrderArgs([
    'Christian Gonzalez Alvarez',
    '83608994',
    'San Jose, Alajuelita, Sanjosecito',
    'dopamine patch x2',
    'TOTAL 20900',
  ].join('\n'), customFieldsConfig);
  assert.ok(local);
  assert.deepEqual(compactProducts(local.products), [{ name: 'dopamine patch', quantity: 2 }]);
}

const luisMultiProductMessage = [
  'Deseo crear una nueva orden de EA',
  'Luis Zarate Montero',
  '87517195',
  'luisza14@gmail.com',
  'Heredia/Barva/San Pablo',
  '50 mtrs norte de la escuela Lucila Gurdian M, Buena Vista, casa porton negro',
  'PRODUCTO:',
  'DOPAMINE PATCH X1',
  'ENERGY PATCH X1',
  'GLP PATCH X2',
  'STRESS PATCH X1',
  'cantidad: 5',
  'TOTAL: ₡49.500',
  'Metodo de pago: SINPE MOVIL',
  'Metodo envio: CORREOS DE COSTA RICA',
  'COMENTARIOS: SINPE CONFIRMADO, TAMBIEN PIDIO DE SLEEP X6',
].join('\n');

function testLuisMultiLineProductBlockAppendsAllLines() {
  const args = bot.parseLocalStructuredOrderArgs(luisMultiProductMessage, customFieldsConfig);
  assert.ok(args, 'Luis multi-product order should parse');
  assert.equal(args.customerName, 'Luis Zarate Montero');
  assert.equal(args.phone, '87517195');
  assert.deepEqual(compactProducts(args.products), [
    { name: 'DOPAMINE PATCH', quantity: 1 },
    { name: 'ENERGY PATCH', quantity: 1 },
    { name: 'GLP PATCH', quantity: 2 },
    { name: 'STRESS PATCH', quantity: 1 },
  ]);
  assert.equal(args.quantity, 5);
  assert.equal(args.total, 49500);
}

function testCommaSeparatedMultiProductExpandsInSanitize() {
  const args = bot.sanitizeAIExtractedArgs({
    intent: 'new_order',
    customerName: 'Luis Zarate Montero',
    products: [{
      name: 'DOPAMINE PATCH X1, ENERGY PATCH X1, GLP PATCH X2 , STRESS PATCH X1',
      quantity: 1,
    }],
    total: 49500,
    orderType: 'EA',
  }, customFieldsConfig);

  assert.deepEqual(compactProducts(args.products), [
    { name: 'DOPAMINE PATCH', quantity: 1 },
    { name: 'ENERGY PATCH', quantity: 1 },
    { name: 'GLP PATCH', quantity: 2 },
    { name: 'STRESS PATCH', quantity: 1 },
  ]);
  assert.equal(args.quantity, 5);
}

function testCommaSeparatedCorrectionParsesAllProducts() {
  const args = bot.parseLocalStructuredOrderArgs([
    'Productos son 5',
    'PRODUCTO: DOPAMINE PATCH X1, ENERGY PATCH X1, GLP PATCH X2 , STRESS PATCH X1',
    'cantidad: 5',
    'Luis Zarate Montero',
    '87517195',
    'TOTAL 49500',
    'EA',
  ].join('\n'), customFieldsConfig);

  assert.ok(args);
  assert.deepEqual(compactProducts(args.products), [
    { name: 'DOPAMINE PATCH', quantity: 1 },
    { name: 'ENERGY PATCH', quantity: 1 },
    { name: 'GLP PATCH', quantity: 2 },
    { name: 'STRESS PATCH', quantity: 1 },
  ]);
  assert.equal(args.quantity, 5);
}

function testGapFillReplacesUnderCapturedSingleProductWithLocalMulti() {
  const underCaptured = bot.sanitizeAIExtractedArgs({
    intent: 'new_order',
    customerName: 'Luis Zarate Montero',
    phone: '87517195',
    products: [{ name: 'STRESS PATCH', quantity: 1 }],
    total: 49500,
    orderType: 'EA',
  }, customFieldsConfig);

  assert.equal(underCaptured.products.length, 1);

  const filled = bot.gapFillEmptyOrderFieldsFromMessage(
    underCaptured,
    luisMultiProductMessage,
    customFieldsConfig,
  );

  assert.deepEqual(compactProducts(filled.products), [
    { name: 'DOPAMINE PATCH', quantity: 1 },
    { name: 'ENERGY PATCH', quantity: 1 },
    { name: 'GLP PATCH', quantity: 2 },
    { name: 'STRESS PATCH', quantity: 1 },
  ]);
  assert.equal(filled.quantity, 5);
}

function testParseLocalProductsExtractsSku() {
  const products = bot.parseLocalProducts(
    'BAR Bucal AntiRonquidos (SKU: 6942042) x1\nDopamine Patch (SKU: 111) x2',
  );
  assert.deepEqual(compactProducts(products), [
    { name: 'BAR Bucal AntiRonquidos', quantity: 1, sku: '6942042' },
    { name: 'Dopamine Patch', quantity: 2, sku: '111' },
  ]);
}

function testExpandMashedProductEntries() {
  const expanded = bot.expandMashedProductEntries([
    { name: 'DOPAMINE PATCH X1, ENERGY PATCH X1', quantity: 1 },
  ]);
  assert.deepEqual(compactProducts(expanded), [
    { name: 'DOPAMINE PATCH', quantity: 1 },
    { name: 'ENERGY PATCH', quantity: 1 },
  ]);
}

function testInventoryMatchPickPreservesSiblingProducts() {
  const options = [
    { name: 'Stress Patch', sku: 'STR-RT34' },
    { name: 'GLP Patch', sku: 'PAR-1KMD' },
    { name: 'Energy Patch', sku: 'ENR5293241' },
  ];
  assert.deepEqual(bot.resolveInventoryMatchPick('1', options), {
    name: 'Stress Patch',
    sku: 'STR-RT34',
  });
  assert.deepEqual(bot.resolveInventoryMatchPick('STR-RT34', options), {
    name: 'Stress Patch',
    sku: 'STR-RT34',
  });
  assert.equal(bot.resolveInventoryMatchPick('9', options), null);

  const patched = bot.applyInventoryMatchPickToOrderArgs({
    customerName: 'Luis Zarate Montero',
    products: [
      { name: 'DOPAMINE PATCH', quantity: 1 },
      { name: 'ENERGY PATCH', quantity: 1 },
      { name: 'GLP PATCH', quantity: 2 },
      { name: 'STRESS PATCH', quantity: 1 },
    ],
    quantity: 5,
    total: 49500,
  }, 3, { name: 'Stress Patch', sku: 'STR-RT34' });

  assert.deepEqual(compactProducts(patched.products), [
    { name: 'DOPAMINE PATCH', quantity: 1 },
    { name: 'ENERGY PATCH', quantity: 1 },
    { name: 'GLP PATCH', quantity: 2 },
    { name: 'Stress Patch', quantity: 1, sku: 'STR-RT34' },
  ]);
  assert.equal(patched.quantity, 5);
}

function testGapFillUpgradesPartialMultiProductUnderCapture() {
  const partial = bot.sanitizeAIExtractedArgs({
    intent: 'new_order',
    customerName: 'Luis Zarate Montero',
    phone: '87517195',
    products: [
      { name: 'DOPAMINE PATCH', quantity: 1 },
      { name: 'STRESS PATCH', quantity: 1 },
    ],
    total: 49500,
    orderType: 'EA',
  }, customFieldsConfig);

  const filled = bot.gapFillEmptyOrderFieldsFromMessage(
    partial,
    luisMultiProductMessage,
    customFieldsConfig,
  );

  assert.deepEqual(compactProducts(filled.products), [
    { name: 'DOPAMINE PATCH', quantity: 1 },
    { name: 'ENERGY PATCH', quantity: 1 },
    { name: 'GLP PATCH', quantity: 2 },
    { name: 'STRESS PATCH', quantity: 1 },
  ]);
  assert.equal(filled.quantity, 5);
}

function testMashedPendingPickFlowKeepsFourLines() {
  // Simulate create_order canonicalizing a mashed blob, then a pick on line 0.
  const mashedArgs = bot.sanitizeAIExtractedArgs({
    intent: 'new_order',
    customerName: 'Luis Zarate Montero',
    products: [{
      name: 'DOPAMINE PATCH X1, ENERGY PATCH X1, GLP PATCH X2 , STRESS PATCH X1',
      quantity: 1,
    }],
    total: 49500,
    orderType: 'EA',
  }, customFieldsConfig);

  assert.equal(mashedArgs.products.length, 4);

  const afterPick = bot.applyInventoryMatchPickToOrderArgs(
    mashedArgs,
    0,
    { name: 'Dopamine Patch', sku: 'DOP-1' },
  );

  assert.equal(afterPick.products.length, 4);
  assert.equal(afterPick.products[0].name, 'Dopamine Patch');
  assert.equal(afterPick.products[0].sku, 'DOP-1');
  assert.equal(afterPick.products[1].name, 'ENERGY PATCH');
  assert.equal(afterPick.products[2].name, 'GLP PATCH');
  assert.equal(afterPick.products[3].name, 'STRESS PATCH');
  assert.equal(afterPick.quantity, 5);
}

testSanitizeMessyOrder();
testPhoneAndMoneyNormalization();
testOrderDetectionWithoutCreateKeyword();
testRafaOrderSanitizationShape();
testCorrectionsMergeThroughGrokSemantics();
testFreshOrderWhilePendingDetection();
testLocationCaptureNormalization();
testLocalCorrectionParserHandlesLocationWithoutGrok();
testLocalFullOrderFallbackParsesAnaOrder();
testAbigailUnlabeledSlashOrderLocalFallback();
testGapFillEmptyFieldsDoesNotOverwriteAi();
testMultiMissingNameAndAddressCorrection();
testMultiMissingPartialNameOnlyCorrection();
testGapFillAfterMergeDoesNotClobberPendingAddress();
testGapFillNeverOverwritesExistingCustomerName();
testPlaceLikeLinesAreNotPersonNames();
testProductQuantityX2DoesNotDoubleInSanitize();
testLuisMultiLineProductBlockAppendsAllLines();
testCommaSeparatedMultiProductExpandsInSanitize();
testCommaSeparatedCorrectionParsesAllProducts();
testGapFillReplacesUnderCapturedSingleProductWithLocalMulti();
testParseLocalProductsExtractsSku();
testExpandMashedProductEntries();
testInventoryMatchPickPreservesSiblingProducts();
testGapFillUpgradesPartialMultiProductUnderCapture();
testMashedPendingPickFlowKeepsFourLines();

console.log('Grok-first bot helper tests passed.');
