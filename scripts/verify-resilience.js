const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const testPort = 17389;
process.env.BOOSTY_OVERLAY_PORT = String(testPort);
const tmpConfig = path.join(__dirname, '..', 'overlay-settings-resilience.json');
process.env.BOOSTY_OVERLAY_CONFIG = tmpConfig;
try { fs.unlinkSync(tmpConfig); } catch {}

const { server, host } = require('../server.js');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port: testPort, ...options }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function listenSse(headers = {}, durationMs = 600) {
  return new Promise((resolve, reject) => {
    const received = [];
    const req = http.request({ host, port: testPort, path: '/events', method: 'GET', headers }, res => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          if (part.includes('data:')) {
            const dataLine = part.split('\n').find(l => l.startsWith('data: '));
            const idLine = part.split('\n').find(l => l.startsWith('id: '));
            if (dataLine) {
              try {
                const parsed = JSON.parse(dataLine.slice(6));
                if (idLine) parsed._eventIdHeader = idLine.slice(4).trim();
                received.push(parsed);
              } catch {}
            }
          }
        }
      });
    });
    req.on('error', err => {
      if (err.code !== 'ECONNRESET') reject(err);
    });
    setTimeout(() => {
      req.destroy();
      resolve(received);
    }, durationMs);
    req.end();
  });
}

async function runVerification() {
  console.log('--- Step 1: Проверка обычной доставки сообщений ---');
  const listenerPromise = listenSse({}, 800);
  await new Promise(r => setTimeout(r, 100));

  const post1 = await request(
    { path: '/message', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ id: 'live-1', author: 'Зритель 1', text: 'Первое сообщение' })
  );
  assert.strictEqual(post1.status, 202);
  const liveReceived = await listenerPromise;
  assert.ok(liveReceived.some(m => m.id === 'live-1'), 'Сообщение live-1 должно быть доставлено');
  console.log('✔ Обычная доставка сообщений работает');

  console.log('--- Step 2: Закрытие overlay и отправка в офлайн ---');
  // Overlay отключен (нет слушателей). Отправляем второе сообщение.
  const post2 = await request(
    { path: '/message', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ id: 'live-2', author: 'Зритель 2', text: 'Второе сообщение при закрытом оверлее' })
  );
  assert.strictEqual(post2.status, 202);
  const post2Data = JSON.parse(post2.body);
  assert.ok(post2Data.eventId, 'Должен быть возвращен eventId');
  console.log('✔ Сообщение live-2 сохранено на сервере с eventId=' + post2Data.eventId);

  console.log('--- Step 3: Повторное открытие overlay (Fresh reload) ---');
  // Открываем оверлей заново (без Last-Event-ID)
  const reloadedMessages = await listenSse({}, 600);
  assert.ok(reloadedMessages.some(m => m.id === 'live-1'), 'live-1 должно быть в восстановленной истории');
  assert.ok(reloadedMessages.some(m => m.id === 'live-2'), 'live-2 должно быть в восстановленной истории');
  const live2InHistory = reloadedMessages.find(m => m.id === 'live-2');
  assert.ok(typeof live2InHistory.receivedAt === 'number', 'receivedAt должно быть числом');
  console.log('✔ Восстановление истории при новом открытии overlay успешно');

  console.log('--- Step 4: Проверка SSE reconnect с Last-Event-ID ---');
  // Допустим, оверлей видел live-1 (eventId: 1). При реконнекте он передает Last-Event-ID: 1.
  const live1EventId = reloadedMessages.find(m => m.id === 'live-1').eventId;
  const reconnectedMessages = await listenSse({ 'Last-Event-ID': String(live1EventId) }, 600);
  assert.strictEqual(reconnectedMessages.some(m => m.id === 'live-1'), false, 'live-1 НЕ должно приходить повторно при Last-Event-ID');
  assert.ok(reconnectedMessages.some(m => m.id === 'live-2'), 'live-2 должно быть получено после реконнекта');
  console.log('✔ SSE reconnect с Last-Event-ID досылает только новые сообщения');

  console.log('--- Step 5: Проверка отсутствия дублей на сервере ---');
  const dupPost = await request(
    { path: '/message', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ id: 'live-2', author: 'Зритель 2', text: 'Повторная отправка live-2' })
  );
  assert.strictEqual(dupPost.status, 202);
  const dupData = JSON.parse(dupPost.body);
  assert.strictEqual(dupData.duplicate, true, 'Повторный ID должен возвращать duplicate: true');
  console.log('✔ Серверная дедупликация подтверждена');

  console.log('\n Все сценарии устойчивости успешно подтверждены!');
}

runVerification()
  .then(() => {
    server.close(() => {
      try { fs.unlinkSync(tmpConfig); } catch {}
      process.exit(0);
    });
  })
  .catch(err => {
    console.error('Ошибка верификации:', err);
    server.close(() => {
      try { fs.unlinkSync(tmpConfig); } catch {}
      process.exit(1);
    });
  });
