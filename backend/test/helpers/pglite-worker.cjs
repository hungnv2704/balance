'use strict';

const { parentPort } = require('node:worker_threads');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

if (!parentPort) {
  throw new Error('pglite-worker.cjs must be run inside a Worker thread.');
}

let db = null;
let nextTxId = 1;
const activeTransactions = new Map();
const txDonePromises = new Map();

function serializeError(err) {
  return {
    name: err && err.name ? String(err.name) : 'Error',
    message: err && err.message ? String(err.message) : String(err),
    code: err && err.code ? String(err.code) : undefined,
    constraint: err && err.constraint ? String(err.constraint) : undefined,
    detail: err && err.detail ? String(err.detail) : undefined,
    schema: err && err.schema ? String(err.schema) : undefined,
    table: err && err.table ? String(err.table) : undefined,
    column: err && err.column ? String(err.column) : undefined,
  };
}

async function handleMessage(msg) {
  const { id, type } = msg;
  try {
    if (type === 'init') {
      db = new PGlite({ extensions: { pgcrypto } });
      await db.waitReady;
      parentPort.postMessage({ id, ok: true });
      return;
    }

    if (!db) {
      throw new Error('PGlite worker has not been initialized.');
    }

    if (type === 'exec') {
      await db.exec(msg.sql);
      parentPort.postMessage({ id, ok: true });
      return;
    }

    if (type === 'query') {
      const target = msg.txId ? activeTransactions.get(msg.txId)?.tx : db;
      if (!target) {
        throw new Error(`Transaction ${String(msg.txId)} is not active.`);
      }
      const res = await target.query(msg.text, msg.params);
      parentPort.postMessage({
        id,
        ok: true,
        result: {
          rows: res.rows,
          rowCount: res.rowCount ?? res.affectedRows ?? res.rows.length,
        },
      });
      return;
    }

    if (type === 'beginTx') {
      const txId = nextTxId++;
      let settle;
      const gate = new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
      const txDone = db.transaction(async (tx) => {
        activeTransactions.set(txId, { tx, settle });
        parentPort.postMessage({ id, ok: true, result: { txId } });
        return gate;
      });
      // Prevent unhandled rejection when gate rejects on rollback before rollbackTx awaits txDone
      txDone.catch(() => undefined);
      txDonePromises.set(txId, txDone);
      return;
    }

    if (type === 'commitTx') {
      const entry = activeTransactions.get(msg.txId);
      const txDone = txDonePromises.get(msg.txId);
      activeTransactions.delete(msg.txId);
      txDonePromises.delete(msg.txId);
      if (!entry || !txDone) {
        throw new Error(`Transaction ${String(msg.txId)} is not active.`);
      }
      entry.settle.resolve();
      await txDone;
      parentPort.postMessage({ id, ok: true });
      return;
    }

    if (type === 'rollbackTx') {
      const entry = activeTransactions.get(msg.txId);
      const txDone = txDonePromises.get(msg.txId);
      activeTransactions.delete(msg.txId);
      txDonePromises.delete(msg.txId);
      if (entry && txDone) {
        entry.settle.reject(new Error('__WORKER_TX_ROLLBACK__'));
        await txDone.catch(() => undefined);
      }
      parentPort.postMessage({ id, ok: true });
      return;
    }

    if (type === 'close') {
      await db.close();
      db = null;
      parentPort.postMessage({ id, ok: true });
      return;
    }

    throw new Error(`Unknown worker message type: ${String(type)}`);
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: serializeError(err) });
  }
}

parentPort.on('message', (msg) => {
  void handleMessage(msg);
});
