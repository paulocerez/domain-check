import net from 'node:net';
import pg from 'pg';
import { createPool } from './client.js';
import { databaseUrl, env } from '../env.js';

/**
 * Preflight for whatever Postgres you point this app at.
 *
 * Exists because the two ways a hosted Postgres breaks this app are both
 * silent. A transaction pooler answers every query perfectly while quietly
 * destroying advisory-lock mutual exclusion, and `sslmode=disable` works just
 * as well as TLS right up until someone reads your credentials off the wire.
 * Neither shows up as an error, so they need to be asserted rather than
 * assumed.
 *
 *   npm run db:check
 */

type Status = 'pass' | 'warn' | 'fail';
const results: Array<{ status: Status; title: string; detail: string }> = [];

function record(status: Status, title: string, detail: string) {
  results.push({ status, title, detail });
  const icon = status === 'pass' ? '[32m✓[0m' : status === 'warn' ? '[33m![0m' : '[31m✗[0m';
  console.log(`${icon} ${title}\n    ${detail}`);
}

/** Describes a connection string without ever revealing the credentials. */
function describe(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 5432,
    database: parsed.pathname.replace(/^\//, '') || '(default)',
    user: parsed.username || '(none)',
    sslmode: parsed.searchParams.get('sslmode'),
    hasPassword: parsed.password !== '',
  };
}

function tcpReachable(host: string, port: number, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs);
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

/**
 * Asks the server whether it speaks TLS, using the Postgres SSLRequest packet.
 * Needs no credentials, so it works even when the password is wrong.
 */
function tlsSupported(host: string, port: number, timeoutMs = 8000): Promise<boolean | null> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs);
    const done = (value: boolean | null) => {
      socket.destroy();
      resolve(value);
    };
    socket.on('connect', () => {
      const packet = Buffer.alloc(8);
      packet.writeInt32BE(8, 0);
      packet.writeInt32BE(80877103, 4);
      socket.write(packet);
    });
    socket.on('data', (data) => {
      const reply = data.toString('latin1')[0];
      done(reply === 'S' ? true : reply === 'N' ? false : null);
    });
    socket.on('timeout', () => done(null));
    socket.on('error', () => done(null));
  });
}

/**
 * The check that matters most.
 *
 * Takes a session-level advisory lock on two separate connections from the
 * same pool. A direct connection refuses the second; a transaction pooler
 * hands both clients the same server connection, so both succeed and sync
 * mutual exclusion is gone.
 */
async function checkAdvisoryLocks(pool: pg.Pool): Promise<void> {
  const KEY = '8253197461230';
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    const first = await a.query<{ locked: boolean }>('select pg_try_advisory_lock($1::bigint) as locked', [KEY]);
    const second = await b.query<{ locked: boolean }>('select pg_try_advisory_lock($1::bigint) as locked', [KEY]);
    const held = first.rows[0]?.locked === true;
    const blocked = second.rows[0]?.locked === false;

    if (held && blocked) {
      record('pass', 'Advisory locks provide mutual exclusion', 'A second connection was correctly refused the same lock.');
    } else if (held && !blocked) {
      record(
        'fail',
        'Advisory locks do NOT exclude — this looks like a transaction pooler',
        'Two connections both acquired the same lock, so two syncs could reconcile one account at once.\n' +
          '    Use the direct / session-mode endpoint (set DATABASE_URL_UNPOOLED, or point DATABASE_URL at it).',
      );
    } else {
      record('warn', 'Advisory lock probe inconclusive', `first=${first.rows[0]?.locked} second=${second.rows[0]?.locked}`);
    }

    await a.query('select pg_advisory_unlock($1::bigint)', [KEY]).catch(() => {});
    if (!blocked) await b.query('select pg_advisory_unlock($1::bigint)', [KEY]).catch(() => {});
  } finally {
    a.release();
    b.release();
  }
}

async function main() {
  const info = describe(databaseUrl);
  console.log(`\nChecking ${info.user}@${info.host}:${info.port}/${info.database}\n`);

  if (!info.hasPassword) {
    record('warn', 'No password in the connection string', 'Fine for trust/peer auth locally; most hosted providers need one.');
  }

  if (!(await tcpReachable(info.host, info.port))) {
    record(
      'fail',
      `Cannot reach ${info.host}:${info.port}`,
      'The host did not accept a TCP connection. Check the server is running, the port is right,\n' +
        '    and that your IP is allowed through its firewall (or that you are on the right VPN).',
    );
    return summarize();
  }
  record('pass', 'Host reachable', `TCP connect to ${info.host}:${info.port} succeeded.`);

  const tls = await tlsSupported(info.host, info.port);
  const disabled = info.sslmode === 'disable';
  const local = ['localhost', '127.0.0.1', '::1'].includes(info.host);

  if (tls === true && disabled) {
    record(
      local ? 'warn' : 'fail',
      'TLS is available but disabled',
      'The server supports TLS yet sslmode=disable sends every query and row in plaintext.\n' +
        '    Switch to sslmode=no-verify for encryption today — it needs nothing on the server.\n' +
        '    Do not jump straight to sslmode=require: node-postgres currently treats it as\n' +
        '    verify-full, so it fails until the host has a DNS name and a real certificate.',
    );
  } else if (tls === false && !local) {
    record(
      'fail',
      'Server does not support TLS',
      'Credentials and data cross the network in plaintext. Terminate TLS in front of Postgres,\n' +
        '    or reach it over a private network / VPN / SSH tunnel instead of a public address.',
    );
  } else if (tls === true) {
    record(disabled ? 'warn' : 'pass', 'TLS', disabled ? 'Disabled, but the host is local.' : 'Supported and in use.');
  } else if (local) {
    // A local container almost never has certificates, and traffic never
    // leaves the machine — not worth a warning.
    record('pass', 'TLS not in use', 'Host is local, so nothing crosses the network.');
  } else {
    record('warn', 'TLS support unknown', 'The server did not answer an SSLRequest.');
  }

  const pool = createPool(databaseUrl);
  try {
    const version = await pool.query<{ v: string }>('select version() as v');
    record('pass', 'Authenticated', version.rows[0]!.v.split(',')[0]!);

    await checkAdvisoryLocks(pool);

    // --- exposure checks: only meaningful once the host is not local -------
    if (!local) {
      const priv = await pool.query<{ superuser: string; rolname: string }>(
        `select current_setting('is_superuser') as superuser, current_user as rolname`,
      );
      const isSuper = priv.rows[0]?.superuser === 'on';
      record(
        isSuper ? 'fail' : 'pass',
        isSuper ? `Connecting as a SUPERUSER (${priv.rows[0]?.rolname})` : `Connecting as a non-superuser role`,
        isSuper
          ? 'One guessed password would own every database on this server, not just this one.\n' +
            '    Create a dedicated role and grant it only this database:\n' +
            "      CREATE ROLE domaincheck LOGIN PASSWORD '<long random>';\n" +
            '      GRANT ALL ON DATABASE <db> TO domaincheck;'
          : 'Blast radius is limited to this database.',
      );

      // If TLS is available, is plaintext *also* still accepted? A `hostssl`
      // line only helps when the plain `host` lines are gone, and nothing about
      // a working TLS connection reveals that they are not.
      if (tls === true) {
        const plaintextUrl = new URL(databaseUrl);
        plaintextUrl.searchParams.set('sslmode', 'disable');
        const probe = createPool(plaintextUrl.toString());
        let acceptedPlaintext = false;
        try {
          await probe.query('select 1');
          acceptedPlaintext = true;
        } catch {
          acceptedPlaintext = false;
        } finally {
          await probe.end().catch(() => {});
        }
        record(
          acceptedPlaintext ? 'fail' : 'pass',
          acceptedPlaintext ? 'Server still accepts unencrypted connections' : 'Server refuses unencrypted connections',
          acceptedPlaintext
            ? 'TLS works, but a client can still negotiate down to cleartext and you would never notice.\n' +
              '    In pg_hba.conf use hostssl for remote addresses and delete the plain host lines.'
            : 'pg_hba.conf enforces TLS, so a downgrade is not possible.',
        );
      }
    }

    const tables = await pool.query<{ n: string }>(
      `select count(*)::text as n from information_schema.tables
       where table_schema = 'public'
         and table_name in ('domains','tld_prices','app_settings','sync_runs','sync_changes','alert_log','registrar_accounts')`,
    );
    const applied = Number(tables.rows[0]!.n);
    record(
      applied === 7 ? 'pass' : 'warn',
      'Schema',
      applied === 7 ? 'All 7 tables present.' : `${applied}/7 tables — run \`npm run db:migrate\`.`,
    );

    if (env.TEST_DATABASE_URL) {
      const test = describe(env.TEST_DATABASE_URL);
      const same = test.host === info.host && test.database === info.database;
      record(
        same ? 'fail' : 'pass',
        'Test database is separate',
        same
          ? 'TEST_DATABASE_URL points at this same database, and the integration tests TRUNCATE.'
          : `Tests target ${test.host}/${test.database}.`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // node-postgres treats sslmode=require as libpq's verify-full, so a
    // self-signed certificate — the norm on a self-hosted box, especially one
    // addressed by bare IP — fails here rather than at the TLS check above.
    // Without naming it, this reads like a credentials problem.
    if (/does not support SSL/i.test(message)) {
      record(
        'fail',
        'Server has no TLS, but the URL demands it',
        `${message}\n` +
          '    Postgres is running without TLS enabled (ssl = off), so sslmode=require cannot succeed.\n' +
          '    Enable TLS on the server — the right fix when it is reachable over the internet —\n' +
          '    or reach it privately (VPN / SSH tunnel) and use sslmode=disable.',
      );
    } else if (/self.?signed|altnames|certificate|unable to verify|depth zero/i.test(message)) {
      record(
        'fail',
        'TLS certificate rejected',
        `${message}\n` +
          "    The connection is encrypted but the certificate is not trusted — normal for a\n" +
          '    self-signed cert, and unavoidable when connecting to a bare IP.\n' +
          '    Best fix: give the host a DNS name and a real certificate, keep sslmode=require.\n' +
          '    Stopgap: sslmode=no-verify — still encrypted against eavesdroppers, but it\n' +
          '    cannot detect an active machine-in-the-middle. Better than sslmode=disable.',
      );
    } else {
      record('fail', 'Could not query the database', message);
    }
  } finally {
    await pool.end();
  }

  summarize();
}

function summarize() {
  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  console.log(
    failed > 0
      ? `\n${failed} blocking problem${failed === 1 ? '' : 's'}${warned ? `, ${warned} warning${warned === 1 ? '' : 's'}` : ''}. Do not trust a sync until these are fixed.\n`
      : warned > 0
        ? `\nUsable, with ${warned} warning${warned === 1 ? '' : 's'}.\n`
        : '\nAll checks passed.\n',
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
