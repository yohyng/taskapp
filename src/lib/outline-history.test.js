import { describe, it, expect } from 'vitest';
import { ensureNode, flattenTree, updateNode } from './outline.js';
import { applyOutlineHistory } from './outline-history.js';

const node = (id, children = [], patch = {}) => ensureNode({id, text: id, children, ...patch,
  createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z'});
const rows = (nodes) => flattenTree(nodes).map(({id, parentId}) => [id, parentId]);
const undo = (now, before, after) => applyOutlineHistory(now, after, before);
const field = (nodes, id, key) => flattenTree(nodes).find((row) => row.id === id)?.[key];

describe('自分の操作だけを現在の文書へ戻す', () => {
  it('別の行の本文と追加行を残し、自分の本文だけを戻せる', () => {
    const before = [node('a'), node('b')], after = updateNode(before, 'a', {text:'自分の編集'});
    const remoteB = node('b', [], {text:'別端末'}), current = [after[0], remoteB, node('c')];
    const got = undo(current, before, after);
    expect(got.blocked).toBe(false);
    expect(got.nodes.map((node) => node.text)).toEqual(['a', '別端末', 'c']);
    expect(got.nodes[1]).toBe(remoteB);
  });
  it('同じ行の色と子を残して本文だけを戻せる', () => {
    const before = [node('a')], after = updateNode(before,'a',{text:'自分の編集'});
    const current = [node('a', [node('remote-child')], {text:'自分の編集', bgColor:'#123456'})];
    const got = undo(current, before, after);
    expect(got.blocked).toBe(false);
    expect(got.nodes[0]).toMatchObject({text:'a', bgColor:'#123456'});
    expect(rows(got.nodes)).toEqual([['a',null],['remote-child','a']]);
  });
  it('同じ本文が別端末で続けられたら現在の本文を上書きしない', () => {
    const before = [node('a')], after = updateNode(before,'a',{text:'自分の編集'});
    const current = updateNode(after,'a',{text:'別端末で続けた'});
    expect(undo(current,before,after)).toEqual({nodes:current,blocked:true});
  });
  it('対象が別端末で削除されていても復活させない', () => {
    const before = [node('a'),node('b')], after = updateNode(before,'a',{text:'自分の編集'});
    const current = [before[1]];
    expect(undo(current,before,after)).toEqual({nodes:current,blocked:true});
  });
  it('時刻表記だけの受信を競合扱いせず、更新時刻を古く戻さない', () => {
    const before = [node('a')], after = updateNode(before,'a',{text:'自分の編集'});
    const current = [{...after[0],updatedAt:'2040-01-01T00:00:00+00:00'}];
    const got = undo(current,before,after);
    expect(got.blocked).toBe(false);
    expect(Date.parse(got.nodes[0].updatedAt)).toBeGreaterThan(Date.parse(current[0].updatedAt));
  });
  it('すでに目的の本文なら書き込みを増やさない', () => {
    const before = [node('a')], after = updateNode(before,'a',{text:'自分の編集'});
    expect(undo(before,before,after)).toEqual({nodes:before,blocked:false});
  });
  it('削除を取り消しても、受信した本文・削除・追加はそのまま残る', () => {
    const before = [node('a'),node('b',[node('child')]),node('c')], after = [before[0],before[2]];
    const current = [node('a',[],{text:'別端末'}),node('new')];
    const got = undo(current,before,after);
    expect(got.blocked).toBe(false);
    expect(rows(got.nodes)).toEqual([['a',null],['new',null],['b',null],['child','b']]);
    expect(got.nodes[0].text).toBe('別端末');
  });
  it('削除した親が別端末で消されていたら、親を復活させてまで子を戻さない', () => {
    const before = [node('a',[node('child')])], after = [node('a')];
    expect(undo([],before,after).blocked).toBe(true);
  });
  it('自分が追加した枝だけを削除し、受信した別の枝を残せる', () => {
    const before = [node('a')], after = [...before,node('b',[node('child')])];
    const current = [...after,node('remote')];
    const got = undo(current,before,after);
    expect(got.blocked).toBe(false);
    expect(rows(got.nodes)).toEqual([['a',null],['remote',null]]);
  });
  it.each(['本文','子の追加','子の並べ替え'])('追加した枝へ別端末の%sがあれば削除しない', (kind) => {
    const before = [node('a')], after = [...before,node('b',[node('c'),node('d')])];
    const branch = kind === '本文' ? node('b',after[1].children,{text:'受信'})
      : node('b', kind === '子の追加' ? [...after[1].children,node('remote')] : [...after[1].children].reverse());
    const current = [before[0],branch];
    expect(undo(current,before,after)).toEqual({nodes:current,blocked:true});
  });
  it('字下げだけを戻し、同じ行の受信した本文と新しい兄弟を残せる', () => {
    const before = [node('a'),node('b'),node('c')], after = [node('a',[before[1]]),before[2]];
    const current = [node('a',[node('b',[],{text:'受信した本文'}),node('remote-child')]),node('remote-root'),before[2]];
    const got = undo(current,before,after);
    expect(got.blocked).toBe(false);
    expect(rows(got.nodes)).toEqual([['a',null],['remote-child','a'],['remote-root',null],['b',null],['c',null]]);
    expect(field(got.nodes,'b','text')).toBe('受信した本文');
  });
  it('並べ替えの間に届いた行を消さず、元からいた行の順だけ戻せる', () => {
    const before = [node('a'),node('b'),node('c')], after = [before[2],before[0],before[1]];
    const got = undo([after[0],node('remote'),after[1],after[2]],before,after);
    expect(got.blocked).toBe(false);
    expect(got.nodes.filter((node) => node.id !== 'remote').map((node) => node.id)).toEqual(['a','b','c']);
    expect(got.nodes).toHaveLength(4);
  });
  it('対象が別端末で移動済みなら配置を上書きしない', () => {
    const before = [node('a'),node('b'),node('c')], after = [node('a',[before[1]]),before[2]];
    const current = [node('a'),node('c',[before[1]])];
    expect(undo(current,before,after)).toEqual({nodes:current,blocked:true});
  });
  it('戻す先の親が自分の下へ移動していても循環を作らない', () => {
    const before = [node('p',[node('a')]),node('q')], after = [node('p'),node('q',[node('a')])];
    const current = [node('q',[node('a',[node('p')])])];
    expect(undo(current,before,after)).toEqual({nodes:current,blocked:true});
  });
  it('追加した同じIDが受信で再作成されていても置き換えない', () => {
    const before = [node('a'),node('b')], after = [before[0]], current = [node('a'),node('b',[],{text:'受信'})];
    expect(undo(current,before,after)).toEqual({nodes:current,blocked:true});
  });
  it('一部が競合すれば操作全体を保留し、別の項目も半端に戻さない', () => {
    const before = [node('a'),node('b')], after = [node('a',[],{text:'自分'}),node('b',[],{completed:true})];
    const current = [node('a',[],{text:'別端末'}),after[1]];
    expect(undo(current,before,after)).toEqual({nodes:current,blocked:true});
  });
  it('実際に戻した差分をやり直しても、その間に届いた別の変更は残る', () => {
    const before = [node('a'),node('b')], after = updateNode(before,'a',{text:'自分'});
    const now = [...after,node('remote')], undone = undo(now,before,after).nodes;
    const later = updateNode(undone,'b',{text:'受信'});
    const redone = applyOutlineHistory(later,undone,now);
    expect(redone.blocked).toBe(false);
    expect(redone.nodes.map((node) => node.text)).toEqual(['自分','受信','remote']);
  });
  it('受信後に同じ行で続けた入力を別々に戻しても、受信した別の行を保てる', () => {
    const before = [node('a'),node('b')], first = updateNode(before,'a',{text:'入力1'});
    const received = updateNode(first,'b',{text:'受信'}), second = updateNode(received,'a',{text:'入力2'});
    const one = undo(second,received,second).nodes;
    const two = undo(one,before,first);
    expect(two.nodes.map((node) => node.text)).toEqual(['a','受信']);
  });
  it('大きい並べ替えも本文と行数を保って戻せる', () => {
    const before = Array.from({length:11000},(_,i)=>node(String(i))), after = [...before].reverse();
    const got = undo(after,before,after);
    expect(got.blocked).toBe(false);
    expect(got.nodes.map((node)=>node.id)).toEqual(before.map((node)=>node.id));
  });
});
