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

testSanitizeMessyOrder();
testPhoneAndMoneyNormalization();
testOrderDetectionWithoutCreateKeyword();
testRafaOrderSanitizationShape();
testCorrectionsMergeThroughGrokSemantics();
testFreshOrderWhilePendingDetection();
testLocationCaptureNormalization();
testLocalCorrectionParserHandlesLocationWithoutGrok();
testLocalFullOrderFallbackParsesAnaOrder();

console.log('Grok-first bot helper tests passed.');
