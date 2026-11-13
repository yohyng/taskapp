import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import { Drawer } from "vaul";
import { Command } from "cmdk";
import NumberFlow from "@number-flow/react";
import "./index.css";

// 部品のライブラリを、この app の配色のまま試す場所。
// 本番の配信物には入れない（lab の作りでだけ出す）。
// 見るのは「入れたら手触りが良くなるか」で、見た目の派手さではない。

const Card = ({ title, now, after, children }) => (
  <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
    <h2 className="mb-1 text-sm font-semibold ts-text">{title}</h2>
    <div className="mb-3 grid gap-1 text-[11px] leading-relaxed text-neutral-500">
      <div><span className="text-neutral-600">いま：</span>{now}</div>
      <div><span className="text-neutral-600">これ：</span>{after}</div>
    </div>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </section>
);

const button = "min-h-10 rounded-lg border border-white/15 px-3 text-[12px] text-neutral-200 transition hover:bg-white/10";

function UiLab() {
  const [count, setCount] = useState(12);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const items = ["今日のタスク", "7days を開く", "アウトラインへ", "手書きを開く", "控えをとる", "配色を変える"];

  return <div className="min-h-dvh ts-bg ts-text">
    <Toaster theme="dark" position="bottom-right" richColors closeButton />
    <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
      <header>
        <h1 className="text-base font-semibold">UI の試し場</h1>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
          入れるか決めるための場所。配色はこの app のものを使っている。
          判断の材料は <code className="text-neutral-400">docs/ui-libraries.md</code>。
        </p>
      </header>

      <Card
        title="Sonner — 知らせ（トースト）"
        now="画面の下に1つだけ出す自前のもの。重なると前のが消える。取り消しは無い"
        after="重ねて出せる・取り消しを付けられる・自動で消える・押して閉じられる"
      >
        <button type="button" data-lab-toast className={button} onClick={() => toast("メモに書きとめました")}>ふつう</button>
        <button type="button" data-lab-toast-undo className={button}
          onClick={() => toast("3件を消しました", { action: { label: "取り消す", onClick: () => toast.success("戻しました") } })}>
          取り消し付き
        </button>
        <button type="button" data-lab-toast-wait className={button}
          onClick={() => toast.promise(new Promise((done) => setTimeout(done, 1200)), { loading: "控えています…", success: "控えました", error: "控えられません" })}>
          待つあいだ
        </button>
        <button type="button" className={button} onClick={() => { for (let i = 0; i < 3; i += 1) toast(`${i + 1} 件目`); }}>重ねる</button>
      </Card>

      <Card
        title="Vaul — 下から出るシート"
        now="⚙ は自前の固定パネル。指で引いて閉じられない"
        after="指で引いて閉じる・途中で止める・背面が少し奥に下がる"
      >
        <Drawer.Root>
          <Drawer.Trigger data-lab-sheet className={button}>開く</Drawer.Trigger>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 z-[400] bg-black/40" />
            <Drawer.Content data-lab-sheet-panel className="fixed inset-x-0 bottom-0 z-[401] mt-24 flex max-h-[80dvh] flex-col rounded-t-2xl border-t border-white/15 ts-surface p-4">
              <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <Drawer.Title className="mb-1 text-sm font-semibold ts-text">画像の置き場</Drawer.Title>
              <Drawer.Description className="mb-3 text-[11px] text-neutral-500">
                いまの ⚙ の中身を、このシートに置いた場合の見え方。
              </Drawer.Description>
              <div className="grid gap-2">
                <input placeholder="GAS の URL（…/exec）" className="rounded border border-white/10 bg-black/25 px-2 py-2 text-[12px] ts-text outline-none" />
                <input type="password" placeholder="合言葉" className="rounded border border-white/10 bg-black/25 px-2 py-2 text-[12px] ts-text outline-none" />
                <div className="flex gap-2">
                  <button type="button" className={`${button} flex-1`}>つながるか試す</button>
                  <button type="button" className={`${button} flex-1`}>いま控える</button>
                </div>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      </Card>

      <Card
        title="cmdk — ⌘K の呼び出し"
        now="早見（⌘P）と探す（⌘K）は自前。絞り込みは前方一致に近い"
        after="あいまいな打ち間違いでも当たる・上下で選ぶ・分類して並べられる"
      >
        <button type="button" data-lab-palette className={button} onClick={() => setPaletteOpen(true)}>開く</button>
        {paletteOpen && (
          <div className="fixed inset-0 z-[500] flex items-start justify-center bg-black/40 p-4 pt-[18vh]" onClick={(e) => { if (e.target === e.currentTarget) setPaletteOpen(false); }}>
            <Command data-lab-palette-panel label="コマンド" className="w-full max-w-md overflow-hidden rounded-xl border border-white/15 ts-surface shadow-2xl">
              <Command.Input autoFocus placeholder="なにをする？" className="w-full border-b border-white/10 bg-transparent px-3 py-3 text-[13px] ts-text outline-none placeholder:text-neutral-600" />
              <Command.List className="max-h-64 overflow-y-auto p-1">
                <Command.Empty className="px-3 py-6 text-center text-[11px] text-neutral-600">見つかりません</Command.Empty>
                <Command.Group heading="よく使う" className="px-1 text-[10px] text-neutral-600 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
                  {items.map((item) => (
                    <Command.Item key={item} value={item} onSelect={() => { setPaletteOpen(false); toast(`${item}`); }}
                      className="cursor-pointer rounded px-2 py-2 text-[12px] text-neutral-300 data-[selected=true]:bg-white/10 data-[selected=true]:ts-text">
                      {item}
                    </Command.Item>
                  ))}
                </Command.Group>
              </Command.List>
            </Command>
          </div>
        )}
      </Card>

      <Card
        title="NumberFlow — 数が変わるところ"
        now="数字がぱっと入れ替わる"
        after="桁が送られて変わる。件数・文字数が動いたことに気づける"
      >
        <span data-lab-number className="rounded-lg border border-white/10 px-3 py-2 text-xl tabular-nums ts-text">
          <NumberFlow value={count} />
        </span>
        <button type="button" data-lab-number-up className={button} onClick={() => setCount((n) => n + 7)}>増やす</button>
        <button type="button" className={button} onClick={() => setCount((n) => Math.max(0, n - 3))}>減らす</button>
        <button type="button" className={button} onClick={() => setCount(1280)}>一気に</button>
      </Card>

      <p className="text-[11px] leading-relaxed text-neutral-500">
        入れるかどうかは、ここで触って決める。採るときは一か所ずつ置き換える。
        どれも本番の配信物には入っていない（この試し場だけで読み込む）。
      </p>
    </div>
  </div>;
}

createRoot(document.getElementById("root")).render(<UiLab />);
