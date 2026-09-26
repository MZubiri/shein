import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { allowedViews } from '../server/auth.js';

test('los permisos mantienen aislada la configuración sensible', () => {
  assert.deepEqual(allowedViews('owner'), ['*']);
  assert.equal(allowedViews('admin').includes('settings'), false);
  assert.equal(allowedViews('member').includes('members'), false);
  assert.deepEqual(allowedViews('pending'), ['account']);
});

test('el panel carga primero el cliente API y después la integración de datos', async () => {
  const html = await readFile(new URL('../DEMO/panel.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('api-client.js') < html.indexOf('panel.js'));
  assert.ok(html.indexOf('habbo-avatars.js') < html.indexOf('panel-data.js'));
});

test('la configuración de despliegue no publica MySQL', async () => {
  const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  const mysqlService = compose.slice(compose.indexOf('  mysql:'));
  assert.equal(/\n\s+ports:/.test(mysqlService), false);
  assert.match(compose, /mysql_data:\/var\/lib\/mysql/);
});

test('el registro nunca contiene campos de contraseña Habbo', async () => {
  const html = await readFile(new URL('../DEMO/registro.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../DEMO/registro.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /name=["']password/i);
  assert.match(script, /auth\/challenge/);
  assert.match(script, /auth\/verify/);
});

test('el despliegue está configurado como demo con acceso simulado', async () => {
  const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  const server = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(compose, /DEMO_MODE: \$\{DEMO_MODE:-true\}/);
  assert.match(server, /simulated: demoMode/);
  assert.match(server, /demoMode \|\| owner \? 'owner'/);
  assert.match(compose, /DATABASE_PASSWORD:-shein_demo_app_2026/);
  assert.match(compose, /MYSQL_ROOT_PASSWORD:-shein_demo_root_2026/);
});
