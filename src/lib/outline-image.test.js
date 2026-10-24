import { describe, it, expect } from 'vitest';
import { ensureNode, flattenTree } from './outline.js';
import { placeUploadedImage, hasDraggedImage } from './outline-image.js';

const node = (id,text='',children=[]) => ensureNode({id,text,children});
const url = 'https://images.test/photo.png';
const texts = (nodes) => flattenTree(nodes).map(({text})=>text);

describe('アップロード後の最新の文書へ画像を置く', () => {
  it('ドラッグ中に本体を読めなくても、画像の種類だけで受け入れる', () => {
    expect(hasDraggedImage({files:[],items:[{kind:'file',type:'image/png',getAsFile:()=>null}]})).toBe(true);
    expect(hasDraggedImage({files:[{type:'image/jpeg'}]})).toBe(true);
    expect(hasDraggedImage({items:[{kind:'string',type:'text/plain'}]})).toBe(false);
  });
  it('空行は画像へ変え、古い画像幅は引き継がない', () => {
    const nodes = [{...node('a'),imageWidth:100}];
    const got = placeUploadedImage(nodes,{nodeId:'a'},url);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({id:'a',text:url,imageWidth:null});
    expect(nodes[0].text).toBe('');
  });
  it('待っている間に入力された本文を残し、直後へ新しい画像行を置く', () => {
    const got = placeUploadedImage([node('a','入力中'),node('b','次の行')],{nodeId:'a'},url);
    expect(texts(got)).toEqual(['入力中',url,'次の行']);
  });
  it('行が別の親へ移っていても、現在の場所へ画像を付ける', () => {
    const nodes = [node('old','以前の親'),node('new','今の親',[node('a','本文')])];
    const got = placeUploadedImage(nodes,{nodeId:'a',parentId:'old'},url);
    expect(got[0].children).toEqual([]);
    expect(got[1].children.map((node)=>node.text)).toEqual(['本文',url]);
  });
  it('元の行が削除されても、残っている親の末尾へ画像を置く', () => {
    const got = placeUploadedImage([node('p','親',[node('b','残る本文')])],{nodeId:'a',parentId:'p'},url);
    expect(got[0].children.map((node)=>node.text)).toEqual(['残る本文',url]);
    expect(flattenTree(got).some((row)=>row.id==='a')).toBe(false);
  });
  it('元の行と親が消えたときは、復活させずホームの末尾へ置く', () => {
    const got = placeUploadedImage([node('b','残る本文')],{nodeId:'a',parentId:'p'},url);
    expect(texts(got)).toEqual(['残る本文',url]);
    expect(flattenTree(got).some((row)=>['a','p'].includes(row.id))).toBe(false);
  });
  it('同じ空行から2枚の返事が続いても、前の画像を上書きしない', () => {
    const first = placeUploadedImage([node('a')],{nodeId:'a'},url);
    const second = placeUploadedImage(first,{nodeId:'a'},'https://images.test/second.png');
    expect(texts(second)).toEqual([url,'https://images.test/second.png']);
  });
});
