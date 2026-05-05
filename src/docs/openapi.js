'use strict';

const config = require('../config');

/**
 * OpenAPI 3.0 specification untuk BCA Merchant QRIS Payment Gateway.
 */
function buildSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'BCA Merchant QRIS — Mini Payment Gateway',
      version: '0.1.0',
      description:
        'Unofficial payment gateway berbasis QRIS BCA. Generate dynamic QRIS dengan amount + kode unik, ' +
        'auto-polling cek mutasi, kirim webhook on paid.\n\n' +
        '**Disclaimer**: Tidak resmi, tidak berafiliasi dengan PT Bank Central Asia Tbk.',
      contact: { name: 'Maintainer', url: 'https://qr.klikbca.com' },
      license: { name: 'UNLICENSED' },
    },
    servers: [
      { url: 'http://localhost:' + config.server.port, description: 'Local' },
      { url: '/', description: 'Same origin' },
    ],
    tags: [
      { name: 'Payments', description: 'Buat & kelola payment dengan dynamic QRIS' },
      { name: 'Mutasi', description: 'Raw mutasi/inquiry dari portal BCA' },
      { name: 'System', description: 'Health & status' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Set `API_TOKEN` di .env supaya endpoint `/api/*` butuh `Authorization: Bearer <token>`. Kalau kosong, semua endpoint terbuka.',
        },
      },
      schemas: {
        PaymentStatus: {
          type: 'string',
          enum: ['pending', 'paid', 'expired', 'canceled'],
        },
        WebhookStatus: {
          type: 'string',
          enum: ['pending', 'retrying', 'sent', 'failed'],
          nullable: true,
        },
        Payment: {
          type: 'object',
          required: ['id', 'status', 'baseAmount', 'uniqueCode', 'totalAmount', 'qrisString', 'createdAt', 'expiresAt'],
          properties: {
            id: { type: 'string', example: 'pay_mos2w898d760b616' },
            status: { $ref: '#/components/schemas/PaymentStatus' },
            baseAmount: {
              type: 'integer',
              description: 'Amount asli yang diminta (Rupiah, integer).',
              example: 10000,
            },
            uniqueCode: {
              type: 'integer',
              description: 'Kode unik random dalam range UNIQUE_CODE_MIN..UNIQUE_CODE_MAX.',
              example: 364,
            },
            totalAmount: {
              type: 'integer',
              description: 'Total yang harus dibayar = baseAmount + uniqueCode.',
              example: 10364,
            },
            qrisString: {
              type: 'string',
              description: 'Raw QRIS string (EMVCo MPM dynamic, sudah include amount + CRC).',
              example: '00020101021226...6304EA0E',
            },
            qrImageDataUrl: {
              type: 'string',
              nullable: true,
              description: 'Data URL PNG dari QR. Hanya muncul saat create atau saat GET dengan ?includeQr=1.',
              example: 'data:image/png;base64,iVBORw0KGgo...',
            },
            webhookUrl: {
              type: 'string',
              nullable: true,
              format: 'uri',
              description: 'URL yang dipanggil saat status berubah.',
            },
            metadata: {
              type: 'object',
              nullable: true,
              additionalProperties: true,
              description: 'Data bebas yang dikembalikan apa adanya di webhook.',
              example: { orderId: 'ORD-001' },
            },
            createdAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time' },
            paidAt: { type: 'string', format: 'date-time', nullable: true },
            rrn: { type: 'string', nullable: true, example: '1o3io6b33538' },
            issuer: { type: 'string', nullable: true, example: 'DANA' },
            customer: { type: 'string', nullable: true, example: 'MI******' },
            webhookStatus: { $ref: '#/components/schemas/WebhookStatus' },
            webhookAttempts: { type: 'integer', minimum: 0, example: 0 },
          },
        },
        CreatePaymentRequest: {
          type: 'object',
          required: ['amount'],
          properties: {
            amount: {
              type: 'integer',
              minimum: 1,
              description: 'Base amount dalam Rupiah (integer, no decimal).',
              example: 10000,
            },
            webhookUrl: {
              type: 'string',
              format: 'uri',
              description: 'Override default WEBHOOK_URL untuk payment ini.',
              example: 'https://yourapp.example.com/webhook',
            },
            expiresInSeconds: {
              type: 'integer',
              minimum: 30,
              maximum: 86400,
              description: 'TTL pending (detik). Default = PAYMENT_EXPIRES_SECONDS.',
              example: 900,
            },
            metadata: {
              type: 'object',
              additionalProperties: true,
              example: { orderId: 'ORD-001', userId: 42 },
            },
          },
        },
        PaymentList: {
          type: 'object',
          properties: {
            count: { type: 'integer', example: 3 },
            data: { type: 'array', items: { $ref: '#/components/schemas/Payment' } },
          },
        },
        MutasiTransaction: {
          type: 'object',
          properties: {
            date: { type: 'string', example: '2026-05-02' },
            time: { type: 'string', example: '11:01' },
            rrn: { type: 'string', example: '1o3io6b33538' },
            merchantName: { type: 'string', example: 'J CELL' },
            nmid: { type: 'string', example: 'ID1026505506810' },
            issuer: { type: 'string', example: 'DANA' },
            customerName: { type: 'string', example: 'MI******' },
            type: { type: 'string', enum: ['credit', 'refund'] },
            amount: { type: 'integer', example: 10 },
            text: { type: 'string', description: 'Raw row text dari portal' },
          },
        },
        MutasiResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            query: {
              type: 'object',
              properties: {
                startDate: { type: 'string', format: 'date' },
                endDate: { type: 'string', format: 'date' },
              },
            },
            merchantId: { type: 'string', example: '004507515' },
            count: { type: 'integer' },
            perDay: {
              type: 'object',
              additionalProperties: { type: 'integer' },
              description: 'Map yyyy-MM-dd -> jumlah transaksi pada hari itu.',
              example: { '2026-05-02': 1, '2026-05-03': 0 },
            },
            warnings: { type: 'array', items: { type: 'string' } },
            fetchedAt: { type: 'string', format: 'date-time' },
            data: { type: 'array', items: { $ref: '#/components/schemas/MutasiTransaction' } },
          },
        },
        WebhookPayload: {
          type: 'object',
          description: 'Body yang dikirim ke `webhookUrl` saat status berubah. Ditandatangani via header `X-Signature: sha256=<hex>` dengan WEBHOOK_SECRET.',
          properties: {
            event: { type: 'string', example: 'payment.paid' },
            id: { type: 'string', example: 'pay_mos2w898d760b616' },
            status: { $ref: '#/components/schemas/PaymentStatus' },
            baseAmount: { type: 'integer', example: 10000 },
            uniqueCode: { type: 'integer', example: 364 },
            totalAmount: { type: 'integer', example: 10364 },
            createdAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time' },
            paidAt: { type: 'string', format: 'date-time', nullable: true },
            rrn: { type: 'string', nullable: true },
            issuer: { type: 'string', nullable: true },
            customer: { type: 'string', nullable: true },
            metadata: { type: 'object', nullable: true, additionalProperties: true },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'invalid_amount' },
            message: { type: 'string', example: 'amount harus integer Rupiah > 0.' },
          },
        },
      },
      responses: {
        BadRequest: {
          description: 'Input tidak valid',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Unauthorized: {
          description: 'Bearer token salah/tidak ada (saat API_TOKEN di-set)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'Resource tidak ditemukan',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          tags: ['System'],
          summary: 'Health check',
          security: [],
          responses: {
            '200': {
              description: 'Server hidup',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean', example: true },
                      env: { type: 'string', example: 'development' },
                      ts: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/payments': {
        post: {
          tags: ['Payments'],
          summary: 'Buat payment baru (dynamic QRIS)',
          description:
            'Generate kode unik random, build dynamic QRIS dengan amount = baseAmount + uniqueCode, simpan ke DB, ' +
            'dan return QR (string + PNG base64). Poller akan auto-match transaksi masuk dengan total amount yang sama.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreatePaymentRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Payment dibuat',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Payment' } },
              },
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '409': {
              description: 'Semua kode unik untuk amount ini sedang dipakai',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Error' } },
              },
            },
          },
        },
        get: {
          tags: ['Payments'],
          summary: 'List payments',
          parameters: [
            {
              name: 'status',
              in: 'query',
              schema: { $ref: '#/components/schemas/PaymentStatus' },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', minimum: 0, default: 0 },
            },
          ],
          responses: {
            '200': {
              description: 'Daftar payment',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/PaymentList' } },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/payments/{id}': {
        get: {
          tags: ['Payments'],
          summary: 'Cek status payment',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'includeQr',
              in: 'query',
              description: 'Set `1` atau `true` untuk include `qrImageDataUrl` di response.',
              schema: { type: 'string', enum: ['0', '1', 'true', 'false'] },
            },
          ],
          responses: {
            '200': {
              description: 'Detail payment',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Payment' } },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/payments/{id}/qr.png': {
        get: {
          tags: ['Payments'],
          summary: 'Render QR sebagai PNG image',
          description: 'Pakai langsung di tag `<img src="...">`. Mengembalikan binary PNG.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'size',
              in: 'query',
              description: 'Lebar/tinggi QR (px). Default 360.',
              schema: { type: 'integer', minimum: 64, maximum: 1024, default: 360 },
            },
          ],
          responses: {
            '200': {
              description: 'PNG image',
              content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/payments/{id}/cancel': {
        post: {
          tags: ['Payments'],
          summary: 'Cancel pending payment',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Payment dibatalkan',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Payment' } },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '409': {
              description: 'Payment tidak ditemukan atau status sudah bukan pending',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Error' } },
              },
            },
          },
        },
      },
      '/api/qris/mutasi': {
        get: {
          tags: ['Mutasi'],
          summary: 'Raw mutasi QRIS dari portal BCA',
          description:
            'Login ke `qr.klikbca.com`, klik tombol hari sesuai rentang, scrape DOM tabel transaksi. ' +
            'Limitasi: hanya 7 hari terakhir. `startDate` minimal = today - 6 days.',
          parameters: [
            {
              name: 'startDate',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'date', example: '2026-04-29' },
            },
            {
              name: 'endDate',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'date', example: '2026-05-05' },
            },
          ],
          responses: {
            '200': {
              description: 'Daftar transaksi',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/MutasiResponse' } },
              },
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '502': {
              description: 'Scrape gagal (login error / portal berubah / network)',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Error' } },
              },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  };
}

module.exports = { buildSpec };
