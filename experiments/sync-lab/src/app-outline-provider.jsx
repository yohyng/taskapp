import { ProductOutline } from './product-outline.jsx';

// 通常の入口を使い、検証用の操作欄を普段の画面へ持ち込まない。
export function OutlineProvider({ children }) {
  return <ProductOutline tools={false}>{children}</ProductOutline>;
}
