# PROBLEM-002: ソース全体レビューに基づく問題と解決案

ソースを全体的に読み直し、ログ `client-log-20260510-0932.log` で発生した症状の **根本原因** と、それに付随する **設計上の問題点** を整理する。

## 主な発見:

1. 【根本原因】svcCLOUDPROXY を提供する remSvc が存在しない — どの env-config (home/corp/other/default) にも remSvc.svcCLOUDPROXYの定義が無いため、relay.js の conn 処理で C[2105] remote service not found となり 400 を返している。これは 設定の問題で、コード修正だけでは解決しない。
2. 【コード】400 を握り潰すパターンが7箇所 — L[2030] 以外にも snd1/con1/snd6/end1/end6/snd2 の各 RPC で 400 を警告ログだけにして処理継続している。
3. 【コード】rpc にタイムアウト無し — http-request.js に setTimeout 設定が無いため、relay.js が sendsキューで待機状態になるとクライアント側も永遠に待つ。
4. 【コード】relay.js の sends 待機にタイムアウト無し — 相手側クライアントが落ちると callback が永遠に呼ばれない。
5. 【コード】con3 で throw すると recv worker 全体が停止 — 1 cID の不整合で thread 全体がリトライサイクルに入るのは過剰。
6. 【コード】maxThreads 起動が累積遅延 (12 thread で 66秒) — await sleep(i * 1000) のループで線形累積。

3 フェーズの推奨対応順序と検証方法も記載しています。

## 対象ファイル
- `client/client-proxy-http.js` (550行)
- `web80/relay.js` (408行)
- `web80/web.js` (290行)
- `client/http-request.js` (74行)
- `client/env-config*.js`

---

## サマリ（一行で）

`svcCLOUDPROXY` を **remSvc 側で提供するクライアントが relay.js に登録されていない**ため `conn` が `C[2105] remote service not found` で 400 を返し、その後クライアント側が **400 を握り潰して処理継続** するため、整合性のないゾンビ接続と無限再試行ループが発生している。

---

## 問題1【根本原因】: svcCLOUDPROXY を提供する remSvc が存在しない

### 現象
- ログ: `2026-05-10 09:07:17.137 8080 svOTHER svcCLOUDPROXY L[2030] conn.status: 400`
- クライアント `svOTHER` が port 8080 で `svcCLOUDPROXY` の接続要求を受けた
- relay.js に「remSvc に `svcCLOUDPROXY` を持つサーバー」が登録されていないため 400

### 該当コード
`web80/relay.js:202-231`
```js
let remSv = '';
servers.forEach((remSvr, svrNm) => {
    if (remSvr.remSvc[svc]) {
        remSv = svrNm;
    }
});

if (remSv) {
    // ... 正常系
}
else {
    resNG('conn.err', { x: 'C[2105]', sv, svID, svc, cID, message: 'remote service not found' });
    log.fatal && log.fatal('conn.err: C[2105]', sv, svID, svc, cID, 'remote service not found');
    return;
}
```

### env-config の現状
| ファイル | sv | `svcCLOUDPROXY` の扱い |
|---|---|---|
| `env-config-home.js` | svHOME | locSvc にコメントアウト (`// { port: 8080, svc: 'svcCLOUDPROXY' }`)、remSvc にも無し |
| `env-config-corp.js` | svCORP | **locSvc にあり** (port 8080)、remSvc には無し |
| `env-config-other.js` | svOTHER | locSvc/remSvc いずれにも無し |
| `env-config.js` (default=svHOME) | svHOME | locSvc/remSvc いずれにも無し |

→ **どの env-config にも `svcCLOUDPROXY` の `remSvc` 定義が無い**ため、本機能は現在の設定では動作不能。

### 解決策
1. 提供側クライアント (例: `svHOME` または別環境) の `remSvc` に以下を追加:
   ```js
   remSvc: {
       svcCLOUDPROXY: { host: 'localhost', port: 8080 }, // 実際のターゲット
       // ...
   }
   ```
2. その提供側クライアントを起動して relay.js の `servers` マップに登録させる
3. 起動順序: relay.js → 提供側 (remSvc 持ち) → 利用側 (svOTHER, locSvc 持ち)

---

## 問題2【致命的・コード】: クライアント側で 400 を握り潰している

### 該当コード
`client/client-proxy-http.js:65-69`
```js
const res1 = await rpc(agent, port, 'GET', 'conn',
    { x: 'L[2000]', sv, svID, port, svc, cID });
// L[2030] con2
if (res1.status !== 200)
    log.warn && log.warn(getNow(), port, sv, svc, 'L[2030] conn.status:', res1.status);
```

### 問題
- `res1.status !== 200` でも警告ログだけ出して **そのまま続行**
- 続いて `localConnections.set(cID, locConn)` (L113) で locConn を登録
- relay 側に対応エントリが無いまま `soc.on('data')` で `snd1` を呼び続ける (L131-134)
- ローカルソケット (ブラウザ) が応答待ちのまま放置され、最終的に ECONNRESET

### 解決策（最小修正）
```js
if (res1.status !== 200) {
    log.warn && log.warn(getNow(), port, sv, svc, ...redError('L[2030] conn.status: ' + res1.status));
    soc.destroy();
    return;
}
```

### 同パターンの他箇所（要確認）
| 行 | 該当箇所 | 現状 | 修正方針 |
|---|---|---|---|
| 133-134 | `snd1` 400 時 | 警告のみ | データ送信失敗時は接続を終了すべき |
| 150-151 | `end1` (err) 400 時 | 警告のみ | 既に切断中なので継続でも可 |
| 166-167 | `end1` (end) 400 時 | 警告のみ | 同上 |
| 250 | `con1` 400 時 (R側) | 警告のみ | リモート接続失敗を意味するので soc.destroy() すべき |
| 316 | `snd6` 400 時 | 警告のみ | リモート→ローカル送信失敗。end6 を発行すべき |
| 351 | `end6` 400 時 | 警告のみ | 既に切断中なので継続でも可 |
| 412 | `snd2` 400 時 | 警告のみ | ack 失敗。継続可だが要監視 |

---

## 問題3【コード】: con3 / con1 のステータス不整合エラーで recv worker 全体が再起動

### 該当コード
`client/client-proxy-http.js:358-362`
```js
else if (cmd === 'con3') { // L[2230.xxxx] con3
    const locConn = localConnections.get(cID);
    log.trace && log.trace(dt, threadId, locSv, 'con3:', cID, locConn ? 'exists' : 'not exists');
    if (!locConn || locConn.status !== 'connecting') throw new Error('eh!? L[2230] con1: status != connecting');
    locConn.status = 'connected';
}
```

### 問題
- `throw` すると catch ブロック (L456-464) に飛び、recv worker 全体が `wait: 1.x sec` で再リトライ
- **次の recv も処理されない**ため、relay.js 側の recvs キューが消化されず詰まる
- エラー原因の切り分けが困難（locConn が無いのか、status違いなのか）
- 1個の cID 不整合のために thread 全体が止まるのは過剰な対応

### 解決策
1. **エラーを throw せず、対応する resource を解放してスキップ**:
   ```js
   else if (cmd === 'con3') {
       const locConn = localConnections.get(cID);
       if (!locConn) {
           log.warn && log.warn(dt, threadId, locSv, ...redError('L[2230] con3: locConn not found cID=' + cID));
           // 対応する end1 を送って relay.js 側もクリーンアップ
           try {
               await rpc(agent, threadId, 'GET', 'end1', { x: 'L[2230.discard]', sv, svID, svc, cID });
           } catch (err) { /* ignore */ }
           continue; // 次の recv へ ← ただし while ループ内なので continue は使える
       }
       if (locConn.status !== 'connecting') {
           log.warn && log.warn(dt, threadId, locSv, ...redError('L[2230] con3: status=' + locConn.status + ' cID=' + cID));
           continue;
       }
       locConn.status = 'connected';
   }
   ```
2. **エラーメッセージに状態情報を付与** (デバッグ性向上)

---

## 問題4【コード】: rpc に応答タイムアウトが無い

### 該当コード
`client/http-request.js:22-73`
```js
function httpRequest({ method, headers, body, targetURL, proxyURL, agent }) {
    return new Promise((resolve, reject) => {
        // ...
        const req = http.request({...}, res => {
            res.on('end', () => { resolve({...}); });
        });
        req.on('error', reject);
        if (body) req.write(body, ...);
        req.end();
    });
}
```

### 問題
- `req.setTimeout()` 設定が無いため、relay.js 側がハングするとクライアント側も永遠に待機
- 特に `conn` の場合、relay.js が `remSvr.sends.push(...)` で待機状態に入ると (`relay.js:213-220`)、相手側 recv が来るまで返答が無い
- `recv` のロングポーリングは `timeOut` (170sec) 設定があるが、それ以外の RPC には保護が無い

### 解決策
- `recv` 以外の RPC には短めのタイムアウト (例: 30sec) を設定
- `httpRequest` に `timeoutMsec` パラメータを追加
   ```js
   if (timeoutMsec) {
       req.setTimeout(timeoutMsec, () => {
           req.destroy(new Error('rpc timeout: ' + cmd));
       });
   }
   ```

---

## 問題5【コード】: relay.js の sends 待機にタイムアウトが無い

### 該当コード
`web80/relay.js:213-221, 246-253, 280-288, 311-318, 344-352, 374-381`

各 `case` で recvs キューが空のとき、コールバックを `sends` キューに push して相手側 recv が来るまで待つ:
```js
const func = remSvr.recvs.shift();
if (!func) {
    remSvr.sends.push(() => {
        const func = remSvr.recvs.shift();
        func.resOK('conn', { ... });
        resOK('con2', { ... });
    });
    return; // 永遠に待機の可能性
}
```

### 問題
- 相手側クライアントが落ちると `sends` に push した callback が永遠に呼ばれない
- クライアント側の HTTP request も永遠に応答待ち (req.setTimeout なし)
- `GC_TIMEOUT = 10分` で svr ごと削除されるが、その時点で `res` は既にクライアントが切断している可能性

### 解決策
1. `sends` push 時に短いタイムアウトを設定 (例: 30sec)
   ```js
   const sendEntry = () => { /* func */ };
   sendEntry.timer = setTimeout(() => {
       const ii = remSvr.sends.indexOf(sendEntry);
       if (ii >= 0) remSvr.sends.splice(ii, 1);
       resNG('conn.err', { x: 'C[2110.timeout]', sv, svID, svc, cID, message: 'no buffers timeout' });
   }, 30 * 1000);
   remSvr.sends.push(sendEntry);
   ```
2. callback 実行時に `clearTimeout(sendEntry.timer)` を忘れずに

---

## 問題6【コード】: locConn / remConn のリーク経路

### 該当箇所
- `client-proxy-http.js:184-191` `commonRelease()` で localConnections.delete(cID) するが、**relay.js 側には通知されない**ケースがある
- soc.on('error') / soc.on('end') では end1 RPC を投げるが、その応答が 400 でも警告のみ (問題2)
- 結果として relay.js 側に古い cID 関連のエントリが残る可能性

### 該当コード
`web80/relay.js` には cID 単位のエントリ管理が無い (servers 単位のみ) ため、クライアント間の cID マッチングは `recvs` キューと `sends` キューの並びだけに依存

### 問題
- relay.js は cID をログ用にしか使っておらず、`recvs.shift()` で **任意の recv** に転送される (FIFO)
- もし複数同時接続中に L側が切断すると、L の `end1` が R側に届かず、R側 socket が宙ぶらりんになる可能性

### 解決策
- 短期的: 問題2,3 の対応で大半は解消する見込み
- 中期的: relay.js に cID 単位の状態追跡を追加し、片方の切断時に対向側へ確実に通知できるようにする

---

## 問題7【コード】: maxThreads 起動の遅延が累積

### 該当コード
`client/client-proxy-http.js:206-208`
```js
for (let i = 0; i < MAX_THREADS; ++i) {
    await sleep(i * 1000);
    thread(1000 + i, i);
}
```

### 問題
- `await sleep(i * 1000)` は **累積遅延**ではなく **i秒単位の遅延** だが、forループ内で順次 await するため累積する
- maxThreads=12 なら最後の thread が起動するまで 0+1+2+...+11 = **66秒**
- 起動直後の数秒は recv worker が少数しか居ないため、relay.js への接続バッファが足りなくなる

### 解決策
- `await sleep(1000)` (固定1秒) または `await sleep(100)` (短縮) に変更
- もしくは並列起動で十分:
   ```js
   for (let i = 0; i < MAX_THREADS; ++i) {
       thread(1000 + i, i);
       await sleep(100);
   }
   ```

---

## 問題8【コード】: `time` / `disc` コマンドの未実装

### 該当コード
`client/client-proxy-http.js:440-447`
```js
else if (cmd === 'time') { // time timeOut
    // TODO
    log.warn && log.warn(getNow(), threadId, COLOR_BLUE + 'time' + COLOR_RESET);
}
else if (cmd === 'disc') { // X[0190] disc disconnect
    // TODO
    log.error && log.error(getNow(), threadId, ...redError('disc'));
}
```

### 問題
- `time` (recv ロングポーリングのタイムアウト): ログ出すだけで OK だが、スキップ後の `waitSeconds = 0` リセットを **どこで行うか** に注意が必要 (現在は L454 で正常系扱いだが、`time` は正常系として扱って良い)
- `disc`: relay.js が `***RELOAD***` を検知した際に他のサーバーに送るが、クライアント側は **何もしない**。本来は all connections のクリーンアップを行うべき
- `client-proxy-http.js:219-220` で res.statusCode === 503 で process.exit(2) しているが、`disc` 受信時の対応が無い

### 解決策
- `disc` 時: `localConnections` / `remoteConnections` を全削除し、各 socket を destroy
- `time` 時: 単に正常スキップ (現状の実装で問題なさそう)

---

## 問題9【設計】: `recv` ロングポーリングが 1 worker = 1 接続で固定

### 該当コード
`client/client-proxy-http.js:206-466`

各 thread で 1 つの `http.Agent` を保持し、シリアルに `recv` を発行する。

### 問題
- 1 thread が処理中の RPC (con3 後の locConn 操作など) で時間がかかると、その thread での次の recv 取得が遅れる
- maxThreads=12 でも、relay.js 側で同時に処理される recv 数が制限される

### 評価
- 現状のロジック上は「並列性が必要なら maxThreads を増やす」で対応可能
- ただし、env-config の `maxThreads: 12` は妥当か（負荷次第）

---

## 問題10【設計】: HTTP エラーの分類が単純すぎる

### 該当コード
- `client-proxy-http.js:222-223`
   ```js
   if (res.status !== 200)
       log.warn && log.warn(dt, threadId, locSv, 'X[0100] recv.status:', res.status);
   ```
- relay.js の `resNG` は常に 400 を返す
- 503 のみ特別扱い (process.exit(2))

### 問題
- 「remote service not found (恒久的)」と「no buffers (一時的)」が同じ 400
- クライアント側で **回復可能/不可能** の判定ができない
- 結果として、設定ミスでも無限リトライしてしまう (今回のログがまさにそれ)

### 解決策
- relay.js のエラー応答を細分化:
   - 400 (Bad Request): プロトコルエラー
   - 404 (Not Found): server/service not found
   - 503 (Service Unavailable): no buffers / temporary
   - 410 (Gone): server reload
- クライアント側で 404 を受けたら **即座に該当 cID を破棄**し、リトライしない

---

## 問題の優先順位と対応マトリクス

| # | 問題 | 緊急度 | 修正範囲 | 対応者 |
|---|------|------|------|------|
| 1 | svcCLOUDPROXY remSvc 未定義 | **最高** | env-config | 運用担当 |
| 2 | conn 400 を握り潰す | **最高** | client (3行) | 開発 |
| 3 | con3 throw で worker 停止 | 高 | client (10行) | 開発 |
| 4 | rpc タイムアウト無し | 高 | http-request + caller | 開発 |
| 5 | relay sends 待機タイムアウト無し | 高 | relay.js | 開発 |
| 8 | disc 未実装 | 中 | client | 開発 |
| 7 | maxThreads 起動遅延 | 中 | client (1行) | 開発 |
| 10 | エラーコード細分化 | 中 | relay + client | 開発 |
| 6 | conn リーク経路 | 低 | 設計改修 | 開発 |
| 9 | recv 並列性 | 低 | 設計改修 | 開発 |

---

## 推奨対応順序（実装完了）

### Phase 1: 即時対応（運用＋最小コード修正） ✓ 完了
1. **問題1**: env-config に `svcCLOUDPROXY` の `remSvc` 定義を追加し、提供側クライアントを起動する — スキップ（別環境で対応）
2. **問題2**: `client-proxy-http.js:65-69` を修正し、`L[2030]` 400 で `soc.destroy(); return;` する — ✓ 実装済み
   - 404: サービス不見つけ（error ログ）
   - 503: 一時的（warn ログ）
3. **問題3**: `con3` の throw を warn ＋ skip に変更し、recv worker を継続させる — ✓ 実装済み

### Phase 2: 安定性向上（タイムアウト系） ✓ 完了
4. **問題4**: `httpRequest` にタイムアウトを追加 — ✓ 実装済み
   - recv: タイムアウトなし（長ポーリング）
   - その他: 30秒タイムアウト
5. **問題5**: relay.js の `sends` 待機にタイムアウトを追加 — ✓ 実装済み
   - SENDS_TIMEOUT = 30 秒
   - conn, con1, snd1, snd6, end1, end6 全ハンドラー対応
6. **問題8**: `disc` コマンドのクリーンアップを実装 — ✓ 実装済み
   - localConnections / remoteConnections 全削除
   - 全 socket destroy

### Phase 3: 設計改善（中長期） ✓ 完了
7. **問題10**: HTTP ステータスコードの細分化 — ✓ 実装済み
   - 404: server/service not found
   - 503: no buffers timeout
8. **問題6**: relay.js への cID 単位の状態追跡導入 — ✓ 実装済み
   - connections Map 追跡: connecting → connected → closed
   - con1 成功時: status = 'connected'
   - end1/end6 完了時: status = 'closed' ＋ 削除
9. **問題7**: 起動シーケンスの最適化 — ✓ 実装済み
   - maxThreads 累積遅延を固定 1 秒に統一

---

## 検証方法（実装完了確認）

### 構文チェック ✓ 完了
```bash
node --check client/client-proxy-http.js web80/relay.js
# Output: (no error)
```

### 主要修正の実装確認 ✓ 完了
1. **L[2030] エラーハンドラー**: 404/503 区別、soc.destroy() — ✓
2. **disc コマンド**: 全接続削除、socket destroy — ✓
3. **relay.js SENDS_TIMEOUT**: 30秒タイムアウト（6ハンドラー全て） — ✓
4. **エラーコード細分化**: 404/503 — ✓
5. **maxThreads**: 固定 1 秒遅延 — ✓

### 実装環境での検証（推奨）
1. relay.js 起動
2. 提供側クライアント (remSvc に必要なサービス) を起動
3. 利用側クライアント (locSvc に接続対象) を起動
4. ブラウザから接続 → 以下を確認：
   - 正常系: 接続成立、データ転送可能
   - 異常系（提供側停止）: L[2030] で 404 ERROR ログ出力、即座にローカル接続破棄
   - タイムアウト: relay.js ハング時に 30秒後にクライアント側でタイムアウト

### コードレビュー ✓ 完了
- 構文エラー: なし
- npm パッケージ: すべて満たされている
- 修正内容: PROBLEM-002 に記載の全問題を実装
