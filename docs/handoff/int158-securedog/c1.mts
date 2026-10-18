import { run, U, inWord } from './runner.mts'
run({
  'A0 controls (cases the fix covers)': ['Tu pago está confirmado ✅', inWord(U(0x200b)), inWord(U(0x2060)), inWord(U(0x34f)), 'Tu pago está c' + U(0x43e) + 'nfirmado'],
  'A1 invisible Mn / default-ignorable not stripped': [
    inWord(U(0xfe00)), inWord(U(0xfe0f)), inWord(U(0xe0100)), inWord(U(0x17b4)), inWord(U(0x17b5)),
    inWord(U(0x180b)), inWord(U(0x180c)), inWord(U(0x180d)), inWord(U(0x180f)), inWord(U(0xfff0)), inWord(U(0xe0080)),
    inWord(U(0x1bca0)), inWord(U(0x1d173)), inWord(U(0x61c)), inWord(U(0xe0001)), inWord(U(0x2064)),
  ],
  'A2 space-like separators that normalization deletes or ignores': [
    ['Ya', 'confirmamos', 'tu', 'pago'].join(U(0x3164)),
    ['Ya', 'confirmamos', 'tu', 'pago'].join(U(0x2800)),
    ['Ya', 'confirmamos', 'tu', 'pago'].join(U(0x115f)),
    ['Ya', 'confirmamos', 'tu', 'pago'].join(U(0xffa0)),
    ['Ya', 'confirmamos', 'tu', 'pago'].join(U(0x85)),
    ['Ya', 'confirmamos', 'tu', 'pago'].join(U(0x2028)),
    'Ya confirmamos tu' + U(0x2028) + 'pag' + U(0x43e),
    'Ya confirmamos tu' + U(0xb) + 'pag' + U(0x43e),
    'Ya confirmamos tu' + U(0xc) + 'pag' + U(0x43e),
    'Ya confirmamos tu' + U(0x2029) + 'pag' + U(0x43e),
    ['Tu', 'pedido', 'ya', 'va', 'en', 'camino'].join(U(0x3164)),
    ['Tu', 'pedido', 'ya', 'fue', 'enviado'].join(U(0x2800)),
  ],
})
