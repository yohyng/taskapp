import { createServer } from 'node:http';
import { loroApi } from './loro-api.mjs';
import { ownerAuthorization } from './owner-authorization.mjs';

// 独立した合成試験用。AuthのURL・所有者・文書許可は端末から変更できない。
export async function ownerServer({ directory, port = 0, authUrl, apiKey, ownerId, documents, allowLocalTestIssuer = false, save }) {
  const authorize = ownerAuthorization({ authUrl, apiKey, ownerId, documents, allowLocalTestIssuer });
  const api = await loroApi(directory, { prefix: '/lab/owner-loro', authorize, save });
  const server = createServer((request, response) => api.middleware(request, response, () => { response.statusCode = 404; response.end('{}'); }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() { await new Promise((resolve) => server.close(resolve)); await api.close(); },
  };
}
