import { ownerServer } from '../../scripts/owner-server.mjs';
import { durableFile } from '../../scripts/durable-file.mjs';

// 障害注入は子プロセス内だけ。HTTP経由で保存停止やトークン発行を操作する口は作らない。
let server, hold = false, release;
process.on('message', async (message) => {
  if (message.type === 'start') {
    server = await ownerServer({ ...message.options, allowLocalTestIssuer: true,
      async save(file, contents) {
        if (hold) { hold = false; process.send({ type: 'saving' }); await new Promise((resolve) => { release = resolve; }); }
        await durableFile(file, contents);
      },
    });
    process.send({ type: 'ready', url: server.url });
  }
  if (message.type === 'hold') { hold = true; process.send({ type: 'held' }); }
  if (message.type === 'release') release?.();
  if (message.type === 'close') { await server?.close(); process.exit(); }
});
