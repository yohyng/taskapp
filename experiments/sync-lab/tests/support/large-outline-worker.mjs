import { parentPort } from 'node:worker_threads';
import { UndoManager } from 'loro-crdt';
import { seedOutlineDocument, applyOutlineIntent, outlineNodes } from '../../src/outline-model.js';
import { loroViewRows } from '../../src/loro-model.js';
import { largeText } from './large-text.mjs';

const doc = seedOutlineDocument([{ id: 'memo', text: 'メモ', children: [] }]), undo = new UndoManager(doc, { mergeInterval: 0 });
try {
  parentPort.postMessage({ stage: '本文を作成' });
  const value = largeText(400000), before = outlineNodes(loroViewRows(doc));
  parentPort.postMessage({ stage: '本文を更新' });
  applyOutlineIntent(doc, before, [{ ...before[0], text: value }]);
  parentPort.postMessage({ stage: '操作を確定' }); doc.commit();
  parentPort.postMessage({ stage: '確定後の本文を確認' });
  const pasted = outlineNodes(loroViewRows(doc))[0].text === value;
  parentPort.postMessage({ stage: 'Undo' });
  undo.undo(); const undone = outlineNodes(loroViewRows(doc))[0].text === 'メモ';
  parentPort.postMessage({ stage: 'Redo' });
  undo.redo(); const redone = outlineNodes(loroViewRows(doc))[0].text === value;
  parentPort.postMessage({ pasted, undone, redone });
} finally { undo.free(); doc.free(); }
