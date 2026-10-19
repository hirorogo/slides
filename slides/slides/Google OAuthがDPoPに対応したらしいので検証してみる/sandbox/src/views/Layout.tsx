/**
 * 全ページ共通のガワ。
 * hono/jsx-renderer に渡すと、各ハンドラは c.render(<中身 />, { title }) だけで済む。
 */

import { jsxRenderer } from 'hono/jsx-renderer'

const styles = `
  body { font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.7;
         max-width: 880px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.05rem; margin-top: 2rem; border-bottom: 1px solid #eee; padding-bottom: .3rem; }
  pre { background: #f6f6f7; padding: 1rem; border-radius: 8px; overflow-x: auto;
        font-size: .82rem; line-height: 1.5; }
  code { background: #f6f6f7; padding: .1rem .35rem; border-radius: 4px; font-size: .9em; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; margin: .5rem 0; }
  th, td { border: 1px solid #e3e3e3; padding: .5rem .7rem; text-align: left; }
  th { background: #f6f6f7; width: 15rem; font-weight: 600; }
  .button { display: inline-block; background: #1a73e8; color: #fff; padding: .6rem 1.2rem;
            border-radius: 6px; text-decoration: none; margin: 0 .5rem .5rem 0; }
  .button.secondary { background: #5f6368; }
  .ok { color: #137333; font-weight: 600; }
  .ng { color: #c5221f; font-weight: 600; }
  .note { background: #fef7e0; border-left: 4px solid #f9ab00; padding: .8rem 1rem;
          border-radius: 4px; }
  footer { margin-top: 3rem; border-top: 1px solid #eee; padding-top: 1rem; font-size: .9rem; }
`

declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props: { title: string }): Response
  }
}

export const layout = jsxRenderer(({ children, title }) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <style>{styles}</style>
    </head>
    <body>
      {children}
      <footer>
        <a href="/">← トップへ</a>
      </footer>
    </body>
  </html>
))
