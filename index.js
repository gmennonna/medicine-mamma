import { buildPushHTTPRequest } from '@pushforge/builder';

// Chiave usata in KV per salvare iscrizione + elenco medicine (un solo utente: mamma)
const STATE_KEY = 'state';

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const headers = corsHeaders(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    if (url.pathname === '/register' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (!body.subscription || !body.subscription.endpoint) {
          return new Response(JSON.stringify({ error: 'missing subscription' }), {
            status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
        const medicines = Array.isArray(body.medicines) ? body.medicines : [];
        await env.MED_KV.put(STATE_KEY, JSON.stringify({ subscription: body.subscription, medicines }));
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'bad request' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    if (url.pathname === '/' ) {
      return new Response('Medicine reminder push server: attivo.', { headers });
    }

    return new Response('Not found', { status: 404, headers });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAndSend(env));
  },
};

async function checkAndSend(env) {
  const raw = await env.MED_KV.get(STATE_KEY);
  if (!raw) return;
  const { subscription, medicines } = JSON.parse(raw);
  if (!subscription || !medicines || medicines.length === 0) return;

  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });

  const hhmm = `${map.hour}:${map.minute}`;
  const dateKey = `${map.year}-${map.month}-${map.day}`;
  const weekdayMap = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const wi = weekdayMap[map.weekday];

  for (const med of medicines) {
    if (med.time !== hhmm) continue;
    const days = (med.days && med.days.length === 7) ? med.days : [true, true, true, true, true, true, true];
    if (!days[wi]) continue;

    const sentKey = `sent:${dateKey}:${med.id}`;
    const alreadySent = await env.MED_KV.get(sentKey);
    if (alreadySent) continue;

    const delivered = await sendPush(env, subscription, med);
    if (delivered !== 'gone') {
      await env.MED_KV.put(sentKey, '1', { expirationTtl: 90000 });
    }
  }
}

async function sendPush(env, subscription, med) {
  const privateJWK = JSON.parse(env.VAPID_PRIVATE_KEY);
  const message = {
    payload: {
      title: 'È ora di prendere: ' + med.name,
      body: (med.dose ? med.dose + ' · ' : '') + 'ore ' + med.time + (med.notes ? ' · ' + med.notes : ''),
      icon: 'icon-192.png',
      tag: 'med-' + med.id,
    },
    adminContact: env.VAPID_CONTACT_EMAIL || 'mailto:example@example.com',
    options: { ttl: 3600, urgency: 'high' },
  };

  try {
    const { endpoint, headers, body } = await buildPushHTTPRequest({ privateJWK, subscription, message });
    const res = await fetch(endpoint, { method: 'POST', headers, body });

    if (res.status === 404 || res.status === 410) {
      // L'iscrizione non è più valida (es. permesso revocato): la rimuoviamo.
      const raw = await env.MED_KV.get(STATE_KEY);
      if (raw) {
        const state = JSON.parse(raw);
        delete state.subscription;
        await env.MED_KV.put(STATE_KEY, JSON.stringify(state));
      }
      return 'gone';
    }
    return res.ok ? 'sent' : 'error';
  } catch (e) {
    return 'error';
  }
}
