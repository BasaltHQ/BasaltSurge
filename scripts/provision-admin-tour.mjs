/** node scripts/provision-admin-tour.mjs [--verify]
 * Creates only this tour's resources. Checkpoints prevent duplicate creation on retry.
 * Credentials and the provisioning checkpoint stay in ignored local env files.
 */
import { readFile, writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { tourTools, tourPrompt, makeTourAgentConfig, TOUR_VOICE_ID, TOUR_VOICE_SETTINGS } from '../src/lib/admin-tour/agent-config.mjs';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });
const apiKey = process.env.ELEVENLABS_API || process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error('ElevenLabs credentials are not configured.');
const checkpointPath = '.env.tour-provision.json';
let checkpoint = { tools: {}, agentId: '' };
try { checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const persist = () => writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2) + '\n');

async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/${path}`, {
    method, headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Log schema paths/status only, never complete remote bodies or credentials.
    const fields = Array.isArray(data.detail) ? data.detail.map(d => ({ field: d.loc, message: d.msg })) : data.detail?.status || data.detail?.message || 'request rejected';
    throw new Error(`ElevenLabs ${method} ${path.split('?')[0]}: ${response.status}; ${JSON.stringify(fields)}`);
  }
  return data;
}

const existingId = process.env.ELEVENLABS_AGENT_ID_TOUR || checkpoint.agentId;
if (process.argv.includes('--verify')) {
  if (!existingId) throw new Error('No tour agent has been provisioned.');
  const agent = await api(`agents/${existingId}`);
  const ids = agent.conversation_config?.agent?.prompt?.tool_ids || [];
  const configs = await Promise.all(ids.map(id => api(`tools/${id}`)));
  const names = configs.map(t => (t.tool_config || t).name);
  if (agent.platform_settings?.auth?.enable_auth !== true) throw new Error('Tour agent authentication must be enabled.');
  if (agent.conversation_config?.agent?.first_message !== '') throw new Error('Tour must wait for the application-led first step.');
  if (agent.conversation_config?.agent?.prompt?.prompt !== tourPrompt) throw new Error('Tour prompt is outdated. Run provisioning to update the agent.');
  if (agent.conversation_config?.tts?.voice_id !== (process.env.ELEVENLABS_TOUR_VOICE_ID || TOUR_VOICE_ID)) throw new Error('Tour voice does not match its configured voice.');
  for (const [key, value] of Object.entries(TOUR_VOICE_SETTINGS)) if (agent.conversation_config?.tts?.[key] !== value) throw new Error(`Tour voice setting is outdated: ${key}`);
  if (!agent.conversation_config?.agent?.dynamic_variables?.dynamic_variable_placeholders?.tour_platform_name) throw new Error('Tour platform-name dynamic variable is missing.');
  if (typeof agent.conversation_config?.agent?.dynamic_variables?.dynamic_variable_placeholders?.tour_learner_name !== 'string') throw new Error('Tour learner-name dynamic variable is missing.');
  for (const tool of tourTools) if (!names.includes(tool.name)) throw new Error(`Missing client tool: ${tool.name}`);
  const signed = await api(`conversation/get-signed-url?agent_id=${encodeURIComponent(existingId)}`);
  if (!signed.signed_url?.startsWith('wss://')) throw new Error('Signed session URL was not returned.');
  const rtc = await api(`conversation/token?agent_id=${encodeURIComponent(existingId)}`);
  if (!rtc.token) throw new Error('WebRTC session token was not returned.');
  console.log(JSON.stringify({ verified: true, agentId: existingId, authenticated: true, tools: names, signedSessionAvailable: true, webRTCSessionAvailable: true }));
} else {
  if (existingId) {
    const agent = await api(`agents/${existingId}`);
    if (agent.name !== 'Take The Tour — Admin Training') throw new Error('Configured agent is not the tour agent; refusing to modify it.');
  }
  const ids = [];
  for (const tool of tourTools) {
    const known = checkpoint.tools[tool.name];
    const data = await api(known ? `tools/${known}` : 'tools', known ? 'PATCH' : 'POST', { tool_config: tool });
    const id = data.id || data.tool_id || known;
    if (!id) throw new Error(`No ID returned for ${tool.name}`);
    checkpoint.tools[tool.name] = id;
    await persist();
    ids.push(id);
  }
  const voiceId = process.env.ELEVENLABS_TOUR_VOICE_ID || TOUR_VOICE_ID;
  const data = await api(existingId ? `agents/${existingId}` : 'agents/create', existingId ? 'PATCH' : 'POST', makeTourAgentConfig(ids, voiceId));
  const agentId = data.agent_id || existingId;
  if (!agentId) throw new Error('No agent ID returned.');
  checkpoint.agentId = agentId;
  await persist();
  let env = await readFile('.env.local', 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  const entry = `ELEVENLABS_AGENT_ID_TOUR=${agentId}`;
  env = /^ELEVENLABS_AGENT_ID_TOUR=.*$/m.test(env) ? env.replace(/^ELEVENLABS_AGENT_ID_TOUR=.*$/m, entry) : `${env.trimEnd()}\n${entry}\n`;
  await writeFile('.env.local', env);
  console.log(JSON.stringify({ agentId, tools: ids.length, configuredIn: '.env.local', updated: !!existingId }));
}
