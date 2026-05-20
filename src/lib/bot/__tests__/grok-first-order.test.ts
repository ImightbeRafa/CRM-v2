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

testSanitizeMessyOrder();
testPhoneAndMoneyNormalization();
testOrderDetectionWithoutCreateKeyword();
testCorrectionsMergeThroughGrokSemantics();
testFreshOrderWhilePendingDetection();

console.log('Grok-first bot helper tests passed.');
