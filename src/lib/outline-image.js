import { makeNode, pathTo, updateNode, insertAfter } from './outline.js';

// ドラッグ中はブラウザーがファイル本体を隠す。種類だけで受け入れを判断する。
export function hasDraggedImage(data) {
  return [...(data?.files || [])].some((file)=>file.type?.startsWith('image/'))
    || [...(data?.items || [])].some((item)=>item.kind === 'file' && item.type?.startsWith('image/'));
}

// アップロード完了時には、開始時の空行へ文字が入力されたり行が移動・削除されたりしている。
// 最新の木へURLを置き、書きかけを上書きせず、置き場が消えてもURLを失わない。
export function placeUploadedImage(nodes, { nodeId, parentId }, url) {
  const target = nodeId ? pathTo(nodes, nodeId)?.at(-1) : null;
  if (target && !String(target.text || '').trim()) return updateNode(nodes, target.id, {text:url,imageWidth:null});
  const made = makeNode(url);
  if (target) return insertAfter(nodes, target.id, made);
  const parent = parentId ? pathTo(nodes, parentId)?.at(-1) : null;
  if (parent) return updateNode(nodes, parent.id, {children:[...(parent.children || []),made]});
  return [...nodes,made];
}
