# 場所に残す思い出：反映と検証

## 体験と変更範囲

カメラ版だけを更新。デモのロゴ画像、色、写真入りの膜の素材、円周表示処理を再利用する。デモの見た目と円周配置は保持。接続先変更に伴い、旧プロジェクトの共有API呼び出しは停止。デモには同梱写真を表示し、場所付き投稿は「場所の思い出」タブから行う。

- 通常Webはカメラ・環境モデルなし。対応端末の「WebXRで見る」で現実の周囲に重ねる。ARでは方位センサーを使うか、北を向いて「正面を北に合わせる」。Webはドラッグで見回せる。
- 「周辺を更新」で現在地を1回取得して、周囲50m以内の思い出を最大24件取得する。常時位置追跡・定期APIポーリングは行わない。移動後は再度更新する。
- 写真をファイルから選ぶと位置情報を取得し、端末内に下書きを作る。この時点では写真をアップロードしない。
- 確認画面で写真・タイトル・撮影地点を確認し、共有の同意にチェックして「この場所に残す」。JPEGに再エンコードしてEXIFを落としてから、非公開バケットと場所用テーブルに保存する。
- 近くを訪れた匿名ユーザーも自分も閲覧可能。泡を開くと、写真枚数分・目の高さ・等間隔の円周になる。投稿者はタイトルの変更と削除ができる。

泡の方角は位置座標から計算する。見やすさのため画面内の距離を圧縮し、思い出を開いた際には実際の概算距離を表示する。GPS/方位の誤差、カメラと方位センサーの差、GPSを偽装できることから、センチ単位の固定や物理的な来訪の証明は行わない。ARでも初期の北合わせが必要。物理端末で検証するまで動作確認済みとは扱わない。

## 管理者の反映手順

対象: https://supabase.com/dashboard/project/niaopqpzpwrfhfwzllzs

0. [新プロジェクトの接続手順](supabase-project-setup.md) に従い、公開キーを設定してビルドする。
1. Authenticationで匿名サインインを有効化する（新プロジェクトの状態は未確認）。
2. SQL Editorで未適用のものだけを順に確認・適用する。
   - `supabase/migrations/202610260001_private_locations.sql`
   - `supabase/migrations/202610260002_place_memories.sql`
   - `supabase/migrations/202610260003_place_memories_geography.sql`
3. 新しい `place-memories` Edge Functionだけをデプロイする。例:

```sh
supabase functions deploy place-memories --project-ref niaopqpzpwrfhfwzllzs
```

既存の `server` をデプロイしてはいけない。ローカルソースと稼働中の `/memories` 実装には差がある。

4. 新関数はSupabase提供の `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` をサーバーでだけ使用する。キーをチャット、ソース、フロントエンドへ渡さない。
5. 新しい任意のサーバー設定 `MEMORIA_ALLOWED_ORIGINS` はカンマ区切りの許可オリジン。未設定では `http://127.0.0.1:3000,http://localhost:3000` のみ。公開時は実際のHTTPSオリジンを明示する。ワイルドカードCORSは使わない。
6. 既存PostGISが `extensions` 以外にある場合、位置検索のマイグレーションは停止する。既存の拡張を移動・削除せず、管理者がスキーマ参照を確認してから反映する。

## セキュリティの境界

- `private_locations`: 本人の最新位置。周辺検索や公開操作時の明示的な位置取得から更新する。公開する写真の地点とは分離。
- `place_memories`: 写真と場所の記録。本人だけが直接SELECT可能。直接INSERT、所有者・写真パス・座標の変更、直接DELETEは許可しない。タイトルのみ本人が変更できる。
- 周辺検索関数はservice_roleにだけ実行を許可。Edge Functionはリクエストごとに `auth.getUser(token)` で実在ユーザーを検証してから、サーバー側で50m・最大24件に固定して検索する。位置情報をURLに含めない。
- 写真は `place-memory-photos` 非公開バケット。パスは本人UUID/思い出UUID/写真UUID.jpg。公開APIは保存済みの画像パスも毎回所有者のものか再検証してから60秒の署名URLを発行する。
- 古いプロジェクトに広いStorageポリシーがあっても、このバケットの制限を守るRESTRICTIVEポリシーを追加。既存バケットは対象外。
- 投稿済み写真の上書きは禁止。未投稿写真のみ本人が直接削除可能。投稿削除はAPIで先に非表示にし、画像を消してからメタデータを消す。画像削除失敗時も非表示を維持して再試行できる。
- 管理者とサービスロールはRLSの外でアクセス可能。本人限定は一般ユーザー間の分離を示す。
- 短時間URLは有効期間内なら共有先でも閲覧でき、表示した写真のコピーを防ぐ機能ではない。本人の公開操作以外で写真を送信しない。

## 公開前に必要な運用

匿名認証のレート制限とCAPTCHAを設定する。CAPTCHAを有効にする場合は既存 `signInAnonymously` 呼び出しに対応するチャレンジとcaptchaTokenの受け渡しを実装してから公開する。現在の実装はCAPTCHA要件を迂回しない。

投稿失敗でアップロード済みになった未参照の画像は非公開のまま残り得る。参照されていない古い画像だけを管理者が定期削除する運用が必要。匿名アカウントを消す前に、紐づく写真と投稿を削除する。利用規約、公開写真の通報・モデレーション、保持期間・削除手順は一般公開前に運用側で定める。

## ローカル検証

```sh
pnpm exec tsc --noEmit
node --experimental-strip-types --test tests/*.test.mjs
npx deno check supabase/functions/place-memories/index.ts
pnpm build
```

Nodeテストは座標・距離・写真パス検証と、PGliteによる実際の所有者RLS・Storageポリシーを検証する。PostGISはPGliteに含まれないため、位置検索マイグレーションの実行は反映先DBで別途確認する。

## 実機・反映後の確認

- スマートフォンのHTTPSでカメラ・位置・方位を許可／拒否した場合。
- 公開前はアップロードが発生せず、同意なしに公開できないこと。
- 投稿後に別の匿名ユーザーから50m以内で見つかり、範囲外の通常検索で返らないこと。
- 他人の投稿の変更・削除、画像パス偽装、API未認証呼び出しの拒否。
- タップ後は追加分裂なし、写真数と等しい円周表示、写真の前後移動、戻る。
- 更新・再読み込み・デモ切替でカメラとAR、画像テクスチャが解放されること。

参照: https://supabase.com/docs/guides/database/extensions/postgis
https://supabase.com/docs/guides/storage/security/access-control
https://supabase.com/docs/guides/auth/auth-anonymous

WebとWebXRの最新の画面構成・本人の投稿一覧は [ページ仕様](web-and-xr-views.md) を参照してください。
