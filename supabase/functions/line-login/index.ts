// 用 LINE 的 ID token 換一個 Supabase 登入憑證。
// 需要的密鑰：LINE_CHANNEL_ID（LINE Login channel 的 Channel ID）；
// SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自動提供。
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const { idToken } = await req.json().catch(() => ({}));
  if (!idToken) return reply(400, { error: '缺少 idToken' });

  // 交給 LINE 驗證 token 是否有效、是不是發給我們這個 channel
  const verify = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: Deno.env.get('LINE_CHANNEL_ID')! }),
  });
  if (!verify.ok) return reply(401, { error: 'LINE 登入驗證失敗', detail: await verify.text() });
  const line: { sub: string; name?: string; picture?: string } = await verify.json();

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // Supabase 帳號以 email 為鍵；用 LINE 的使用者 ID 組一個不會寄信的內部地址
  const email = `${line.sub.toLowerCase()}@line.fenhaozhang.invalid`;
  const metadata = { line_sub: line.sub, name: line.name ?? '', picture: line.picture ?? '' };

  const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: metadata });
  if (created.error && created.error.status !== 422) return reply(500, { error: created.error.message });

  // 產生一次性登入 token，由前端換成正式的登入狀態
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) return reply(500, { error: link.error.message });
  if (!created.data.user) await admin.auth.admin.updateUserById(link.data.user.id, { user_metadata: metadata });

  return reply(200, { tokenHash: link.data.properties.hashed_token });
});
