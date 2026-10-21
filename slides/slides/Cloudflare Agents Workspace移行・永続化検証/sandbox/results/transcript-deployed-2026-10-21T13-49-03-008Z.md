```
# run 2026-10-21T13-49-03-008Z  env=deployed  base=<deployed>
versions: {"@cloudflare/shell":"0.4.3","@cloudflare/computer":"0.6.0","wrangler":"4.151.3","node":"v24.22.1"}

### persist (C02/C03/C05)  DO=persist-2026-10-21T13-49-03-008Z
  ① 書く                   bootId=1cadfbdd-7595-4879-94c1-43abca4688c0  alive=0ms  read.ok=true
  ② 直後に読む                bootId=1cadfbdd-7595-4879-94c1-43abca4688c0  alive=315ms  read.ok=true
  …15 秒待つ（hibernate は無活動 10 秒）
  ③ 15 秒後                bootId=e4f5f2ab-3d7d-4389-8e2d-ee32fdd97b02  alive=0ms  read.ok=true
  …150 秒待つ（eviction は 70-140 秒）
  ④ 150 秒後               bootId=c602f7f1-c9f6-465e-9b36-0c3259706d64  alive=0ms  read.ok=true

  bootId の種類: 3（1 なら再起動していない = 永続化の証拠にならない）
```
